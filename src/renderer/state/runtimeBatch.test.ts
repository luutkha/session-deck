import { describe, expect, it } from 'vitest'
import type { RuntimeState } from '../../shared/types'
import { createRuntimeBatch } from './runtimeBatch'

function state(sessionId: string, exitCode: number | null = null): RuntimeState {
  return { sessionId, run: 'running', exitCode, attention: null }
}

function harness(intervalMs = 100) {
  const applied: RuntimeState[][] = []
  let nextHandle = 1
  const timers = new Map<number, () => void>()
  const batch = createRuntimeBatch<number>({
    apply: (states) => { applied.push([...states]) },
    intervalMs,
    setTimer: (callback) => { const handle = nextHandle; nextHandle += 1; timers.set(handle, callback); return handle },
    clearTimer: (handle) => { timers.delete(handle) }
  })
  /** Fires the (single) pending timer, like the interval ending. */
  const fire = (): void => {
    const [handle, callback] = [...timers.entries()][0] ?? []
    if (handle === undefined || callback === undefined) throw new Error('no timer is pending')
    timers.delete(handle)
    callback()
  }
  return { batch, applied, timers, fire }
}

describe('createRuntimeBatch', () => {
  it('applies the first event of a quiet period at once', () => {
    const { batch, applied } = harness()
    batch.push(state('a'))
    expect(applied).toEqual([[state('a')]])
  })

  it('collects the events of the interval and applies them together, the last state per session winning', () => {
    const { batch, applied, fire } = harness()
    batch.push(state('a'))
    batch.push(state('a', 1))
    batch.push(state('b'))
    batch.push(state('a', 2))
    expect(applied).toHaveLength(1)
    fire()
    expect(applied).toHaveLength(2)
    expect(applied[1]).toEqual([state('a', 2), state('b')])
  })

  it('keeps throttling while events keep coming and ends the interval when a tick finds nothing', () => {
    const { batch, applied, timers, fire } = harness()
    batch.push(state('a'))
    batch.push(state('b'))
    fire()
    expect(timers.size).toBe(1)
    batch.push(state('c'))
    fire()
    expect(applied.map((states) => states.map((s) => s.sessionId))).toEqual([['a'], ['b'], ['c']])
    fire()
    expect(timers.size).toBe(0)
    batch.push(state('d'))
    expect(applied[applied.length - 1]).toEqual([state('d')])
  })

  it('never applies an event twice', () => {
    const { batch, applied, fire } = harness()
    batch.push(state('a'))
    batch.push(state('b'))
    fire()
    fire()
    expect(applied.flat().map((s) => s.sessionId)).toEqual(['a', 'b'])
  })

  it('dispose drops pending events and cancels the timer', () => {
    const { batch, applied, timers } = harness()
    batch.push(state('a'))
    batch.push(state('b'))
    batch.dispose()
    expect(timers.size).toBe(0)
    expect(applied).toEqual([[state('a')]])
  })

  it('stays usable after dispose (a StrictMode / HMR remount reuses the same batch)', () => {
    const { batch, applied } = harness()
    batch.push(state('a'))
    batch.dispose()
    batch.push(state('c'))
    expect(applied).toEqual([[state('a')], [state('c')]])
  })
})
