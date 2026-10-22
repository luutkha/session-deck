import type { Id } from '../../shared/types'
import { CONTINUE_ENTER_DELAY_MS, CONTINUE_MAX_WAIT_MS, CONTINUE_QUIET_MS, CONTINUE_SUBMIT, CONTINUE_TEXT } from './autopilotPolicy'
import type { TimerHandle } from './autopilotTypes'

export interface ContinueDeps {
  readonly subscribeOutput: (callback: (id: Id) => void) => () => void
  readonly writeToSession: (id: Id, data: string) => void
  readonly setTimeout: (callback: () => void, ms: number) => TimerHandle
  readonly clearTimeout: (handle: TimerHandle) => void
  readonly onError: (where: string, error: unknown) => void
}

const WHERE = 'quota autopilot continue'

export interface ContinueOptions {
  /**
   * The session was not asleep (its process kept running after the limit cut the turn off): it is already idle, so the
   * quiet period starts right away. A freshly woken session waits for its first output instead (it is still starting).
   */
  readonly alreadyRunning?: boolean
}

/**
 * Types "continue" into a session once it has produced output and then stayed quiet for CONTINUE_QUIET_MS, which means
 * Claude is ready for input again. Presses Enter CONTINUE_ENTER_DELAY_MS later. Gives up after CONTINUE_MAX_WAIT_MS
 * (reported). Returns a cancel function.
 */
export function scheduleContinue(deps: ContinueDeps, id: Id, options: ContinueOptions = {}): () => void {
  let done = false
  let unsubscribe: (() => void) | null = null
  let quietTimer: TimerHandle | null = null
  let maxTimer: TimerHandle | null = null

  function finish(): void {
    done = true
    unsubscribe?.()
    unsubscribe = null
    if (quietTimer !== null) deps.clearTimeout(quietTimer)
    if (maxTimer !== null) deps.clearTimeout(maxTimer)
    quietTimer = null
    maxTimer = null
  }

  function submit(): void {
    try {
      deps.writeToSession(id, CONTINUE_TEXT)
    } catch (error) {
      deps.onError(WHERE, error)
      return
    }
    deps.setTimeout(() => {
      try {
        deps.writeToSession(id, CONTINUE_SUBMIT)
      } catch (error) {
        deps.onError(WHERE, error)
      }
    }, CONTINUE_ENTER_DELAY_MS)
  }

  function restartQuiet(): void {
    if (quietTimer !== null) deps.clearTimeout(quietTimer)
    quietTimer = deps.setTimeout(() => {
      finish()
      submit()
    }, CONTINUE_QUIET_MS)
  }

  unsubscribe = deps.subscribeOutput((outputId: Id) => {
    if (done || outputId !== id) return
    restartQuiet()
  })
  if (options.alreadyRunning === true) restartQuiet()
  maxTimer = deps.setTimeout(() => {
    maxTimer = null
    finish()
    deps.onError(WHERE, new Error(`session ${id} gave no quiet output within ${CONTINUE_MAX_WAIT_MS} ms`))
  }, CONTINUE_MAX_WAIT_MS)

  return () => {
    if (!done) finish()
  }
}
