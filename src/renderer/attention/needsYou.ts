// Pure model of the "needs you" bell (D22): which sessions show it, their reason text and the list order.
import type { AttentionReason, Id, RuntimeState, Session } from '../../shared/types'

export interface NeedsYouItem {
  readonly id: Id
  readonly name: string
  readonly cwd: string
  readonly reason: AttentionReason
  /** Epoch ms when the bell was raised; null when unknown. */
  readonly at: number | null
}

/** What the bell means, in the user's words (tooltips, the list, aria labels). */
export function needsYouReasonText(reason: AttentionReason): string {
  switch (reason) {
    case 'permission':
      return 'Needs permission or an answer'
    case 'done':
      return 'Finished, waiting for you'
    case 'idle':
      return 'Waiting for you'
    case 'bell':
      return 'Terminal bell'
    case 'unread':
      return 'Marked unread'
  }
}

/** Open (not closed) sessions with a bell, newest bell first; a bell without a time sorts last, then by name. */
export function needsYouItems(
  sessions: readonly Session[],
  runtime: ReadonlyMap<Id, RuntimeState>
): readonly NeedsYouItem[] {
  const items: NeedsYouItem[] = []
  for (const session of sessions) {
    if (session.closedAt !== undefined) continue
    const state = runtime.get(session.id)
    if (state === undefined || state.attention === null) continue
    items.push({
      id: session.id,
      name: session.name,
      cwd: session.cwd,
      reason: state.attention,
      at: state.attentionAt ?? null
    })
  }
  return [...items].sort((a: NeedsYouItem, b: NeedsYouItem): number => {
    if (a.at !== b.at) {
      if (a.at === null) return 1
      if (b.at === null) return -1
      return b.at - a.at
    }
    return a.name.localeCompare(b.name)
  })
}

/** The read/unread menu item for a session: a session with a bell can be marked read, any other one unread. */
export function readToggleLabel(attention: AttentionReason | null): 'Mark as read' | 'Mark as unread' {
  return attention === null ? 'Mark as unread' : 'Mark as read'
}

/** Applies the read/unread toggle through main (the owner of attention state). */
export function toggleRead(id: Id, attention: AttentionReason | null): void {
  if (attention === null) {
    window.api.markUnread(id)
  } else {
    window.api.clearAttention(id)
  }
}
