import { describe, it, expect } from 'vitest'
import { IPC } from '../../shared/ipc'
import { createSoundRelay, type SoundRelayDeps, type SoundTarget } from './soundRelay'

interface FakeSender {
  readonly sent: Array<{ channel: string; args: unknown[] }>
  destroyed: boolean
  throwOnSend: Error | null
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
}

function makeSender(): FakeSender {
  const sender: FakeSender = {
    sent: [],
    destroyed: false,
    throwOnSend: null,
    isDestroyed(): boolean {
      return sender.destroyed
    },
    send(channel: string, ...args: unknown[]): void {
      if (sender.throwOnSend) throw sender.throwOnSend
      sender.sent.push({ channel, args })
    }
  }
  return sender
}

function makeWindow(sender: FakeSender | null): SoundTarget & { destroyed: boolean } {
  const win = {
    destroyed: false,
    webContents: sender,
    isDestroyed(): boolean {
      return win.destroyed
    }
  }
  return win
}

describe('createSoundRelay', () => {
  function setup(window: SoundTarget | null) {
    const fallbackCalls: number[] = []
    const errors: Array<{ where: string; error: unknown }> = []
    const deps: SoundRelayDeps = {
      getWindow: () => window,
      fallbackBeep: () => {
        fallbackCalls.push(1)
      },
      onError: (where, error) => {
        errors.push({ where, error })
      }
    }
    const relay = createSoundRelay(deps)
    return { relay, fallbackCalls, errors }
  }

  it('sends the sound event to the renderer when the window is alive', () => {
    const sender = makeSender()
    const { relay, fallbackCalls, errors } = setup(makeWindow(sender))

    relay('session-1', 'permission')

    expect(sender.sent).toEqual([{ channel: IPC.evSound, args: ['session-1', 'permission'] }])
    expect(fallbackCalls).toHaveLength(0)
    expect(errors).toHaveLength(0)
  })

  it('falls back to the system beep when the window is destroyed', () => {
    const sender = makeSender()
    const win = makeWindow(sender)
    win.destroyed = true
    const { relay, fallbackCalls } = setup(win)

    relay('session-1', 'done')

    expect(sender.sent).toHaveLength(0)
    expect(fallbackCalls).toHaveLength(1)
  })

  it('falls back when the webContents is destroyed', () => {
    const sender = makeSender()
    sender.destroyed = true
    const { relay, fallbackCalls } = setup(makeWindow(sender))

    relay('session-1', 'idle')

    expect(sender.sent).toHaveLength(0)
    expect(fallbackCalls).toHaveLength(1)
  })

  it('falls back when there is no window', () => {
    const { relay, fallbackCalls } = setup(null)

    relay('session-1', 'bell')

    expect(fallbackCalls).toHaveLength(1)
  })

  it('falls back when there is no webContents', () => {
    const { relay, fallbackCalls } = setup(makeWindow(null))

    relay('session-1', 'bell')

    expect(fallbackCalls).toHaveLength(1)
  })

  it('falls back and reports the error when send throws, without throwing', () => {
    const sender = makeSender()
    const failure = new Error('send failed')
    sender.throwOnSend = failure
    const { relay, fallbackCalls, errors } = setup(makeWindow(sender))

    expect(() => relay('session-1', 'permission')).not.toThrow()

    expect(fallbackCalls).toHaveLength(1)
    expect(errors).toEqual([{ where: 'sound send', error: failure }])
  })

  it('reports a failing fallback beep instead of throwing', () => {
    const failure = new Error('beep failed')
    const errors: Array<{ where: string; error: unknown }> = []
    const relay = createSoundRelay({
      getWindow: () => null,
      fallbackBeep: () => {
        throw failure
      },
      onError: (where, error) => {
        errors.push({ where, error })
      }
    })

    expect(() => relay('session-1', 'done')).not.toThrow()
    expect(errors).toEqual([{ where: 'sound fallback beep', error: failure }])
  })
})
