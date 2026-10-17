/**
 * A tiny debounced-saver helper. The scheduling decision is isolated here (with injectable timers)
 * so the React hook stays free of timer bookkeeping and this logic is unit-testable without a DOM.
 */

export interface DebounceTimers {
  readonly setTimeout: (handler: () => void, ms: number) => number
  readonly clearTimeout: (handle: number) => void
}

export interface DebouncedSaver<T> {
  /** Stores `value` and (re)starts the delay. Only the latest value ever fires. */
  schedule(value: T): void
  /** Fires immediately with the pending value (if any) and cancels the timer. Returns the fired value. */
  flush(): T | null
  /** Drops the pending value and cancels the timer. */
  cancel(): void
  /** True while a value is waiting for the delay to elapse. */
  hasPending(): boolean
}

const defaultTimers: DebounceTimers = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms) as unknown as number,
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle)
  }
}

/**
 * Creates a debounced saver. `T` must not be nullable (null is used internally to mean "nothing
 * pending"). `onFire` runs synchronously when the delay elapses or when `flush` is called.
 */
export function createDebouncedSaver<T>(
  delayMs: number,
  onFire: (value: T) => void,
  timers: DebounceTimers = defaultTimers
): DebouncedSaver<T> {
  let handle: number | null = null
  let pending: { readonly value: T } | null = null

  function clearTimer(): void {
    if (handle !== null) {
      timers.clearTimeout(handle)
      handle = null
    }
  }

  function take(): T | null {
    if (pending === null) return null
    const value = pending.value
    pending = null
    return value
  }

  function fire(): void {
    handle = null
    const value = take()
    if (value !== null) onFire(value)
  }

  return {
    schedule(value: T): void {
      pending = { value }
      clearTimer()
      handle = timers.setTimeout(fire, delayMs)
    },
    flush(): T | null {
      clearTimer()
      const value = take()
      if (value !== null) onFire(value)
      return value
    },
    cancel(): void {
      clearTimer()
      pending = null
    },
    hasPending(): boolean {
      return pending !== null
    }
  }
}
