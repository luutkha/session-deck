import { describe, expect, it, vi } from 'vitest'
import { BUILTIN_SOUNDS } from './builtinSounds'
import { createSoundPlayer } from './soundPlayer'
import type { SoundChoice } from './soundSettings'

interface ParamCall {
  readonly method: 'setValueAtTime' | 'linearRampToValueAtTime' | 'exponentialRampToValueAtTime'
  readonly value: number
  readonly time: number
}

interface FakeOscillator {
  type: OscillatorType
  readonly frequency: { setValueAtTime: (value: number, time: number) => void; calls: number[] }
  readonly connect: ReturnType<typeof vi.fn>
  readonly disconnect: ReturnType<typeof vi.fn>
  readonly start: ReturnType<typeof vi.fn>
  readonly stop: ReturnType<typeof vi.fn>
  onended: (() => void) | null
}

interface FakeGain {
  readonly gain: { readonly calls: ParamCall[]; setValueAtTime: (v: number, t: number) => void; linearRampToValueAtTime: (v: number, t: number) => void; exponentialRampToValueAtTime: (v: number, t: number) => void }
  readonly connect: ReturnType<typeof vi.fn>
  readonly disconnect: ReturnType<typeof vi.fn>
}

interface FakeContextHarness {
  readonly context: AudioContext
  readonly oscillators: FakeOscillator[]
  readonly gains: FakeGain[]
  readonly resume: ReturnType<typeof vi.fn>
  readonly close: ReturnType<typeof vi.fn>
  state: string
}

function createFakeContext(): FakeContextHarness {
  const oscillators: FakeOscillator[] = []
  const gains: FakeGain[] = []
  const resume = vi.fn((): Promise<void> => Promise.resolve())
  const close = vi.fn((): Promise<void> => Promise.resolve())
  const harness: { state: string } = { state: 'running' }
  const context = {
    currentTime: 2,
    destination: { name: 'destination' },
    get state(): string {
      return harness.state
    },
    resume,
    close,
    createOscillator: (): FakeOscillator => {
      const frequencyCalls: number[] = []
      const osc: FakeOscillator = {
        type: 'sine',
        frequency: {
          calls: frequencyCalls,
          setValueAtTime: (value: number): void => {
            frequencyCalls.push(value)
          }
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null
      }
      oscillators.push(osc)
      return osc
    },
    createGain: (): FakeGain => {
      const calls: ParamCall[] = []
      const gain: FakeGain = {
        gain: {
          calls,
          setValueAtTime: (value: number, time: number): void => {
            calls.push({ method: 'setValueAtTime', value, time })
          },
          linearRampToValueAtTime: (value: number, time: number): void => {
            calls.push({ method: 'linearRampToValueAtTime', value, time })
          },
          exponentialRampToValueAtTime: (value: number, time: number): void => {
            calls.push({ method: 'exponentialRampToValueAtTime', value, time })
          }
        },
        connect: vi.fn(),
        disconnect: vi.fn()
      }
      gains.push(gain)
      return gain
    }
  }
  return {
    context: context as unknown as AudioContext,
    oscillators,
    gains,
    resume,
    close,
    get state(): string {
      return harness.state
    },
    set state(value: string) {
      harness.state = value
    }
  }
}

interface FakeAudio {
  readonly src: string
  volume: number
  readonly play: ReturnType<typeof vi.fn>
  readonly pause: ReturnType<typeof vi.fn>
  onended: (() => void) | null
}

function createFakeAudioFactory(playResult: () => Promise<void> = (): Promise<void> => Promise.resolve()): {
  readonly create: (src: string) => HTMLAudioElement
  readonly created: FakeAudio[]
} {
  const created: FakeAudio[] = []
  return {
    created,
    create: (src: string): HTMLAudioElement => {
      const audio: FakeAudio = {
        src,
        volume: 1,
        play: vi.fn(playResult),
        pause: vi.fn(),
        onended: null
      }
      created.push(audio)
      return audio as unknown as HTMLAudioElement
    }
  }
}

const CHIME: SoundChoice = { kind: 'builtin', id: 'chime' }

describe('createSoundPlayer builtin sounds', () => {
  it('schedules one oscillator per note at the note start time', async () => {
    const fake = createFakeContext()
    const player = createSoundPlayer({ createAudioContext: (): AudioContext => fake.context })
    await player.play(CHIME, 1)

    const notes = BUILTIN_SOUNDS.chime.notes
    expect(fake.oscillators).toHaveLength(notes.length)
    expect(fake.gains).toHaveLength(notes.length)
    notes.forEach((note, index: number): void => {
      const osc = fake.oscillators[index]
      expect(osc?.frequency.calls).toEqual([note.freq])
      expect(osc?.start).toHaveBeenCalledWith(2.01 + note.start)
      expect(osc?.stop).toHaveBeenCalledWith(2.01 + note.start + note.duration)
      expect(osc?.connect).toHaveBeenCalledTimes(1)
    })
  })

  it('applies an attack and exponential release on each note gain', async () => {
    const fake = createFakeContext()
    const player = createSoundPlayer({ createAudioContext: (): AudioContext => fake.context })
    await player.play(CHIME, 0.5)

    const note = BUILTIN_SOUNDS.chime.notes[0]
    const calls = fake.gains[0]?.gain.calls ?? []
    expect(note).toBeDefined()
    expect(calls[0]).toEqual({ method: 'setValueAtTime', value: 0, time: 2.01 + (note?.start ?? 0) })
    expect(calls[1]?.method).toBe('linearRampToValueAtTime')
    expect(calls[1]?.value).toBeCloseTo((note?.gain ?? 0) * 0.5)
    expect(calls[2]).toEqual({
      method: 'exponentialRampToValueAtTime',
      value: 0.0001,
      time: 2.01 + (note?.start ?? 0) + (note?.duration ?? 0)
    })
    expect(calls[1]?.time).toBeLessThan(calls[2]?.time ?? 0)
  })

  it('clamps the volume used for the peak gain', async () => {
    const fake = createFakeContext()
    const player = createSoundPlayer({ createAudioContext: (): AudioContext => fake.context })
    await player.play({ kind: 'builtin', id: 'ping' }, 9)
    expect(fake.gains[0]?.gain.calls[1]?.value).toBeCloseTo(BUILTIN_SOUNDS.ping.notes[0]?.gain ?? 0)
  })

  it('is silent and does not touch audio at volume 0', async () => {
    const fake = createFakeContext()
    const createAudioContext = vi.fn((): AudioContext => fake.context)
    const player = createSoundPlayer({ createAudioContext })
    await player.play(CHIME, 0)
    await player.play(CHIME, -4)
    expect(fake.oscillators).toHaveLength(0)
  })

  it('resumes a suspended context', async () => {
    const fake = createFakeContext()
    fake.state = 'suspended'
    const player = createSoundPlayer({ createAudioContext: (): AudioContext => fake.context })
    await player.play(CHIME, 0.5)
    expect(fake.resume).toHaveBeenCalledTimes(1)
  })

  it('reuses one lazily created context', async () => {
    const fake = createFakeContext()
    const createAudioContext = vi.fn((): AudioContext => fake.context)
    const player = createSoundPlayer({ createAudioContext })
    expect(createAudioContext).not.toHaveBeenCalled()
    await player.play(CHIME, 0.5)
    await player.play(CHIME, 0.5)
    expect(createAudioContext).toHaveBeenCalledTimes(1)
  })

  it('never throws, even when the audio context cannot be created', async () => {
    const player = createSoundPlayer({
      createAudioContext: (): AudioContext => {
        throw new Error('no audio device')
      }
    })
    await expect(player.play(CHIME, 0.5)).resolves.toBeUndefined()
  })
})

describe('createSoundPlayer file sounds', () => {
  it('plays a file through an Audio element with a file:/// URL and the volume', async () => {
    const audio = createFakeAudioFactory()
    const player = createSoundPlayer({ createAudio: audio.create })
    await player.play({ kind: 'file', path: 'C:\\Users\\Jo Doe\\My Sounds\\ding #1.wav' }, 0.4)

    expect(audio.created).toHaveLength(1)
    expect(audio.created[0]?.src).toBe('file:///C:/Users/Jo%20Doe/My%20Sounds/ding%20%231.wav')
    expect(audio.created[0]?.volume).toBeCloseTo(0.4)
    expect(audio.created[0]?.play).toHaveBeenCalledTimes(1)
  })

  it('clamps the file volume', async () => {
    const audio = createFakeAudioFactory()
    const player = createSoundPlayer({ createAudio: audio.create })
    await player.play({ kind: 'file', path: '/home/u/a%b.mp3' }, 3)
    expect(audio.created[0]?.src).toBe('file:///home/u/a%25b.mp3')
    expect(audio.created[0]?.volume).toBe(1)
  })

  it('maps a failing file to a readable Error and does not throw other values', async () => {
    const audio = createFakeAudioFactory((): Promise<void> => Promise.reject(new Error('NotSupportedError')))
    const player = createSoundPlayer({ createAudio: audio.create })
    await expect(player.play({ kind: 'file', path: 'C:\\Sounds\\ding #1.wav' }, 0.5)).rejects.toThrow(
      'Could not play ding #1.wav: NotSupportedError'
    )
  })

  it('maps non-Error rejections to a message too', async () => {
    const audio = createFakeAudioFactory((): Promise<void> => Promise.reject('boom'))
    const player = createSoundPlayer({ createAudio: audio.create })
    await expect(player.play({ kind: 'file', path: '/x/missing.wav' }, 0.5)).rejects.toThrow(
      'Could not play missing.wav: boom'
    )
  })

  it('maps a missing Audio constructor (no DOM) to an Error, not a crash', async () => {
    const player = createSoundPlayer()
    await expect(player.play({ kind: 'file', path: '/x/a.wav' }, 0.5)).rejects.toThrow(
      'Could not play a.wav:'
    )
  })
})

describe('createSoundPlayer none and dispose', () => {
  it('treats none as a no-op that creates nothing', async () => {
    const createAudioContext = vi.fn((): AudioContext => createFakeContext().context)
    const audio = createFakeAudioFactory()
    const player = createSoundPlayer({ createAudioContext, createAudio: audio.create })
    await expect(player.play({ kind: 'none' }, 0.7)).resolves.toBeUndefined()
    expect(createAudioContext).not.toHaveBeenCalled()
    expect(audio.created).toHaveLength(0)
  })

  it('stops scheduled oscillators, closes the context, and ignores later plays', async () => {
    const fake = createFakeContext()
    const createAudioContext = vi.fn((): AudioContext => fake.context)
    const player = createSoundPlayer({ createAudioContext })
    await player.play(CHIME, 0.5)
    player.dispose()

    for (const osc of fake.oscillators) {
      expect(osc.stop.mock.calls.length).toBeGreaterThanOrEqual(2) // scheduled stop + dispose stop
      expect(osc.disconnect).toHaveBeenCalled()
    }
    expect(fake.close).toHaveBeenCalledTimes(1)

    await player.play(CHIME, 0.5)
    expect(createAudioContext).toHaveBeenCalledTimes(1)
  })

  it('pauses playing file audio on dispose', async () => {
    const audio = createFakeAudioFactory()
    const player = createSoundPlayer({ createAudio: audio.create })
    await player.play({ kind: 'file', path: '/x/a.wav' }, 0.5)
    player.dispose()
    expect(audio.created[0]?.pause).toHaveBeenCalledTimes(1)
  })

  it('dispose is safe to call twice and before any play', () => {
    const player = createSoundPlayer({ createAudioContext: (): AudioContext => createFakeContext().context })
    expect(() => {
      player.dispose()
      player.dispose()
    }).not.toThrow()
  })
})
