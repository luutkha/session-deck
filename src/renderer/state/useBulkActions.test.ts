import { describe, expect, it } from 'vitest'
import type { RuntimeState } from '../../shared/types'
import { bulkMoveToCode, bulkMoveToCodeSummary, partitionSleepWake } from './useBulkActions'

function state(sessionId: string, extra: Partial<RuntimeState>): RuntimeState {
  return { sessionId, run: 'running', attention: null, ...extra } as RuntimeState
}

describe('partitionSleepWake', () => {
  it('puts running sessions under Sleep and sleeping ones under Wake, in selection order', () => {
    const runtime = new Map([
      ['a', state('a', { run: 'running' })],
      ['b', state('b', { run: 'exited', sleeping: true })],
      ['c', state('c', { run: 'running' })],
      ['d', state('d', { run: 'exited' })]
    ])
    expect(partitionSleepWake(['c', 'b', 'a', 'd', 'missing'], runtime)).toEqual({
      sleepIds: ['c', 'a'],
      wakeIds: ['b']
    })
  })

  it('a session flagged sleeping is never also offered Sleep', () => {
    const runtime = new Map([['a', state('a', { run: 'running', sleeping: true })]])
    expect(partitionSleepWake(['a'], runtime)).toEqual({ sleepIds: [], wakeIds: ['a'] })
  })
})

describe('bulkMoveToCode (D89 follow-up moves)', () => {
  it('moves one after another in order and keeps going past a failure', async () => {
    const calls: string[] = []
    const outcome = await bulkMoveToCode(['a', 'b', 'c'], 'w1', async (id, worktreeId): Promise<void> => {
      expect(worktreeId).toBe('w1')
      calls.push(id)
      if (id === 'b') throw new Error('no such session')
    })
    expect(calls).toEqual(['a', 'b', 'c'])
    expect(outcome).toEqual({ moved: ['a', 'c'], failed: ['b'] })
  })

  it('does nothing for an empty list', async () => {
    expect(await bulkMoveToCode([], 'w1', async (): Promise<void> => undefined)).toEqual({ moved: [], failed: [] })
  })
})

describe('bulkMoveToCodeSummary (D89)', () => {
  it('reports the count alone when everything moved', () => {
    expect(bulkMoveToCodeSummary({ moved: ['a', 'b'], failed: [] })).toBe('Moved 2 sessions to Code mode')
    expect(bulkMoveToCodeSummary({ moved: ['a'], failed: [] })).toBe('Moved 1 session to Code mode')
  })

  it('names the failed ids', () => {
    expect(bulkMoveToCodeSummary({ moved: ['a'], failed: ['b', 'c'] })).toBe('Moved 1 session to Code mode; failed: b, c')
  })
})
