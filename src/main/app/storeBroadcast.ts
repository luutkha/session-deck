// Coalesced store broadcasts: a store change sends the whole `StoreData` to every window, so a burst of
// changes (notes, status, rename...) must not cost one full send per change. Leading + trailing throttle:
// the first change of a quiet period goes out at once, later ones at most once per interval, with the
// latest state read at send time (never a snapshot captured when notify() was called).
// Timers come in through deps so tests drive them by hand.

export interface CoalescedBroadcast {
  /** A store change happened: send now on the leading edge, or mark the running interval dirty. */
  notify: () => void
  /** Stops the interval; nothing is sent after this call. */
  dispose: () => void
}

export interface CoalescedBroadcastDeps<T, Handle> {
  readonly send: (value: T) => void
  /** Read at send time, so a trailing send carries the state as it is when the timer fires. */
  readonly getLatest: () => T
  readonly intervalMs: number
  readonly setTimer: (callback: () => void, milliseconds: number) => Handle
  readonly clearTimer: (handle: Handle) => void
}

export function createCoalescedBroadcast<T, Handle = ReturnType<typeof setTimeout>>(
  deps: CoalescedBroadcastDeps<T, Handle>
): CoalescedBroadcast {
  let timer: Handle | null = null
  let dirty = false
  let disposed = false

  const onInterval = (): void => {
    timer = null
    if (disposed || !dirty) return
    dirty = false
    // Schedule before sending: a send that synchronously causes another change then marks the next
    // interval dirty instead of replacing (and leaking) this handle.
    timer = deps.setTimer(onInterval, deps.intervalMs)
    deps.send(deps.getLatest())
  }

  const notify = (): void => {
    if (disposed) return
    if (timer !== null) {
      dirty = true
      return
    }
    timer = deps.setTimer(onInterval, deps.intervalMs)
    deps.send(deps.getLatest())
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    dirty = false
    if (timer !== null) {
      deps.clearTimer(timer)
      timer = null
    }
  }

  return { notify, dispose }
}
