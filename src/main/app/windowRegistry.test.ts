import { describe, it, expect, vi } from 'vitest'
import type { WindowRole, WindowState } from '../../shared/types'
import { createWindowRegistry, type WindowLike, type WindowRegistry } from './windowRegistry'

/** Fake window: records calls, can be destroyed, minimized, focused, and can fail on send. */
class FakeWindow implements WindowLike {
  destroyed = false
  focused = false
  minimized = false
  readonly calls: string[] = []
  readonly sent: { channel: string; args: unknown[] }[] = []
  failSend = false
  private closedListeners: (() => void)[] = []

  constructor(readonly webContents: { readonly id: number; send(channel: string, ...args: unknown[]): void }) {}

  static create(id: number): FakeWindow {
    const win: FakeWindow = new FakeWindow({
      id,
      send: (channel, ...args) => {
        if (win.failSend) throw new Error('send failed')
        win.sent.push({ channel, args })
      }
    })
    return win
  }

  isDestroyed(): boolean {
    return this.destroyed
  }
  isFocused(): boolean {
    return this.focused
  }
  isMinimized(): boolean {
    return this.minimized
  }
  restore(): void {
    this.calls.push('restore')
    this.minimized = false
  }
  show(): void {
    this.calls.push('show')
  }
  focus(): void {
    this.calls.push('focus')
  }
  close(): void {
    this.calls.push('close')
    this.emitClosed()
  }
  on(_event: 'closed', cb: () => void): unknown {
    this.closedListeners.push(cb)
    return this
  }
  /** Simulates Electron's 'closed' event (user clicked X, or close() was called). */
  emitClosed(): void {
    this.destroyed = true
    for (const cb of this.closedListeners) cb()
  }
}

interface Harness {
  readonly registry: WindowRegistry<FakeWindow>
  readonly created: FakeWindow[]
  readonly states: WindowState[]
  readonly errors: { where: string; error: unknown }[]
}

function setup(): Harness {
  const created: FakeWindow[] = []
  const states: WindowState[] = []
  const errors: { where: string; error: unknown }[] = []
  let nextId = 100
  const registry = createWindowRegistry<FakeWindow>({
    createWindow: () => {
      const win = FakeWindow.create(nextId++)
      created.push(win)
      return win
    },
    onStateChange: (state) => states.push(state),
    onError: (where, error) => errors.push({ where, error })
  })
  return { registry, created, states, errors }
}

describe('windowRegistry: main window', () => {
  it('main() is null before setMain', () => {
    expect(setup().registry.main()).toBeNull()
  })

  it('main() returns the window set with setMain', () => {
    const { registry } = setup()
    const main = FakeWindow.create(1)
    registry.setMain(main)
    expect(registry.main()).toBe(main)
  })

  it('main() null after the main window is destroyed', () => {
    const { registry } = setup()
    const main = FakeWindow.create(1)
    registry.setMain(main)
    main.destroyed = true
    expect(registry.main()).toBeNull()
  })
})

describe('windowRegistry: popOutCode', () => {
  it('creates the code window with the code role', () => {
    const createWindow = vi.fn((_role: WindowRole) => FakeWindow.create(2))
    const registry = createWindowRegistry<FakeWindow>({ createWindow, onStateChange: () => {}, onError: () => {} })
    registry.popOutCode()
    expect(createWindow).toHaveBeenCalledWith('code')
  })

  it('creates the code window once and reports codePoppedOut true on creation', () => {
    const { registry, created, states } = setup()
    const first = registry.popOutCode()
    expect(created).toHaveLength(1)
    expect(registry.code()).toBe(first)
    expect(states).toEqual([{ codePoppedOut: true }])
  })

  it('popping out twice creates one window and focuses the existing one the second time', () => {
    const { registry, created, states } = setup()
    const first = registry.popOutCode()
    first.calls.length = 0
    const second = registry.popOutCode()
    expect(created).toHaveLength(1)
    expect(second).toBe(first)
    expect(first.calls).toEqual(['show', 'focus'])
    expect(states).toEqual([{ codePoppedOut: true }])
  })

  it('restore() is called when the existing code window is minimized', () => {
    const { registry } = setup()
    const first = registry.popOutCode()
    first.minimized = true
    first.calls.length = 0
    registry.popOutCode()
    expect(first.calls).toEqual(['restore', 'show', 'focus'])
  })

  it('restore() is not called when the code window is not minimized', () => {
    const { registry } = setup()
    const first = registry.popOutCode()
    first.calls.length = 0
    registry.popOutCode()
    expect(first.calls).not.toContain('restore')
  })

  it('propagates a createWindow failure instead of swallowing it', () => {
    const boom = new Error('no window')
    const registry = createWindowRegistry<FakeWindow>({
      createWindow: () => {
        throw boom
      },
      onStateChange: () => {},
      onError: () => {}
    })
    expect(() => registry.popOutCode()).toThrow(boom)
    expect(registry.code()).toBeNull()
  })
})

describe('windowRegistry: dockCode and closing the code window', () => {
  it('dockCode closes the code window and reports codePoppedOut false exactly once', () => {
    const { registry, states } = setup()
    const code = registry.popOutCode()
    registry.dockCode()
    expect(code.calls).toContain('close')
    expect(registry.code()).toBeNull()
    expect(states).toEqual([{ codePoppedOut: true }, { codePoppedOut: false }])
  })

  it('dockCode with no code window is a no-op', () => {
    const { registry, states } = setup()
    registry.dockCode()
    expect(states).toEqual([])
    expect(registry.code()).toBeNull()
  })

  it('closing the code window by itself updates state once', () => {
    const { registry, states } = setup()
    const code = registry.popOutCode()
    code.emitClosed()
    expect(registry.code()).toBeNull()
    expect(registry.state()).toEqual({ codePoppedOut: false })
    expect(states).toEqual([{ codePoppedOut: true }, { codePoppedOut: false }])
  })

  it('a closed event after dockCode does not notify a second time', () => {
    const { registry, states } = setup()
    const code = registry.popOutCode()
    registry.dockCode()
    code.emitClosed()
    expect(states.filter((s) => !s.codePoppedOut)).toHaveLength(1)
  })

  it('closeCode closes the code window like dockCode', () => {
    const { registry, states } = setup()
    const code = registry.popOutCode()
    registry.closeCode()
    expect(code.calls).toContain('close')
    expect(states).toEqual([{ codePoppedOut: true }, { codePoppedOut: false }])
  })

  it('a destroyed code window that never sent closed is forgotten on the next popOut', () => {
    const { registry, created, states } = setup()
    const stale = registry.popOutCode()
    stale.destroyed = true
    const fresh = registry.popOutCode()
    expect(created).toHaveLength(2)
    expect(fresh).not.toBe(stale)
    expect(states).toEqual([{ codePoppedOut: true }, { codePoppedOut: false }, { codePoppedOut: true }])
  })

  it('after the code window is closed, popOutCode creates a new one', () => {
    const { registry, created } = setup()
    const first = registry.popOutCode()
    first.emitClosed()
    const second = registry.popOutCode()
    expect(created).toHaveLength(2)
    expect(second).not.toBe(first)
  })
})

describe('windowRegistry: state and lookup', () => {
  it('state reports codePoppedOut false with no code window', () => {
    expect(setup().registry.state()).toEqual({ codePoppedOut: false })
  })

  it('state reports codePoppedOut true while the code window is open', () => {
    const { registry } = setup()
    registry.popOutCode()
    expect(registry.state()).toEqual({ codePoppedOut: true })
  })

  it('roleOf maps webContents ids to roles', () => {
    const { registry } = setup()
    registry.setMain(FakeWindow.create(1))
    registry.popOutCode()
    expect(registry.roleOf(1)).toBe('main')
    expect(registry.roleOf(100)).toBe('code')
  })

  it('roleOf an unknown id returns null', () => {
    const { registry } = setup()
    registry.setMain(FakeWindow.create(1))
    expect(registry.roleOf(999)).toBeNull()
  })

  it('roleOf ignores destroyed windows', () => {
    const { registry } = setup()
    const main = FakeWindow.create(1)
    registry.setMain(main)
    main.destroyed = true
    expect(registry.roleOf(1)).toBeNull()
  })

  it('focusedRole returns the role of the focused live window', () => {
    const { registry } = setup()
    const main = FakeWindow.create(1)
    registry.setMain(main)
    const code = registry.popOutCode()
    code.focused = true
    expect(registry.focusedRole()).toBe('code')
    code.focused = false
    main.focused = true
    expect(registry.focusedRole()).toBe('main')
  })

  it('focusedRole is null when no window is focused', () => {
    const { registry } = setup()
    registry.setMain(FakeWindow.create(1))
    expect(registry.focusedRole()).toBeNull()
  })
})

describe('windowRegistry: broadcast', () => {
  it('sends the channel and args to every live window', () => {
    const { registry } = setup()
    const main = FakeWindow.create(1)
    registry.setMain(main)
    const code = registry.popOutCode()
    registry.broadcast('ev:store', { a: 1 }, 2)
    expect(main.sent).toEqual([{ channel: 'ev:store', args: [{ a: 1 }, 2] }])
    expect(code.sent).toEqual([{ channel: 'ev:store', args: [{ a: 1 }, 2] }])
  })

  it('skips destroyed windows', () => {
    const { registry } = setup()
    const main = FakeWindow.create(1)
    registry.setMain(main)
    const code = registry.popOutCode()
    code.destroyed = true
    registry.broadcast('ev:runtime', 'x')
    expect(main.sent).toHaveLength(1)
    expect(code.sent).toHaveLength(0)
  })

  it('a send that throws is reported and the other windows still get it', () => {
    const { registry, errors } = setup()
    const main = FakeWindow.create(1)
    registry.setMain(main)
    const code = registry.popOutCode()
    main.failSend = true
    registry.broadcast('ev:store', 'payload')
    expect(errors).toHaveLength(1)
    expect(errors[0].where).toContain('ev:store')
    expect(errors[0].error).toBeInstanceOf(Error)
    expect(code.sent).toEqual([{ channel: 'ev:store', args: ['payload'] }])
  })

  it('does nothing when there are no windows', () => {
    const { registry, errors } = setup()
    registry.broadcast('ev:store', 1)
    expect(errors).toEqual([])
  })
})
