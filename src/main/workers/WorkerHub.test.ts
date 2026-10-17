import { beforeEach, describe, expect, it } from 'vitest'
import type { WorkerInfo } from '../../shared/types'
import { createWorkerHub, LOST_AFTER_MS, MAX_WORKER_LINES, MAX_WORKERS_PER_SESSION, type WorkerHub } from './WorkerHub'

const OC = 'ses_abcdefgh12345678'
let clock: number
let seen: (readonly WorkerInfo[])[]
let hub: WorkerHub
let known: Set<string>

beforeEach(() => {
  clock = 1_000_000
  seen = []
  known = new Set(['claude-1', 'claude-2'])
  hub = createWorkerHub({ now: () => clock, onChange: (w) => seen.push(w), isKnownSession: (id) => known.has(id) })
})

const ev = (kind: string, extra: Record<string, unknown> = {}, oc = OC, proc = 'p1'): Record<string, unknown> => ({ v: 1, proc, oc, kind, ...extra })
const only = (): WorkerInfo => {
  const list = hub.getWorkers()
  expect(list).toHaveLength(1)
  return list[0] as WorkerInfo
}

describe('WorkerHub.ingest', () => {
  it('builds a running worker from start, model, text, tool and step events', () => {
    hub.ingest('claude-1', ev('start', { dir: 'C:/p', title: 'New session - 2026' }))
    hub.ingest('claude-1', ev('model', { model: 'opencode-go/glm' }))
    hub.ingest('claude-1', ev('text', { partId: 't1', text: 'Reading' }))
    hub.ingest('claude-1', ev('text', { partId: 't1', text: 'Reading the brief' }))
    hub.ingest('claude-1', ev('tool', { partId: 'k1', tool: 'bash', state: 'running', text: 'npm test' }))
    hub.ingest('claude-1', ev('tool', { partId: 'k1', tool: 'bash', state: 'done', text: 'npm test' }))
    hub.ingest('claude-1', ev('step', { partId: 's1', cost: 0.02, tokens: 100 }))
    hub.ingest('claude-1', ev('step', { partId: 's1', cost: 0.02, tokens: 100 }))
    const w = only()
    expect(w).toMatchObject({ id: OC, status: 'running', model: 'opencode-go/glm', dir: 'C:/p', ownerSessionIds: ['claude-1'], tokens: 100 })
    expect(w.costUsd).toBeCloseTo(0.02)
    expect(w.lines).toEqual([
      { kind: 'text', text: 'Reading the brief' },
      { kind: 'tool', tool: 'bash', text: 'npm test', state: 'done' }
    ])
    expect(w.finishedAt).toBeNull()
  })

  it('names a worker from its title, else from its first prompt line, else by number', () => {
    hub.ingest('claude-1', ev('start', { title: 'Backend wiring' }))
    expect(only().name).toBe('Backend wiring')
    hub.forgetSession('claude-1')
    hub.ingest('claude-1', ev('start', { title: 'New session - 2026-10-17' }))
    hub.ingest('claude-1', ev('user', { partId: 'u1', text: '# Task: add the notes panel\nmore detail' }))
    expect(only().name).toBe('Task: add the notes panel')
    hub.forgetSession('claude-1')
    hub.ingest('claude-1', ev('start', { title: 'New session - x' }))
    expect(only().name).toBe('Worker 1')
  })

  it('finishes on idle, fails on error + idle, and flags usage limits', () => {
    hub.ingest('claude-1', ev('busy'))
    clock += 5000
    hub.ingest('claude-1', ev('idle'))
    expect(only()).toMatchObject({ status: 'done', statusDetail: 'ok', finishedAt: clock })
    hub.ingest('claude-1', ev('busy'))
    expect(only()).toMatchObject({ status: 'running', finishedAt: null })
    hub.ingest('claude-1', ev('error', { text: 'Go usage limit exceeded' }))
    hub.ingest('claude-1', ev('idle'))
    expect(only()).toMatchObject({ status: 'failed', statusDetail: 'rate-limited' })
    expect(only().lines.at(-1)).toEqual({ kind: 'error', text: 'Go usage limit exceeded' })
  })

  it('rejects malformed payloads, unknown Claude sessions, and an id owned by another session', () => {
    expect(hub.ingest('claude-1', { nope: true })).toBe(false)
    expect(hub.ingest('ghost', ev('start'))).toBe(false)
    expect(hub.ingest('claude-1', ev('start'))).toBe(true)
    expect(hub.ingest('claude-2', ev('busy'))).toBe(false)
    expect(only().ownerSessionIds).toEqual(['claude-1'])
  })

  it('keeps only the newest lines and the newest workers per session', () => {
    for (let i = 0; i < MAX_WORKER_LINES + 3; i += 1) hub.ingest('claude-1', ev('text', { partId: `t${i}`, text: `line ${i}` }))
    expect(only().lines).toHaveLength(MAX_WORKER_LINES)
    hub.forgetSession('claude-1')
    for (let i = 0; i < MAX_WORKERS_PER_SESSION + 2; i += 1) {
      clock += 1
      hub.ingest('claude-1', ev('busy', {}, `ses_worker${String(i).padStart(8, '0')}`))
    }
    expect(hub.getWorkers()).toHaveLength(MAX_WORKERS_PER_SESSION)
  })
})

describe('WorkerHub.sweep', () => {
  it('marks a running worker lost when its process stops sending heartbeats', () => {
    hub.ingest('claude-1', ev('busy'))
    clock += LOST_AFTER_MS - 1000
    hub.ingest('claude-1', { v: 1, proc: 'p1', kind: 'beat' })
    clock += LOST_AFTER_MS - 1000
    hub.sweep()
    expect(only().status).toBe('running')
    clock += 2000
    hub.sweep()
    expect(only()).toMatchObject({ status: 'failed', statusDetail: 'lost' })
  })

  it('forgets finished workers after a long while', () => {
    hub.ingest('claude-1', ev('idle'))
    clock += 31 * 60 * 1000
    hub.sweep()
    expect(hub.getWorkers()).toHaveLength(0)
  })
})

describe('WorkerHub.forgetSession', () => {
  it('drops that session workers and notifies', () => {
    hub.ingest('claude-1', ev('busy'))
    const count = seen.length
    hub.forgetSession('claude-1')
    expect(hub.getWorkers()).toHaveLength(0)
    expect(seen.length).toBe(count + 1)
  })
})
