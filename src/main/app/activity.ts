import type { HookEvent, SessionActivity } from '../../shared/types'

/** Activity as the runtime registry stores it (`activity` null = unknown or reset). */
export interface ActivitySnapshot {
  readonly activity: SessionActivity | null
  readonly message: string | null
}

export const NO_ACTIVITY: ActivitySnapshot = { activity: null, message: null }

const IDLE_REMINDER_RE = /waiting for your input/i

/**
 * Claude Code's reminder after about a minute without input ("Claude is waiting for your input") also arrives as a
 * Notification, so the activity says needs-input although nothing is asked. Typing a prompt is safe then (D54).
 */
export function isIdleReminder(message: string | null | undefined): boolean {
  return typeof message === 'string' && IDLE_REMINDER_RE.test(message)
}

/** The session waits for a new prompt: its turn finished, or only the idle reminder came since. */
export function isReadyForPrompt(activity: SessionActivity | null | undefined, message: string | null | undefined): boolean {
  return activity === 'finished' || (activity === 'needs-input' && isIdleReminder(message))
}

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
