// Jarvis and the Jarvis panel's own two settings (D54): "read Jarvis's replies aloud" and the width of the side
// panel. The window keeps both in localStorage, which is why main cannot change them itself: windowUi.ts passes the
// real stores (the panel's own setters, so the mounted panel follows), the tests pass fakes. No React here.
import type { JarvisUiAction } from '../../shared/types'

/** The panel's limits right now (the maximum depends on how wide the window is). */
export interface JarvisPanelWidthLimits {
  readonly min: number
  readonly max: number
  readonly defaultWidth: number
}

/** The screen action this file handles (main builds it in panelTools.ts). */
export type JarvisPrefsAction = Extract<JarvisUiAction, { readonly kind: 'jarvisPrefs' }>

/** Every store call goes through here so a test needs no localStorage (and no DOM). */
export interface JarvisPrefsDeps {
  readonly getSpeak: () => boolean
  /** Stores the choice and tells the mounted panel's header button (writeSpeakSetting does both). */
  readonly setSpeak: (on: boolean) => void
  readonly getPanelWidth: () => number
  /** Stores the width AND tells the mounted panel, like the drag handle's let-go path. */
  readonly setPanelWidth: (width: number) => void
  /** Read at call time: the panel's share of the window decides its maximum. */
  readonly widthLimits: () => JarvisPanelWidthLimits
}

/** What the two settings are now, plus the limits used to read the width. */
export interface JarvisPrefsState {
  readonly speak: boolean
  readonly panelWidth: number
  readonly limits: JarvisPanelWidthLimits
}

function booleanSetting(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('The "speak" setting must be true or false.')
  return value
}

function pixelWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('The panel width must be a number of pixels.')
  return value
}

function clampWidth(width: number, limits: JarvisPanelWidthLimits): number {
  return Math.round(Math.min(limits.max, Math.max(limits.min, width)))
}

/** The two settings in words, one per line; `notes` explain a value that had to be changed to fit. */
export function describeJarvisPrefs(state: JarvisPrefsState, notes: readonly string[] = []): string {
  const { min, max, defaultWidth } = state.limits
  const width = state.panelWidth === defaultWidth ? `${String(defaultWidth)}px, the default` : `${String(state.panelWidth)}px`
  return [
    `Jarvis reads its replies aloud: ${state.speak ? 'on' : 'off'}.`,
    `Jarvis panel width: ${width} (limits ${String(min)}-${String(max)}px).`,
    ...notes
  ].join('\n')
}

/**
 * Applies an action's fields (only the given ones change; `null`/none at all only reports) and answers with every
 * current value. A width is clamped to the panel's real limits, like the drag handle does, and the answer says so.
 * Every value is checked before a store is touched, so a wrong one never leaves half an action behind.
 */
export function applyJarvisPrefs(action: JarvisPrefsAction, deps: JarvisPrefsDeps): string {
  const speakBefore = deps.getSpeak()
  const widthBefore = deps.getPanelWidth()
  const limits = deps.widthLimits()
  const notes: string[] = []

  const speak = action.speak === undefined ? speakBefore : booleanSetting(action.speak)

  let panelWidth = widthBefore
  if (action.panelWidth === 'reset') {
    panelWidth = clampWidth(limits.defaultWidth, limits)
    if (panelWidth !== limits.defaultWidth) {
      notes.push(`The window is too narrow for the default ${String(limits.defaultWidth)}px; set to ${String(panelWidth)}px.`)
    } else if (widthBefore !== panelWidth) {
      notes.push(`Panel width is back to the default ${String(limits.defaultWidth)}px.`)
    }
  } else if (action.panelWidth !== undefined && action.panelWidth !== null) {
    const raw = pixelWidth(action.panelWidth)
    panelWidth = clampWidth(raw, limits)
    if (raw < limits.min || raw > limits.max) {
      notes.push(`Panel width ${String(raw)}px is outside ${String(limits.min)}-${String(limits.max)}px; set to ${String(panelWidth)}px.`)
    } else if (panelWidth !== raw) {
      notes.push(`Panel width ${String(raw)}px was rounded to ${String(panelWidth)}px.`)
    }
  }

  if (speak !== speakBefore) deps.setSpeak(speak)
  if (panelWidth !== widthBefore) deps.setPanelWidth(panelWidth)

  return describeJarvisPrefs({ speak, panelWidth, limits }, notes)
}
