export interface IdleDetectorTimers {
  set: (fn: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}

export interface IdleDetectorOptions {
  readonly idleMs?: number
  readonly onIdle: (id: string) => void
  readonly timers?: IdleDetectorTimers
}

export interface IdleDetector {
  noteOutput(id: string): void
  noteInput(id: string): void
  forget(id: string): void
}

interface SessionState {
  idleHandle: unknown | null
  hasPendingOutput: boolean
}

const defaultTimers: IdleDetectorTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

export function createIdleDetector(options: IdleDetectorOptions): IdleDetector {
  const { idleMs = 4000, onIdle, timers = defaultTimers } = options
  const sessions = new Map<string, SessionState>()

  function getState(id: string): SessionState {
    let state = sessions.get(id)
    if (!state) {
      state = { idleHandle: null, hasPendingOutput: false }
      sessions.set(id, state)
    }
    return state
  }

  function clearIdleHandle(state: SessionState): void {
    if (state.idleHandle !== null) {
      timers.clear(state.idleHandle)
      state.idleHandle = null
    }
  }

  function scheduleIdle(id: string): void {
    const state = getState(id)
    clearIdleHandle(state)
    state.idleHandle = timers.set(() => {
      state.idleHandle = null
      state.hasPendingOutput = false
      onIdle(id)
    }, idleMs)
  }

  return {
    noteOutput(id: string): void {
      const state = getState(id)
      if (!state.hasPendingOutput) {
        state.hasPendingOutput = true
        scheduleIdle(id)
      }
      // If we already have pending output, we don't reschedule
      // The idle timer will fire after the last output stops
    },

    noteInput(id: string): void {
      const state = getState(id)
      clearIdleHandle(state)
      state.hasPendingOutput = false
    },

    forget(id: string): void {
      const state = sessions.get(id)
      if (state) {
        clearIdleHandle(state)
        sessions.delete(id)
      }
    }
  }
}