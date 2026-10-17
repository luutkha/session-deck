import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WorkerInfo } from '../../shared/types'
import { createWorkerWatcher, ownersByDir } from './WorkerWatcher'

let root: string
let clock: number
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'sd-workers-'))
  clock = Date.now()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const NL = String.fromCharCode(10)
const BOM = String.fromCharCode(0xfeff)
const ev = (o: unknown): string => JSON.stringify(o) + NL

function register(dir: string, name: string, status: string, sessionID = 'ses_a'): string {
  const runs = path.join(dir, '.opencode-runs')
  mkdirSync(path.join(runs, 'sessions'), { recursive: true })
  const log = path.join(runs, name + '.jsonl')
  writeFileSync(path.join(runs, 'sessions', name + '.json'), BOM + JSON.stringify({ sessionID, model: 'opencode-go/glm', status, log }))
  return log
}

function make(sessions: readonly { id: string; cwd: string }[]): { poll: () => Promise<void>; seen: WorkerInfo[][]; errors: string[] } {
  const seen: WorkerInfo[][] = []
  const errors: string[] = []
  const watcher = createWorkerWatcher({
    getSessions: () => sessions,
    onChange: (w) => seen.push([...w]),
    onError: (where) => errors.push(where),
    now: () => clock
  })
  return { poll: watcher.pollOnce, seen, errors }
}

describe('WorkerWatcher', () => {
  it('shows a running worker with its streamed lines, then its finish', async () => {
    const dir = path.join(root, 'proj')
    const { poll, seen } = make([{ id: 's1', cwd: dir }])
    clock += 10
    const log = register(dir, 'task1', 'running')
    writeFileSync(log, ev({ type: 'text', timestamp: clock, part: { text: 'hello' } }))
    await poll()
    const first = seen.at(-1)?.[0]
    expect(first).toMatchObject({ name: 'task1', status: 'running', ownerSessionIds: ['s1'], model: 'opencode-go/glm' })
    expect(first?.lines).toEqual([{ kind: 'text', text: 'hello' }])

    appendFileSync(log, ev({ type: 'step_finish', part: { cost: 0.5, tokens: { total: 9 } } }))
    register(dir, 'task1', 'ok')
    clock += 1000
    await poll()
    const last = seen.at(-1)?.[0]
    expect(last).toMatchObject({ status: 'done', costUsd: 0.5, tokens: 9 })
    expect(last?.finishedAt).not.toBeNull()
  })

  it('ignores runs that were already finished before the app started', async () => {
    const dir = path.join(root, 'old')
    register(dir, 'old', 'ok')
    clock += 60000
    const { poll, seen } = make([{ id: 's1', cwd: dir }])
    await poll()
    expect(seen.at(-1) ?? []).toHaveLength(0)
  })

  it('finds a registry in a parent folder of the session cwd', async () => {
    const proj = path.join(root, 'proj')
    const sub = path.join(proj, 'pkg')
    mkdirSync(sub, { recursive: true })
    const { poll, seen } = make([{ id: 's1', cwd: sub }])
    register(proj, 'up', 'running')
    await poll()
    expect(seen.at(-1)?.[0]?.name).toBe('up')
  })

  it('finds a registry in a subfolder of the session cwd (a batch run inside todo-prototypes)', async () => {
    const proj = path.join(root, 'proj')
    const child = path.join(proj, 'todo-prototypes')
    mkdirSync(child, { recursive: true })
    const { poll, seen } = make([{ id: 's1', cwd: proj }])
    register(child, 'todo-1', 'running')
    await poll()
    expect(seen.at(-1)?.[0]).toMatchObject({ name: 'todo-1', ownerSessionIds: ['s1'] })
  })

  it('does not report a worker no session looks at, and survives an unreadable registry', async () => {
    const dir = path.join(root, 'proj')
    const other = path.join(root, 'elsewhere')
    const { poll, seen, errors } = make([{ id: 's1', cwd: other }])
    register(dir, 'x', 'running')
    mkdirSync(path.join(other, '.opencode-runs', 'sessions'), { recursive: true })
    writeFileSync(path.join(other, '.opencode-runs', 'sessions', 'bad.json'), '{nope')
    await poll()
    expect(seen).toHaveLength(0)
    expect(errors).toEqual([])
  })

  it('drops a worker when its registration disappears', async () => {
    const dir = path.join(root, 'proj')
    const { poll, seen } = make([{ id: 's1', cwd: dir }])
    register(dir, 'gone', 'running')
    await poll()
    expect(seen.at(-1)).toHaveLength(1)
    rmSync(path.join(dir, '.opencode-runs', 'sessions', 'gone.json'))
    await poll()
    expect(seen.at(-1)).toHaveLength(0)
  })
})

describe('ownersByDir', () => {
  it('lists every session that can see a folder once', () => {
    const map = ownersByDir([
      { id: 'a', cwd: path.resolve('p', 'x') },
      { id: 'b', cwd: path.resolve('p', 'x') },
      { id: 'c', cwd: path.resolve('p', 'y') }
    ])
    expect(map.get(path.resolve('p', 'x').toLowerCase())?.owners).toEqual(['a', 'b'])
    expect(map.get(path.resolve('p').toLowerCase())?.owners).toEqual(['a', 'b', 'c'])
  })
})
