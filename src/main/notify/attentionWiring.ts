import type { AttentionReason, RuntimeState, StoreData } from '../../shared/types'
import { attentionNotice } from './attentionNotice'

export interface AttentionWiringDeps {
  readonly attention: {
    onChange(callback: (id: string, reason: AttentionReason | null) => void): () => void
  }
  readonly store: { get(): StoreData }
  readonly runtime: { get(id: string): RuntimeState | undefined }
  readonly notifySession: (id: string, title: string, body: string) => boolean
  /** True when the session is on screen in the focused window: no desktop notice for it. */
  readonly isFocused?: (id: string) => boolean
}

/**
 * Desktop notification for each attention raise that deserves one (permission, done). Attention is raised once per
 * transition by the attention manager, so this fires once per event. Returns the unsubscribe function.
 */
export function wireAttentionNotices(deps: AttentionWiringDeps): () => void {
  return deps.attention.onChange((id, reason) => {
    if (reason === null || deps.isFocused?.(id) === true) return
    const session = deps.store.get().sessions.find((s) => s.id === id)
    if (session === undefined) return
    const notice = attentionNotice({
      name: session.name,
      reason,
      activityMessage: deps.runtime.get(id)?.activityMessage ?? null
    })
    if (notice !== null) {
      deps.notifySession(id, notice.title, notice.body)
    }
  })
}
