import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { scheduleContinue, type ContinueDeps } from './autopilotContinue'
import { CONTINUE_ENTER_DELAY_MS, CONTINUE_MAX_WAIT_MS, CONTINUE_QUIET_MS } from './autopilotPolicy'

interface Harness {
  readonly deps: ContinueDeps
  readonly writes: Array<[string, string]>
  readonly onError: ReturnType<typeof vi.fn>
  readonly onGiveUp: ReturnType<typeof vi.fn>
  readonly unsubscribe: ReturnType<typeof vi.fn>
  readonly errorsOrder: string[]
  emit(id: string): void
  listenerCount(): number
}

function harness(writeToSession = (): void => {}): Harness {
  const listeners = new Set<(id: string) => void>()
  const writes: Array<[string, string]> = []
  const onError = vi.fn()
  const onGiveUp = vi.fn()
  const errorsOrder: string[] = []
  const unsubscribe = vi.fn()
  return {
    deps: {
      subscribeOutput: (callback) => {
        listeners.add(callback)
        return () => {
          unsubscribe()
          listeners.delete(callback)
        }
      },
      writeToSession: (id, data) => {
        writes.push([id, data])
        writeToSession()
      },
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle),
      onError: (where, error) => {
        onError(where, error)
        errorsOrder.push('onError')
      },
      onGiveUp: (id) => {
        onGiveUp(id)
        errorsOrder.push('giveUp')
      }
    },
    writes,
    onError,
    onGiveUp,
    unsubscribe,
    errorsOrder,
    emit(id: string): void {
      for (const listener of [...listeners]) listener(id)
    },
    listenerCount(): number {
      return listeners.size
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('scheduleContinue', () => {
  it('types "continue" after output and CONTINUE_QUIET_MS of silence, then Enter', () => {
    const h = harness()
    scheduleContinue(h.deps, 's1')
    h.emit('s1')
    vi.advanceTimersByTime(CONTINUE_QUIET_MS - 1)
    expect(h.writes).toEqual([])
    vi.advanceTimersByTime(1)
    expect(h.writes).toEqual([['s1', 'continue']])
    vi.advanceTimersByTime(CONTINUE_ENTER_DELAY_MS)
    expect(h.writes).toEqual([['s1', 'continue'], ['s1', '\r']])
  })

  it('types "continue" into an already running, quiet session without waiting for new output', () => {
    const h = harness()
    scheduleContinue(h.deps, 's1', { alreadyRunning: true })
    vi.advanceTimersByTime(CONTINUE_QUIET_MS)
    expect(h.writes).toEqual([['s1', 'continue']])
  })

  it('waits for the first output of a freshly woken session (no early typing while it starts)', () => {
    const h = harness()
    scheduleContinue(h.deps, 's1')
    vi.advanceTimersByTime(CONTINUE_QUIET_MS * 3)
    expect(h.writes).toEqual([])
  })

  it('restarts the quiet period with every new output chunk', () => {
    const h = harness()
    scheduleContinue(h.deps, 's1')
    h.emit('s1')
    vi.advanceTimersByTime(2000)
    h.emit('s1')
    vi.advanceTimersByTime(CONTINUE_QUIET_MS - 1)
    expect(h.writes).toEqual([])
    vi.advanceTimersByTime(1)
    expect(h.writes[0]).toEqual(['s1', 'continue'])
  })

  it('ignores output from other sessions', () => {
    const h = harness()
    scheduleContinue(h.deps, 's1')
    h.emit('other')
    vi.advanceTimersByTime(CONTINUE_MAX_WAIT_MS - 1)
    expect(h.writes).toEqual([])
  })

  it('gives up after CONTINUE_MAX_WAIT_MS when the session never produces output', () => {
    const h = harness()
    scheduleContinue(h.deps, 's1')
    vi.advanceTimersByTime(CONTINUE_MAX_WAIT_MS)
    expect(h.writes).toEqual([])
    expect(h.onError).toHaveBeenCalledWith('quota autopilot continue', expect.any(Error))
    expect(h.unsubscribe).toHaveBeenCalled()
  })

  it('reports the give-up through onGiveUp (the notice path) once, before onError', () => {
    const h = harness()
    scheduleContinue(h.deps, 's1')
    vi.advanceTimersByTime(CONTINUE_MAX_WAIT_MS)
    expect(h.onGiveUp).toHaveBeenCalledTimes(1)
    expect(h.onGiveUp).toHaveBeenCalledWith('s1')
    expect(h.errorsOrder).toEqual(['giveUp', 'onError'])
  })

  it('stops listening once it has sent "continue"', () => {
    const h = harness()
    scheduleContinue(h.deps, 's1')
    h.emit('s1')
    vi.advanceTimersByTime(CONTINUE_QUIET_MS)
    h.emit('s1')
    vi.advanceTimersByTime(CONTINUE_ENTER_DELAY_MS + CONTINUE_MAX_WAIT_MS)
    expect(h.writes).toHaveLength(2)
    expect(h.onError).not.toHaveBeenCalled()
  })

  it('sends nothing after it is cancelled', () => {
    const h = harness()
    const cancel = scheduleContinue(h.deps, 's1')
    h.emit('s1')
    cancel()
    vi.advanceTimersByTime(CONTINUE_MAX_WAIT_MS * 2)
    expect(h.writes).toEqual([])
    expect(h.listenerCount()).toBe(0)
  })

  it('reports a failed "continue" write and does not press Enter after it', () => {
    const boom = new Error('pty gone')
    const h = harness(() => {
      throw boom
    })
    scheduleContinue(h.deps, 's1')
    h.emit('s1')
    vi.advanceTimersByTime(CONTINUE_QUIET_MS + CONTINUE_ENTER_DELAY_MS)
    expect(h.onError).toHaveBeenCalledWith('quota autopilot continue', boom)
    expect(h.writes).toEqual([['s1', 'continue']])
  })
})
