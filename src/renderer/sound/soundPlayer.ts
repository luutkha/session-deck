// Plays a SoundChoice: built-in sounds through one lazily created AudioContext, files through HTMLAudioElement.
import { BUILTIN_SOUNDS, type Note } from './builtinSounds'
import {
  clampVolume,
  fileBaseName,
  fileUrl,
  type BuiltinSoundId,
  type SoundChoice
} from './soundSettings'

export interface SoundPlayer {
  /** Resolves when the sound has been scheduled or started. Rejects only for file playback failures. */
  play(choice: SoundChoice, volume: number): Promise<void>
  dispose(): void
}

export interface SoundPlayerDeps {
  readonly createAudioContext?: () => AudioContext
  readonly createAudio?: (src: string) => HTMLAudioElement
}

const START_DELAY_S = 0.01
const ATTACK_S = 0.01
const RELEASE_FLOOR = 0.0001

function reasonOf(error: unknown): string {
  if (error instanceof Error && error.message !== '') {
    return error.message
  }
  if (typeof error === 'string' && error !== '') {
    return error
  }
  return 'unknown error'
}

export function createSoundPlayer(deps: SoundPlayerDeps = {}): SoundPlayer {
  const makeContext: () => AudioContext = deps.createAudioContext ?? ((): AudioContext => new AudioContext())
  const makeAudio: (src: string) => HTMLAudioElement =
    deps.createAudio ?? ((src: string): HTMLAudioElement => new Audio(src))

  let context: AudioContext | null = null
  let disposed = false
  const oscillators = new Set<OscillatorNode>()
  const audios = new Set<HTMLAudioElement>()

  function getContext(): AudioContext {
    if (context === null) {
      context = makeContext()
    }
    return context
  }

  function scheduleNote(ctx: AudioContext, note: Note, origin: number, volume: number): void {
    const start = origin + note.start
    const end = start + note.duration
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = note.type
    osc.frequency.setValueAtTime(note.freq, start)
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(note.gain * volume, start + Math.min(ATTACK_S, note.duration / 4))
    gain.gain.exponentialRampToValueAtTime(RELEASE_FLOOR, end)
    osc.connect(gain)
    gain.connect(ctx.destination)
    oscillators.add(osc)
    osc.onended = (): void => {
      oscillators.delete(osc)
      osc.disconnect()
      gain.disconnect()
    }
    osc.start(start)
    osc.stop(end)
  }

  function playBuiltin(id: BuiltinSoundId, volume: number): void {
    if (volume === 0) {
      return
    }
    try {
      const ctx = getContext()
      if (ctx.state === 'suspended') {
        void Promise.resolve(ctx.resume()).catch((): void => undefined)
      }
      const origin = ctx.currentTime + START_DELAY_S
      for (const note of BUILTIN_SOUNDS[id].notes) {
        scheduleNote(ctx, note, origin, volume)
      }
    } catch {
      // Built-in sounds never throw into callers: a missing audio device just means silence.
    }
  }

  async function playFile(path: string, volume: number): Promise<void> {
    const name = fileBaseName(path)
    let audio: HTMLAudioElement | null = null
    try {
      audio = makeAudio(fileUrl(path))
      audio.volume = volume
      const started = audio
      audios.add(started)
      started.onended = (): void => {
        audios.delete(started)
      }
      await audio.play()
    } catch (error: unknown) {
      if (audio !== null) {
        audios.delete(audio)
      }
      throw new Error(`Could not play ${name}: ${reasonOf(error)}`)
    }
  }

  return {
    async play(choice: SoundChoice, volume: number): Promise<void> {
      if (disposed || choice.kind === 'none') {
        return
      }
      const level = clampVolume(volume)
      if (choice.kind === 'builtin') {
        playBuiltin(choice.id, level)
        return
      }
      await playFile(choice.path, level)
    },

    dispose(): void {
      disposed = true
      for (const osc of oscillators) {
        try {
          osc.stop()
        } catch {
          // Already stopped.
        }
        osc.disconnect()
      }
      oscillators.clear()
      for (const audio of audios) {
        try {
          audio.pause()
        } catch {
          // Element already gone.
        }
      }
      audios.clear()
      if (context !== null) {
        const toClose = context
        context = null
        try {
          void Promise.resolve(toClose.close()).catch((): void => undefined)
        } catch {
          // Closing is best effort.
        }
      }
    }
  }
}

let sharedPlayer: SoundPlayer | null = null

/** App-wide player, created on first use so importing this module touches no audio API. */
export function getSharedSoundPlayer(): SoundPlayer {
  if (sharedPlayer === null) {
    sharedPlayer = createSoundPlayer()
  }
  return sharedPlayer
}
