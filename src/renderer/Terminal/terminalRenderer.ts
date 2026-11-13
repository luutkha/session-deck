// Which xterm renderer a pane should use and whether decorative effects are reduced (no-GPU support, D62).
// Pure rules: no React, DOM or IPC. The hooks read the preferences and the GPU info; the panes follow the result.
import type { GpuMode } from '../../shared/types'

/** What the user stored: 'auto' follows the measured GPU. */
export type RendererPref = 'auto' | 'webgl' | 'canvas' | 'dom'

/** The renderer actually attached to a pane. 'dom' is xterm's built-in renderer (no addon). */
export type RendererKind = 'webgl' | 'canvas' | 'dom'

/** 'auto' reduces effects only when the GPU renders in software. */
export type EffectsPref = 'auto' | 'full' | 'reduced'

export const DEFAULT_RENDERER_PREF: RendererPref = 'auto'
export const DEFAULT_EFFECTS_PREF: EffectsPref = 'auto'

/**
 * The renderer for a pane. An explicit preference always wins. 'auto' uses WebGL on a real GPU and Canvas when
 * Chromium only renders in software (SwiftShader: WebGL then burns CPU per pane and runs at ~25 fps). Before
 * main has answered (`gpuMode` null) the pane stays on the DOM renderer: no GPU addon is loaded until we know,
 * and the panes switch as soon as the info arrives (the policy re-runs).
 */
export function resolveRenderer(pref: RendererPref, gpuMode: GpuMode | null): RendererKind {
  if (pref !== 'auto') {
    return pref
  }
  if (gpuMode === null) {
    return 'dom'
  }
  return gpuMode === 'software' ? 'canvas' : 'webgl'
}

/** Effects are reduced when asked, or by 'auto' on a software renderer (animations/shadows cost CPU there). */
export function resolveReducedEffects(pref: EffectsPref, gpuMode: GpuMode | null): boolean {
  if (pref === 'reduced') {
    return true
  }
  if (pref === 'full') {
    return false
  }
  return gpuMode === 'software'
}

/** Invalid or missing stored values fall back to 'auto' (an old or hand-edited key never breaks a pane). */
export function parseRendererPref(raw: string | null): RendererPref {
  return raw === 'webgl' || raw === 'canvas' || raw === 'dom' || raw === 'auto' ? raw : DEFAULT_RENDERER_PREF
}

export function parseEffectsPref(raw: string | null): EffectsPref {
  return raw === 'full' || raw === 'reduced' || raw === 'auto' ? raw : DEFAULT_EFFECTS_PREF
}
