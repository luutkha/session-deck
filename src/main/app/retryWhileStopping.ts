/** Message prefix thrown by the session controller while a killed process has not exited yet. */
export const STOPPING_ERROR_PREFIX = 'Session is still stopping'

const DEFAULT_ATTEMPTS = 20
const DEFAULT_DELAY_MS = 150

export interface RetryOptions {
  readonly attempts?: number
  readonly delayMs?: number
  readonly sleep?: (ms: number) => Promise<void>
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isStoppingError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(STOPPING_ERROR_PREFIX)
}

/**
 * Runs `action`, retrying only while it fails with the "still stopping" error (a killed process needs a
 * moment to exit before the session can be started again). Any other error is rethrown immediately;
 * after the last attempt the stopping error itself is rethrown, never swallowed.
 */
export async function retryWhileStopping(action: () => void, options: RetryOptions = {}): Promise<void> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS
  const sleep = options.sleep ?? defaultSleep

  for (let attempt = 1; ; attempt += 1) {
    try {
      action()
      return
    } catch (error) {
      if (!isStoppingError(error) || attempt >= attempts) {
        throw error
      }
      await sleep(delayMs)
    }
  }
}
