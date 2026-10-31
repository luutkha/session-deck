// Prompt queue (D47): prompts the user lined up for a session are typed in one at a time, each when the session's
// current turn finishes (activity becomes 'finished': the Claude Stop hook or the OpenCode plugin's Stop).
import type { Id, QueuedPrompt, RuntimeState, Session, StoreData } from '../../shared/types'

/** Enter follows the text after this pause, so the TUI takes the text as one input and then submits it (autopilot too). */
export const QUEUE_ENTER_DELAY_MS = 300
/**
 * After a prompt is typed, nothing else is sent until the session reports a new turn (working / needs-input) or this
 * long has passed. Without it, a second prompt added while the first one is still "finished" would go out at once.
 */
export const QUEUE_SENT_GUARD_MS = 30_000

type Timer = ReturnType<typeof setTimeout>

export interface PromptQueueDeps {
  readonly getData: () => StoreData
  readonly setQueue: (id: Id, items: readonly QueuedPrompt[]) => void
  readonly getRuntime: (id: Id) => RuntimeState | undefined
  readonly subscribeRuntime: (listener: (state: RuntimeState) => void) => () => void
  /** Types into the session's pty (the controller's writeToPty: no-op for an unknown or stopped session). */
  readonly write: (id: Id, data: string) => void
  readonly setTimeout: (callback: () => void, ms: number) => Timer
  readonly clearTimeout: (timer: Timer) => void
  readonly onError: (where: string, error: unknown) => void
}

export interface PromptQueue {
  /** The session's queue was replaced: if the session is idle right now, its first prompt goes out at once. */
  onQueueChanged(id: Id): void
  /** Types one queued prompt now and drops it from the queue. Throws when the session cannot take typing. */
  sendNow(id: Id, promptId: string): void
  stop(): void
}

/** True when SessionDeck may type into the session: an open, running, awake Claude or OpenCode session. */
export function canTypeInto(session: Session | undefined, state: RuntimeState | undefined): boolean {
  if (session === undefined || session.closedAt !== undefined || session.agent === 'shell') return false
  return state?.run === 'running' && state.sleeping !== true
}

/** The text exactly as typed: CRLF/CR become LF so only the separate Enter submits. */
export function queuedText(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

export function createPromptQueue(deps: PromptQueueDeps): PromptQueue {
  const lastActivity = new Map<Id, RuntimeState['activity']>()
  const awaitingTurn = new Map<Id, Timer>()

  function findSession(id: Id): Session | undefined {
    return deps.getData().sessions.find((s) => s.id === id)
  }

  function clearAwaiting(id: Id): void {
    const timer = awaitingTurn.get(id)
    if (timer === undefined) return
    deps.clearTimeout(timer)
    awaitingTurn.delete(id)
  }

  function type(id: Id, prompt: QueuedPrompt): void {
    clearAwaiting(id)
    awaitingTurn.set(id, deps.setTimeout(() => awaitingTurn.delete(id), QUEUE_SENT_GUARD_MS))
    deps.write(id, queuedText(prompt.text))
    deps.setTimeout(() => {
      try {
        deps.write(id, '\r')
      } catch (error) {
        deps.onError('prompt queue enter', error)
      }
    }, QUEUE_ENTER_DELAY_MS)
  }

  function trySendNext(id: Id): void {
    if (awaitingTurn.has(id)) return
    const session = findSession(id)
    const state = deps.getRuntime(id)
    if (!canTypeInto(session, state) || state?.activity !== 'finished') return
    const queue = session?.queue ?? []
    const [next, ...rest] = queue
    if (next === undefined) return
    deps.setQueue(id, rest)
    type(id, next)
  }

  const unsubscribe = deps.subscribeRuntime((state) => {
    const id = state.sessionId
    try {
      const previous = lastActivity.get(id)
      const activity = state.activity ?? null
      lastActivity.set(id, activity)
      // The typed prompt started a turn (or the process stopped): the guard has done its job.
      if (activity === 'working' || activity === 'needs-input' || state.run !== 'running' || state.sleeping === true) {
        clearAwaiting(id)
      }
      if (activity === 'finished' && previous !== 'finished') trySendNext(id)
    } catch (error) {
      deps.onError('prompt queue', error)
    }
  })

  return {
    onQueueChanged(id: Id): void {
      try {
        trySendNext(id)
      } catch (error) {
        deps.onError('prompt queue', error)
      }
    },

    sendNow(id: Id, promptId: string): void {
      const session = findSession(id)
      if (!canTypeInto(session, deps.getRuntime(id))) {
        throw new Error('The session is not running. Wake or reopen it first.')
      }
      const queue = session?.queue ?? []
      const prompt = queue.find((item) => item.id === promptId)
      if (prompt === undefined) throw new Error('That prompt is no longer in the queue.')
      deps.setQueue(id, queue.filter((item) => item.id !== promptId))
      type(id, prompt)
    },

    stop(): void {
      unsubscribe()
      for (const timer of awaitingTurn.values()) deps.clearTimeout(timer)
      awaitingTurn.clear()
      lastActivity.clear()
    }
  }
}
