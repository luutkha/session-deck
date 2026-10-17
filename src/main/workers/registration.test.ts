import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { candidateDirs, parseRegistration, runPhase, STALE_RUNNING_MS } from './registration'

const runs = path.resolve('proj', '.opencode-runs')
const BOM = String.fromCharCode(0xfeff)
const reg = (o: Record<string, unknown>): string =>
  BOM + JSON.stringify({ sessionID: 'ses_1', model: 'm/x', status: 'running', log: path.join(runs, 'a.jsonl'), ...o })

describe('parseRegistration', () => {
  it('reads a BOM-prefixed file', () => {
    expect(parseRegistration(reg({}), runs)).toEqual({ sessionID: 'ses_1', model: 'm/x', status: 'running', log: path.join(runs, 'a.jsonl') })
  })
  it('rejects missing fields, bad json and logs outside the runs folder', () => {
    expect(parseRegistration('{', runs)).toBeNull()
    expect(parseRegistration(reg({ sessionID: undefined }), runs)).toBeNull()
    expect(parseRegistration(reg({ log: path.resolve('elsewhere', 'x.jsonl') }), runs)).toBeNull()
    expect(parseRegistration(reg({ log: path.join(runs, '..', 'secret.txt') }), runs)).toBeNull()
  })
})

describe('runPhase', () => {
  const base = { sessionID: 's', model: 'm', log: 'l' }
  it('running while fresh, stalled when stale', () => {
    expect(runPhase({ ...base, status: 'running' }, 1000, 1000 + 5000).status).toBe('running')
    expect(runPhase({ ...base, status: 'running' }, 1000, 1000 + STALE_RUNNING_MS + 1)).toEqual({ status: 'failed', detail: 'stalled' })
  })
  it('maps ok to done and everything else to failed with the detail', () => {
    expect(runPhase({ ...base, status: 'ok' }, 0, 0).status).toBe('done')
    expect(runPhase({ ...base, status: 'rate-limited' }, 0, 0)).toEqual({ status: 'failed', detail: 'rate-limited' })
  })
})

describe('candidateDirs', () => {
  it('returns the folder and two parents', () => {
    const dirs = candidateDirs(path.resolve('a', 'b', 'c', 'd'))
    expect(dirs).toEqual([path.resolve('a', 'b', 'c', 'd'), path.resolve('a', 'b', 'c'), path.resolve('a', 'b')])
  })
  it('stops at the filesystem root', () => {
    const root = path.parse(process.cwd()).root
    expect(candidateDirs(root)).toEqual([root])
  })
})
