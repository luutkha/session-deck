// Which terminal panes may hold a WebGL renderer (performance step 2).
//
// Chromium allows about 16 live WebGL contexts per renderer, so with 20+ mounted
// panes the oldest contexts are force-lost and those xterms silently fall back to
// the DOM renderer (measured: ~130,000 DOM nodes for 20 sessions instead of ~5,000).
// Only panes the user is looking at keep a context, up to a small cap; hidden panes
// give theirs back and get it again when they become visible.
// Pure rules only: the hook owns the addons and applies this plan.

export const MAX_WEBGL_PANES = 8

export interface WebglPaneState {
  readonly id: string
  readonly visible: boolean
  readonly hasWebgl: boolean
  /** A previous attach threw (no GPU, contexts exhausted): never retried. */
  readonly failed?: boolean
}

export interface WebglPlan {
  /** Panes that must get a context now, in the order the panes were given. */
  readonly attach: readonly string[]
  /** Panes that must give their context back now (hidden), in the given order. */
  readonly detach: readonly string[]
}

/**
 * Decides which panes attach or detach a WebGL renderer.
 * - every hidden pane that still has one detaches (it falls back to xterm's DOM renderer);
 * - visible panes without one attach in the given order while the total number of
 *   panes with a context stays <= `max`;
 * - visible panes that already have one keep it, even past `max` (never flash the
 *   pane the user is watching);
 * - a pane whose attach failed is skipped, so we do not retry forever.
 */
export function planWebgl(
  panes: readonly WebglPaneState[],
  max: number = MAX_WEBGL_PANES
): WebglPlan {
  const detach: string[] = []
  // Kept contexts count against the cap: visible panes with one are always kept.
  let withWebgl = 0
  for (const pane of panes) {
    if (!pane.hasWebgl) {
      continue
    }
    if (pane.visible) {
      withWebgl += 1
    } else {
      detach.push(pane.id)
    }
  }
  const attach: string[] = []
  for (const pane of panes) {
    if (withWebgl >= max) {
      break
    }
    if (!pane.visible || pane.hasWebgl || pane.failed === true) {
      continue
    }
    attach.push(pane.id)
    withWebgl += 1
  }
  return { attach, detach }
}
