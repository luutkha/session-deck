import type { HookEvent, SessionActivity } from '../../shared/types'

/** Activity as the runtime registry stores it (`activity` null = unknown or reset). */
export interface ActivitySnapshot {
  readonly activity: SessionActivity | null
  readonly message: string | null
}

export const NO_ACTIVITY: ActivitySnapshot = { activity: null, message: null }

/**
 * Pure rule: the activity a Claude Code hook event means.
 * UserPromptSubmit -> working (message cleared); Notification -> needs-input with the hook message (or null);
 * Stop -> finished (message cleared). Unknown events keep the previous snapshot.
 */
export function activityFromHook(event: HookEvent, previous: ActivitySnapshot): ActivitySnapshot {
  switch (event.event) {
    case 'UserPromptSubmit':
      return { activity: 'working', message: null }
    case 'Notification':
      return { activity: 'needs-input', message: event.message ?? null }
    case 'Stop':
      return { activity: 'finished', message: null }
    default:
      return previous
  }
}
