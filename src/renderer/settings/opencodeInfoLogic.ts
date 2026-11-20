// Pure formatting for the OpenCode probe row in Settings > Agents (D74). No DOM, no IPC.

import type { OpencodeInfo } from '../../shared/types'

export const OPENCODE_CHECKING_TEXT = 'Checking...'
export const OPENCODE_NOT_CHECKED_TEXT = 'not checked yet'
export const OPENCODE_OLDER_HINT = 'This OpenCode is older: SessionDeck starts it without --standalone.'

/** The version/flags half of the row: "v2.1.4 · --standalone supported" (or "Checking..." while a probe runs). */
export function opencodeStatusText(info: OpencodeInfo): string {
  if (info.probing) return OPENCODE_CHECKING_TEXT
  const version = info.version === null ? 'version unknown' : `v${info.version}`
  const flag = info.supportsStandalone ? 'supported' : 'not supported'
  return `${version} · --standalone ${flag}`
}

/** How old the answer is: "checked just now", "checked 3 min ago", "not checked yet" (`checkedAt` 0). */
export function opencodeAgeText(checkedAt: number, now: number): string {
  if (!Number.isFinite(checkedAt) || checkedAt <= 0) return OPENCODE_NOT_CHECKED_TEXT
  const seconds = Math.max(0, Math.floor((now - checkedAt) / 1000))
  if (seconds < 60) return 'checked just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `checked ${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `checked ${hours} h ago`
  return `checked ${Math.floor(hours / 24)} d ago`
}

/** The one-line hint, only for an older OpenCode (and never while a probe is running). */
export function opencodeHint(info: OpencodeInfo): string | null {
  return !info.probing && !info.supportsStandalone ? OPENCODE_OLDER_HINT : null
}
