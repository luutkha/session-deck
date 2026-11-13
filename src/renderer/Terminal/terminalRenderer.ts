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
 * The renderer for a pane. An explicit preference always wins. 'auto' uses WebGL on a real GPU and the DOM renderer
 * when Chromium only renders in software (SwiftShader: WebGL then burns CPU per pane and runs at ~25 fps; measured
 * with --disable-gpu and 20 sessions: DOM 82% CPU / 147 fps, Canvas 166% CPU / 87 fps, WebGL 1,263% CPU / 28 fps,
 * and with 4,000 flooded lines per second DOM 28% CPU vs Canvas 59%, because the DOM only touches changed rows and
 * hidden panes do no work, see hiddenQueue). Before
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
  return gpuMode === 'software' ? 'dom' : 'webgl'
}

/**
 * Effects are reduced when asked, or by 'auto' on a software renderer (animations/shadows cost CPU there) or while many
 * agents are busy (`fleetBusy`, see effectsLoad.ts).
 */
export function resolveReducedEffects(pref: EffectsPref, gpuMode: GpuMode | null, fleetBusy = false): boolean {
  if (pref === 'reduced') {
    return true
  }
  if (pref === 'full') {
    return false
  }
  return gpuMode === 'software' || fleetBusy
}

/** Invalid or missing stored values fall back to 'auto' (an old or hand-edited key never breaks a pane). */
export function parseRendererPref(raw: string | null): RendererPref {
  return raw === 'webgl' || raw === 'canvas' || raw === 'dom' || raw === 'auto' ? raw : DEFAULT_RENDERER_PREF
}

export function parseEffectsPref(raw: string | null): EffectsPref {
  return raw === 'full' || raw === 'reduced' || raw === 'auto' ? raw : DEFAULT_EFFECTS_PREF
}

/** What the window itself sees when it asks for a WebGL context. */
export interface WebglProbe {
  /** False when no WebGL context could be created at all. */
  readonly available: boolean
  /** UNMASKED_RENDERER_WEBGL, '' when the driver hides it. */
  readonly renderer: string
}

/** Also the display-only adapters of a VM / remote session (Hyper-V Video, RDP's Remote Display Adapter, QXL): no 3D, so WebGL there is software. */
const SOFTWARE_WEBGL_RE = /swiftshader|llvmpipe|softpipe|software|basic render|basic display|hyper-v video|remote display|qxl/i

/**
 * Combines main's classification with a probe of the window's own WebGL. Chromium can report WebGL as "enabled"
 * while it runs on the CPU (SwiftShader on a VM, or a forced software ANGLE), and only the window can read the
 * renderer string. Software evidence from either side wins; otherwise main's answer stands.
 */
export function mergeGpuMode(mainMode: GpuMode, probe: WebglProbe | null): GpuMode {
  if (probe === null) {
    return mainMode
  }
  if (!probe.available || SOFTWARE_WEBGL_RE.test(probe.renderer)) {
    return 'software'
  }
  return mainMode
}
