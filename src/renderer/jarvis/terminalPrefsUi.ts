// Jarvis and the terminal / graphics preferences (D71): the Settings > Terminal choices the window keeps in
// localStorage (renderer, visual effects, scrollback, zoom, right-click). Pure logic with injected deps so it can be
// unit-tested without a DOM; windowUi.ts passes the real modules, the tests pass fakes. No React here.
import type { JarvisUiAction } from '../../shared/types'
import {
  clampScrollback,
  clampZoom,
  SCROLLBACK_MAX,
  SCROLLBACK_MIN,
  ZOOM_MAX,
  ZOOM_MIN,
  type TermView
} from '../Terminal/termView'
import type { EffectsPref, RendererPref } from '../Terminal/terminalRenderer'
import type { RightClickMode } from '../Terminal/keymap'

const RENDERERS: readonly RendererPref[] = ['auto', 'webgl', 'canvas', 'dom']
const EFFECTS: readonly EffectsPref[] = ['auto', 'full', 'reduced']

/** The preferences as the window stores them: graphics and right-click live in their own stores, zoom/scrollback in one. */
export interface TerminalPrefsState {
  readonly renderer: RendererPref
  readonly effects: EffectsPref
  readonly scrollbackLines: number
  readonly zoomPercent: number
  readonly rightClick: RightClickMode
}

/** Every store call goes through here so a test needs no localStorage (and no DOM). */
export interface TerminalPrefsDeps {
  readonly getGraphicsPrefs: () => { readonly renderer: RendererPref; readonly effects: EffectsPref }
  readonly setRendererPref: (pref: RendererPref) => void
  readonly setEffectsPref: (pref: EffectsPref) => void
  readonly readTermView: () => TermView
  /** Stores the profile AND tells the mounted panes, like Settings > Terminal (useTermView's setTermView). */
  readonly setTermView: (view: TermView) => void
  readonly readRightClickMode: () => RightClickMode
  readonly storeRightClickMode: (mode: RightClickMode) => void
}

/** The screen action this file handles (main builds it in prefsTools.ts). */
export type TerminalPrefsAction = Extract<JarvisUiAction, { readonly kind: 'terminalPrefs' }>

function rendererOf(value: unknown): RendererPref {
  if (typeof value === 'string' && (RENDERERS as readonly string[]).includes(value)) return value as RendererPref
  throw new Error(`Unknown terminal renderer "${String(value)}". Use auto, webgl, canvas or dom.`)
}

function effectsOf(value: unknown): EffectsPref {
  if (typeof value === 'string' && (EFFECTS as readonly string[]).includes(value)) return value as EffectsPref
  throw new Error(`Unknown visual effects setting "${String(value)}". Use auto, full or reduced.`)
}

/** 'copy-paste' is the action's name for the stored 'paste' mode (the Settings button says Copy / paste). */
function rightClickOf(value: unknown): RightClickMode {
  if (value === 'menu') return 'menu'
  if (value === 'copy-paste' || value === 'paste') return 'paste'
  throw new Error(`Unknown right-click mode "${String(value)}". Use menu or copy-paste.`)
}

function rightClickText(mode: RightClickMode): string {
  return mode === 'paste' ? 'copy-paste' : 'menu'
}

function finiteNumber(value: unknown, key: string, range: string, unit: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`"${key}" must be a number (${range}${unit}).`)
  }
  return value
}

/** The preferences in words, one per line; `notes` explain a value that had to be changed to fit. */
export function describeTerminalPrefs(state: TerminalPrefsState, notes: readonly string[] = []): string {
  return [
    `Terminal renderer: ${state.renderer} (auto = WebGL with a GPU, DOM without).`,
    `Visual effects: ${state.effects}.`,
    `Scrollback: ${String(state.scrollbackLines)} lines (applies to terminals opened from now on).`,
    `Zoom: ${String(state.zoomPercent)}%.`,
    `Right-click: ${rightClickText(state.rightClick)}.`,
    ...notes
  ].join('\n')
}

/**
 * Applies an action's fields (only the given ones change; nothing at all is allowed) and answers with every current
 * value. Out-of-range zoom/scrollback are clamped like the Settings dialog does, and the answer says so. Every value
 * is checked before a store is touched, so a wrong one never leaves half an action behind.
 */
export function applyTerminalPrefs(action: TerminalPrefsAction, deps: TerminalPrefsDeps): string {
  const graphics = deps.getGraphicsPrefs()
  const view = deps.readTermView()
  const rightClickBefore = deps.readRightClickMode()
  const notes: string[] = []

  const renderer = action.renderer !== undefined ? rendererOf(action.renderer) : graphics.renderer
  const effects = action.effects !== undefined ? effectsOf(action.effects) : graphics.effects
  const rightClick = action.rightClick !== undefined ? rightClickOf(action.rightClick) : rightClickBefore

  let scrollbackLines = view.scrollbackLines
  if (action.scrollbackLines !== undefined) {
    const raw = finiteNumber(action.scrollbackLines, 'scrollbackLines', `${SCROLLBACK_MIN} to ${SCROLLBACK_MAX}`, ' lines')
    scrollbackLines = clampScrollback(raw)
    if (raw < SCROLLBACK_MIN || raw > SCROLLBACK_MAX) {
      notes.push(`Scrollback ${String(raw)} lines is outside ${SCROLLBACK_MIN}-${SCROLLBACK_MAX}; set to ${String(scrollbackLines)} lines.`)
    } else if (scrollbackLines !== raw) {
      notes.push(`Scrollback ${String(raw)} was rounded to ${String(scrollbackLines)} lines.`)
    }
  }

  let zoomPercent = view.zoomPercent
  if (action.zoomPercent !== undefined) {
    const raw = finiteNumber(action.zoomPercent, 'zoomPercent', `${ZOOM_MIN} to ${ZOOM_MAX}`, '%')
    zoomPercent = clampZoom(raw)
    if (raw < ZOOM_MIN || raw > ZOOM_MAX) {
      notes.push(`Zoom ${String(raw)}% is outside ${ZOOM_MIN}-${ZOOM_MAX}%; set to ${String(zoomPercent)}%.`)
    } else if (zoomPercent !== raw) {
      notes.push(`Zoom ${String(raw)}% was rounded to ${String(zoomPercent)}%.`)
    }
  }

  if (renderer !== graphics.renderer) deps.setRendererPref(renderer)
  if (effects !== graphics.effects) deps.setEffectsPref(effects)
  if (scrollbackLines !== view.scrollbackLines || zoomPercent !== view.zoomPercent) {
    deps.setTermView({ zoomPercent, scrollbackLines })
  }
  if (rightClick !== rightClickBefore) deps.storeRightClickMode(rightClick)

  return describeTerminalPrefs({ renderer, effects, scrollbackLines, zoomPercent, rightClick }, notes)
}
