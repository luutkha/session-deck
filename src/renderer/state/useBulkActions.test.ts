import { describe, expect, it } from 'vitest'
import type { RuntimeState } from '../../shared/types'
import { partitionSleepWake } from './useBulkActions'

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
