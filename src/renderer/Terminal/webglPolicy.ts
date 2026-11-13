// Which terminal panes may hold a GPU renderer, and of which kind (performance step 2 + no-GPU support, D62).
//
// Chromium allows about 16 live WebGL contexts per renderer, so with 20+ mounted panes the oldest contexts are
// force-lost and those xterms silently fall back to the DOM renderer (measured: ~130,000 DOM nodes for 20
// sessions instead of ~5,000). Only panes the user is looking at keep a WebGL context, up to a small cap; hidden
// panes give theirs back and get it again when they become visible.
//
// On a PC without a GPU the wanted kind is Canvas instead: it needs no WebGL context, so every visible pane gets
// one and there is no cap. 'dom' detaches every GPU addon (xterm's built-in renderer).
// Pure rules only: the hook owns the addons and applies this plan.

import type { RendererKind } from './terminalRenderer'

export const MAX_WEBGL_PANES = 8

export interface RendererPaneState {
  readonly id: string
  readonly visible: boolean
  /** The GPU addon it holds now, or null (xterm's DOM renderer). */
  readonly kind: RendererKind | null
  /** An earlier attach of the wanted kind failed (no GPU, contexts exhausted): never retried. */
  readonly failed?: boolean
}

export interface RendererAttach {
  readonly id: string
  /** 'dom' never attaches: xterm's built-in renderer needs no addon. */
  readonly kind: 'webgl' | 'canvas'
}

export interface RendererPlan {
  /** Panes that must get an addon now, in the order the panes were given. */
  readonly attach: readonly RendererAttach[]
  /** Panes that must give their addon back now, in the given order. */
  readonly detach: readonly string[]
}

/**
 * Decides which panes attach or detach a GPU renderer.
 * - 'dom': every pane that holds an addon releases it; nothing is attached.
 * - otherwise every hidden pane that still holds an addon detaches (it falls back to the DOM renderer);
 * - visible panes already holding the wanted kind keep it, even past the cap (never flash the pane the user is
 *   watching); a visible pane holding the OTHER GPU kind is detached first and then attached with the wanted one;
 * - 'canvas' has no cap (a CanvasAddon does not use a scarce WebGL context); 'webgl' attaches while the number of
 *   panes holding it stays <= `max`;
 * - a pane whose attach of the wanted kind failed is skipped, so we do not retry forever.
 */
export function planRenderers(
  panes: readonly RendererPaneState[],
  wanted: RendererKind,
  max: number = MAX_WEBGL_PANES
): RendererPlan {
  const detach: string[] = []
  if (wanted === 'dom') {
    for (const pane of panes) {
      if (pane.kind !== null) {
        detach.push(pane.id)
      }
    }
    return { attach: [], detach }
  }

  const attach: RendererAttach[] = []
  // Contexts that stay taken: visible panes already holding the wanted kind (they count against the WebGL cap).
  let holding = 0
  for (const pane of panes) {
    if (pane.kind === null) {
      continue
    }
    if (!pane.visible) {
      detach.push(pane.id)
    } else if (pane.kind === wanted) {
      holding += 1
    }
  }

  const cap = wanted === 'webgl' ? max : Number.POSITIVE_INFINITY
  // Wrong-kind panes are detached only when they are about to be attached, so a pane left on the DOM renderer
  // by the WebGL cap keeps a working Canvas renderer instead of churning twice.
  const swapping: string[] = []
  for (const pane of panes) {
    if (!pane.visible || pane.kind === wanted || pane.failed === true) {
      continue
    }
    if (holding >= cap) {
      break
    }
    if (pane.kind !== null) {
      swapping.push(pane.id)
    }
    attach.push({ id: pane.id, kind: wanted })
    holding += 1
  }
  return { attach, detach: detach.concat(swapping) }
}
