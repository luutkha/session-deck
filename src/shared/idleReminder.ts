// Claude Code's idle reminder, shared by main (prompt queue, Jarvis) and the renderer (D61 attention sort).

const IDLE_REMINDER_RE = /waiting for your input/i

/**
 * Claude Code's reminder after about a minute without input ("Claude is waiting for your input") also arrives as a
 * Notification, so the activity says needs-input although nothing is asked. Typing a prompt is safe then (D54).
 */
export function isIdleReminder(message: string | null | undefined): boolean {
  return typeof message === 'string' && IDLE_REMINDER_RE.test(message)
}
