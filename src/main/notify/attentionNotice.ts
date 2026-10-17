import type { AttentionReason } from '../../shared/types'

export const MAX_ACTIVITY_CHARS = 160

export interface AttentionNotice {
  readonly title: string
  readonly body: string
}

export interface AttentionNoticeInput {
  readonly name: string
  readonly reason: AttentionReason
  readonly activityMessage?: string | null
}

const FALLBACK_TITLE = 'Claude session'

function clip(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}...`
}

/**
 * The desktop notification for an attention raise, or null when the reason is not worth one.
 * Only "permission" and "done" notify; "idle" and "bell" stay in-app.
 */
export function attentionNotice(input: AttentionNoticeInput): AttentionNotice | null {
  const title = input.name.trim() === '' ? FALLBACK_TITLE : input.name.trim()

  if (input.reason === 'done') {
    return { title, body: 'Finished, waiting for you' }
  }
  if (input.reason === 'permission') {
    const message = (input.activityMessage ?? '').trim()
    const body = message === ''
      ? 'Needs your permission'
      : `Needs your permission: ${clip(message, MAX_ACTIVITY_CHARS)}`
    return { title, body }
  }
  return null
}
