// Built-in notification sounds, synthesized with WebAudio oscillators (no audio assets).
import type { BuiltinSoundId } from './soundSettings'

export interface Note {
  readonly freq: number // Hz
  readonly start: number // seconds from the sound's start
  readonly duration: number // seconds
  readonly gain: number // peak, 0..1
  readonly type: OscillatorType
}

export interface BuiltinSoundDef {
  readonly label: string
  readonly notes: readonly Note[]
}

export const BUILTIN_SOUNDS: Readonly<Record<BuiltinSoundId, BuiltinSoundDef>> = {
  chime: {
    label: 'Chime',
    notes: [
      { freq: 660, start: 0, duration: 0.25, gain: 0.5, type: 'sine' },
      { freq: 880, start: 0.14, duration: 0.35, gain: 0.5, type: 'sine' }
    ]
  },
  ping: {
    label: 'Ping',
    notes: [{ freq: 2093, start: 0, duration: 0.18, gain: 0.4, type: 'sine' }]
  },
  pop: {
    label: 'Pop',
    notes: [{ freq: 150, start: 0, duration: 0.08, gain: 0.6, type: 'sine' }]
  },
  bell: {
    label: 'Bell',
    notes: [
      { freq: 880, start: 0, duration: 1.1, gain: 0.5, type: 'triangle' },
      { freq: 1760, start: 0, duration: 0.6, gain: 0.15, type: 'sine' }
    ]
  },
  marimba: {
    label: 'Marimba',
    notes: [
      { freq: 392, start: 0, duration: 0.2, gain: 0.4, type: 'sine' },
      { freq: 587, start: 0.09, duration: 0.25, gain: 0.35, type: 'sine' }
    ]
  },
  soft: {
    label: 'Soft',
    notes: [{ freq: 329.63, start: 0, duration: 0.6, gain: 0.35, type: 'sine' }]
  }
}

/** Time from the start until the last note has finished, in seconds. */
export function soundLengthSeconds(notes: readonly Note[]): number {
  return notes.reduce(
    (longest: number, note: Note): number => Math.max(longest, note.start + note.duration),
    0
  )
}
