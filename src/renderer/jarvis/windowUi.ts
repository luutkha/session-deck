// Jarvis actions that belong to the whole window, not to one mode's workspace (D58): the notification sounds. They
// live in the window's sound store (localStorage), which is why main cannot change them itself. No React here.
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

export interface WindowUiDeps {
  readonly sound: {
    get(): SoundSettings
    update(patch: SoundSettingsPatch): void
    play(choice: SoundChoice, volume: number): Promise<void>
  }
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
