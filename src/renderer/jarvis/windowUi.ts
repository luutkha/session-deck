// Jarvis actions that belong to the whole window, not to one mode's workspace (D58/D71): the notification sounds, the
// terminal / graphics preferences and the Jarvis panel's own two settings. They live in window stores (localStorage),
// which is why main cannot change them itself. No React here.
import type { JarvisSoundChoice, JarvisUiAction, SoundEvent } from '../../shared/types'
import {
  BUILTIN_SOUND_IDS,
  describeChoice,
  SOUND_EVENTS,
  type BuiltinSoundId,
  type SoundChoice,
  type SoundSettings,
  type SoundSettingsPatch
} from '../sound/soundSettings'
import { getGraphicsPrefs, setEffectsPref, setRendererPref } from '../Terminal/graphicsPrefs'
import { normalizeTermView, readTermView, storeTermView } from '../Terminal/termView'
import { readRightClickMode, storeRightClickMode } from '../Terminal/rightClickPref'
import { applyTerminalPrefs, type TerminalPrefsDeps } from './terminalPrefsUi'
import { applyJarvisPrefs, type JarvisPrefsDeps } from './jarvisPrefsUi'
import { JARVIS_WIDTH_DEFAULT, JARVIS_WIDTH_MIN, jarvisWidthMax } from './jarvisLogic'
import { readJarvisPanelWidth, setJarvisPanelWidth } from './jarvisPanelStore'
import { readSpeakSetting, writeSpeakSetting } from './JarvisSpeaker'

export interface WindowUiDeps {
  readonly sound: {
    get(): SoundSettings
    update(patch: SoundSettingsPatch): void
    play(choice: SoundChoice, volume: number): Promise<void>
  }
  /** D71: terminal preferences. Optional so a caller that only needs sounds (and the tests) stays small. */
  readonly terminalPrefs?: TerminalPrefsDeps
  /** D54: the Jarvis panel's own two settings, kept by the window. Optional for the same reason. */
  readonly jarvisPrefs?: JarvisPrefsDeps
}

// useTermView keeps this name private; firing it after the store is what makes the mounted panes follow a change at
// once (a bare storeTermView only reaches the OTHER window, through the 'storage' event).
const TERM_VIEW_EVENT = 'sessiondeck:termview'

/** The real stores the window uses; a fake set comes in through WindowUiDeps.terminalPrefs in tests. */
const TERMINAL_PREFS: TerminalPrefsDeps = {
  getGraphicsPrefs,
  setRendererPref,
  setEffectsPref,
  readTermView,
  setTermView: (view): void => {
    storeTermView(normalizeTermView(view))
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(TERM_VIEW_EVENT))
  },
  readRightClickMode,
  storeRightClickMode
}

/** D54: the panel's own stores; the panel's setters tell the mounted panel, not only localStorage. */
const JARVIS_PREFS: JarvisPrefsDeps = {
  getSpeak: readSpeakSetting,
  setSpeak: writeSpeakSetting,
  getPanelWidth: readJarvisPanelWidth,
  setPanelWidth: setJarvisPanelWidth,
  widthLimits: () => ({
    min: JARVIS_WIDTH_MIN,
    max: jarvisWidthMax(window.innerWidth),
    defaultWidth: JARVIS_WIDTH_DEFAULT
  })
}

const EVENT_LABELS: Readonly<Record<SoundEvent, string>> = {
  permission: 'permission request',
  done: 'turn finished',
  idle: 'waiting for input',
  bell: 'terminal bell',
  quota: 'quota alert'
}

function toChoice(choice: JarvisSoundChoice): SoundChoice {
  if (choice.kind === 'none') return { kind: 'none' }
  if (choice.kind === 'file') {
    if (choice.path.trim().length === 0) throw new Error('A sound file needs its full path.')
    return { kind: 'file', path: choice.path }
  }
  if (!(BUILTIN_SOUND_IDS as readonly string[]).includes(choice.id)) {
    throw new Error(`Unknown sound "${choice.id}". Built-in sounds: ${BUILTIN_SOUND_IDS.join(', ')}.`)
  }
  return { kind: 'builtin', id: choice.id as BuiltinSoundId }
}

function choiceText(choice: SoundChoice): string {
  return choice.kind === 'builtin' ? choice.id : choice.kind === 'file' ? `file ${choice.path}` : describeChoice(choice).toLowerCase()
}

/** The sound settings in words (for get_screen_state and sound_settings). */
export function describeSound(settings: SoundSettings): string {
  const events = SOUND_EVENTS.map((event) => `${event} (${EVENT_LABELS[event]}): ${choiceText(settings.perReason[event])}`)
  return [
    `Sounds: ${settings.enabled ? 'on' : 'off'}, volume ${Math.round(settings.volume * 100)}%`,
    ...events.map((line) => `  ${line}`),
    `  Built-in sounds: ${BUILTIN_SOUND_IDS.join(', ')}`
  ].join('\n')
}

/** Runs a window action and returns what it did; null when the action is a workspace one. */
export function runWindowAction(action: JarvisUiAction, deps: WindowUiDeps): string | null {
  if (action.kind === 'terminalPrefs') return applyTerminalPrefs(action, deps.terminalPrefs ?? TERMINAL_PREFS)
  if (action.kind === 'jarvisPrefs') return applyJarvisPrefs(action, deps.jarvisPrefs ?? JARVIS_PREFS)
  if (action.kind !== 'sound') return null
  const perReason: Partial<Record<SoundEvent, SoundChoice>> = {}
  for (const [event, choice] of Object.entries(action.events ?? {}) as [SoundEvent, JarvisSoundChoice][]) {
    if (!SOUND_EVENTS.includes(event)) throw new Error(`Unknown sound event "${event}". Events: ${SOUND_EVENTS.join(', ')}.`)
    perReason[event] = toChoice(choice)
  }
  if (action.volume !== undefined && (!Number.isFinite(action.volume) || action.volume < 0 || action.volume > 1)) {
    throw new Error('The volume must be 0 to 100 %.')
  }
  const patch: SoundSettingsPatch = {
    ...(action.enabled !== undefined ? { enabled: action.enabled } : {}),
    ...(action.volume !== undefined ? { volume: action.volume } : {}),
    ...(Object.keys(perReason).length > 0 ? { perReason } : {})
  }
  if (Object.keys(patch).length > 0) deps.sound.update(patch)
  const now = deps.sound.get()
  if (action.test !== undefined) {
    if (!SOUND_EVENTS.includes(action.test)) throw new Error(`Unknown sound event "${action.test}".`)
    // Playing is best effort: a missing file shows in the log, the answer still says what was set.
    deps.sound.play(now.perReason[action.test], now.volume).catch((error: unknown) => {
      console.warn('SessionDeck: Jarvis sound test failed', error)
    })
  }
  const tested = action.test !== undefined ? `\nPlayed the ${action.test} sound.` : ''
  return `${describeSound(now)}${tested}`
}
