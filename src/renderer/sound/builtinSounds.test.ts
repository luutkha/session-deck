import { describe, expect, it } from 'vitest'
import { BUILTIN_SOUND_IDS } from './soundSettings'
import { BUILTIN_SOUNDS, soundLengthSeconds } from './builtinSounds'

describe('BUILTIN_SOUNDS', () => {
  it('defines every builtin id', () => {
    expect(Object.keys(BUILTIN_SOUNDS).sort()).toEqual([...BUILTIN_SOUND_IDS].sort())
  })

  it('gives every sound at least one note', () => {
    for (const id of BUILTIN_SOUND_IDS) {
      expect(BUILTIN_SOUNDS[id].notes.length, id).toBeGreaterThanOrEqual(1)
    }
  })

  it('keeps every sound shorter than 1.5 s', () => {
    for (const id of BUILTIN_SOUND_IDS) {
      expect(soundLengthSeconds(BUILTIN_SOUNDS[id].notes), id).toBeLessThan(1.5)
    }
  })

  it('keeps gains within (0, 1]', () => {
    for (const id of BUILTIN_SOUND_IDS) {
      for (const note of BUILTIN_SOUNDS[id].notes) {
        expect(note.gain, id).toBeGreaterThan(0)
        expect(note.gain, id).toBeLessThanOrEqual(1)
      }
    }
  })

  it('keeps frequencies within 80..4000 Hz and durations positive', () => {
    for (const id of BUILTIN_SOUND_IDS) {
      for (const note of BUILTIN_SOUNDS[id].notes) {
        expect(note.freq, id).toBeGreaterThanOrEqual(80)
        expect(note.freq, id).toBeLessThanOrEqual(4000)
        expect(note.duration, id).toBeGreaterThan(0)
        expect(note.start, id).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('uses unique, non-empty labels', () => {
    const labels = BUILTIN_SOUND_IDS.map((id: string): string => BUILTIN_SOUNDS[id as keyof typeof BUILTIN_SOUNDS].label)
    expect(new Set(labels).size).toBe(labels.length)
    for (const label of labels) {
      expect(label.trim()).not.toBe('')
    }
  })

  it('uses the expected shapes for the named sounds', () => {
    expect(BUILTIN_SOUNDS.chime.notes).toHaveLength(2)
    expect(BUILTIN_SOUNDS.chime.notes[1]?.freq).toBeGreaterThan(BUILTIN_SOUNDS.chime.notes[0]?.freq ?? Infinity)
    expect(BUILTIN_SOUNDS.bell.notes.some((note) => note.type === 'triangle')).toBe(true)
    expect(BUILTIN_SOUNDS.bell.notes.length).toBeGreaterThanOrEqual(2)
    expect(BUILTIN_SOUNDS.pop.notes[0]?.duration).toBeLessThan(0.15)
    expect(BUILTIN_SOUNDS.soft.notes).toHaveLength(1)
    expect(BUILTIN_SOUNDS.ping.notes).toHaveLength(1)
    expect(BUILTIN_SOUNDS.marimba.notes).toHaveLength(2)
  })
})

describe('soundLengthSeconds', () => {
  it('is the latest note end time', () => {
    expect(
      soundLengthSeconds([
        { freq: 440, start: 0, duration: 0.2, gain: 0.5, type: 'sine' },
        { freq: 660, start: 0.1, duration: 0.3, gain: 0.5, type: 'sine' }
      ])
    ).toBeCloseTo(0.4)
  })
})
