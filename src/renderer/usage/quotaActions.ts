import { resolveSettings, type Id, type StoreData } from '../../shared/types'

/** The slice of `window.api` the quota toasts and the held chip call. */
export interface QuotaActionApi {
  quotaSleepIdle(): Promise<readonly Id[]>
  quotaWake(options: { readonly sendContinue: boolean }): Promise<readonly Id[]>
  getStore(): Promise<{ readonly data: StoreData }>
}

export type QuotaActionResult =
  | { readonly ok: true; readonly ids: readonly Id[] }
  | { readonly ok: false; readonly message: string }

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function idsOf(value: unknown): readonly Id[] {
  return Array.isArray(value) ? (value as readonly Id[]) : []
}

async function runAction(
  verb: string,
  call: () => Promise<readonly Id[]>
): Promise<QuotaActionResult> {
  try {
    return { ok: true, ids: idsOf(await call()) }
  } catch (error: unknown) {
    const message = toMessage(error)
    console.error(`Quota autopilot: could not ${verb} sessions`, error)
    return { ok: false, message: `Could not ${verb} sessions: ${message}` }
  }
}

/** Sleeps the idle sessions now. A rejected call (or a missing API) becomes an error result. */
export function sleepIdleSessions(api: QuotaActionApi): Promise<QuotaActionResult> {
  return runAction('sleep', () => api.quotaSleepIdle())
}

/** Wakes the sessions the autopilot holds for the reset. */
export function wakeSessions(api: QuotaActionApi, sendContinue: boolean): Promise<QuotaActionResult> {
  return runAction('wake', () => api.quotaWake({ sendContinue }))
}

/**
 * The saved "type continue on wake" setting. Failing to read it falls back to false
 * (the safe default: nothing is typed into a session the user did not ask for).
 */
export async function readContinueOnWake(api: QuotaActionApi): Promise<boolean> {
  try {
    const { data } = await api.getStore()
    return resolveSettings(data.settings).quota.continueOnWake
  } catch (error: unknown) {
    console.error('Quota autopilot: could not read the continue-on-wake setting', error)
    return false
  }
}
