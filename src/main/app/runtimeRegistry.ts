import type { Id, RuntimeState, AttentionReason, SessionActivity } from '../../shared/types'

type Listener = (state: RuntimeState) => void

function createInitialState(sessionId: Id): RuntimeState {
  return {
    sessionId,
    run: 'exited',
    exitCode: null,
    attention: null
  }
}

/** A (re)start or an exit ends whatever Claude was doing: activity becomes null (unknown) again. */
function withoutActivity(state: RuntimeState): RuntimeState {
  const { activityAt: _activityAt, ...rest } = state
  return { ...rest, activity: null, activityMessage: null }
}

/** A (re)start or a real exit ends sleep; the emitted state must omit the field (not set it to false). */
function withoutSleeping(state: RuntimeState): RuntimeState {
  const { sleeping: _sleeping, ...rest } = state
  return withoutRemoteControl(rest)
}

/** Remote Control belongs to one running process: a (re)start, exit or sleep ends it until the footer shows it again. */
function withoutRemoteControl(state: RuntimeState): RuntimeState {
  const { remoteControl: _remoteControl, ...rest } = state
  return rest
}

export interface RuntimeRegistry {
  markRunning(id: Id): void
  markExited(id: Id, code: number | null): void
  /** Stops the session without a crash: run becomes 'exited' (null code), sleeping true, attention kept. */
  markSleeping(id: Id): void
  setAttention(id: Id, reason: AttentionReason | null): void
  /** Marks whether the running process has Remote Control active; a no-op when unchanged. */
  setRemoteControl(id: Id, active: boolean): void
  /** Sets the Claude activity of a session. `at` is epoch ms of the change. */
  setActivity(id: Id, activity: SessionActivity | null, message: string | null, at: number): void
  forget(id: Id): void
  get(id: Id): RuntimeState | undefined
  snapshot(): readonly RuntimeState[]
  subscribe(listener: Listener): () => void
}

export function createRuntimeRegistry(now: () => number = Date.now): RuntimeRegistry {
  const states = new Map<Id, RuntimeState>()
  const listeners = new Set<Listener>()

  function emit(state: RuntimeState): void {
    for (const listener of listeners) {
      listener(state)
    }
  }

  function getOrCreate(id: Id): RuntimeState {
    const existing = states.get(id)
    if (existing !== undefined) {
      return existing
    }
    const initial = createInitialState(id)
    states.set(id, initial)
    return initial
  }

  return {
    markRunning(id: Id): void {
      const state = getOrCreate(id)
      const next: RuntimeState = withoutSleeping(withoutActivity({ ...state, run: 'running', exitCode: null }))
      states.set(id, next)
      emit(next)
    },

    markExited(id: Id, code: number | null): void {
      const state = getOrCreate(id)
      const next: RuntimeState = withoutSleeping(withoutActivity({ ...state, run: 'exited', exitCode: code }))
      states.set(id, next)
      emit(next)
    },

    markSleeping(id: Id): void {
      const state = getOrCreate(id)
      const next: RuntimeState = {
        ...withoutRemoteControl(withoutActivity(state)),
        run: 'exited',
        exitCode: null,
        sleeping: true
      }
      states.set(id, next)
      emit(next)
    },

    setAttention(id: Id, reason: AttentionReason | null): void {
      const state = getOrCreate(id)
      if (state.attention === reason) {
        return
      }
      const { attentionAt: _attentionAt, ...rest } = state
      const next: RuntimeState = reason === null
        ? { ...rest, attention: null }
        : { ...rest, attention: reason, attentionAt: now() }
      states.set(id, next)
      emit(next)
    },

    setRemoteControl(id: Id, active: boolean): void {
      const state = getOrCreate(id)
      if ((state.remoteControl === true) === active) {
        return
      }
      const next: RuntimeState = active ? { ...state, remoteControl: true } : withoutRemoteControl(state)
      states.set(id, next)
      emit(next)
    },

    setActivity(id: Id, activity: SessionActivity | null, message: string | null, at: number): void {
      const state = getOrCreate(id)
      const next: RuntimeState = {
        ...state,
        activity,
        activityMessage: message,
        activityAt: at
      }
      states.set(id, next)
      emit(next)
    },

    forget(id: Id): void {
      states.delete(id)
      emit(createInitialState(id))
    },

    get(id: Id): RuntimeState | undefined {
      return states.get(id)
    },

    snapshot(): readonly RuntimeState[] {
      return Array.from(states.values())
    },

    subscribe(listener: Listener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
