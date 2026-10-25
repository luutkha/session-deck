import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runPaletteCommand, type PaletteApi, type PaletteHandlers } from './runCommand'
import type { PaletteCommand } from './paletteItems'

/** Lets queued promise rejections reach their .catch handlers. */
async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0)
  })
}

function fakeHandlers(): PaletteHandlers {
  return {
    openSession: vi.fn(),
    reopenSession: vi.fn(),
    newSession: vi.fn(),
    openHub: vi.fn(),
    openGrid: vi.fn(),
    openSettings: vi.fn(),
    showAwaySummary: vi.fn(),
    setStatus: vi.fn(),
    switchMode: vi.fn(),
    popOutCode: vi.fn(),
    dockCode: vi.fn(),
    newWorktree: vi.fn()
  }
}

function fakeApi(): PaletteApi {
  return {
    sleepSession: vi.fn((): Promise<void> => Promise.resolve()),
    setKeepAwake: vi.fn((): Promise<void> => Promise.resolve()),
    clearAttention: vi.fn(),
    markUnread: vi.fn()
  }
}

describe('runPaletteCommand: session and view commands', () => {
  let handlers: PaletteHandlers
  let api: PaletteApi

  beforeEach(() => {
    handlers = fakeHandlers()
    api = fakeApi()
    vi.spyOn(console, 'error').mockImplementation((): void => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens the session for open-session', () => {
    runPaletteCommand({ kind: 'open-session', id: 's1' }, handlers, api)
    expect(handlers.openSession).toHaveBeenCalledWith('s1')
    expect(handlers.reopenSession).not.toHaveBeenCalled()
  })

  it('reopens the session for reopen-session', () => {
    runPaletteCommand({ kind: 'reopen-session', id: 's1' }, handlers, api)
    expect(handlers.reopenSession).toHaveBeenCalledWith('s1')
    expect(handlers.openSession).not.toHaveBeenCalled()
  })

  it('starts the New session dialog for new-session', () => {
    runPaletteCommand({ kind: 'new-session' }, handlers, api)
    expect(handlers.newSession).toHaveBeenCalledTimes(1)
  })

  it('opens the Hub for open-hub', () => {
    runPaletteCommand({ kind: 'open-hub' }, handlers, api)
    expect(handlers.openHub).toHaveBeenCalledTimes(1)
  })

  it('opens the grid view for open-grid', () => {
    runPaletteCommand({ kind: 'open-grid' }, handlers, api)
    expect(handlers.openGrid).toHaveBeenCalledTimes(1)
  })

  it('opens Settings for open-settings', () => {
    runPaletteCommand({ kind: 'open-settings' }, handlers, api)
    expect(handlers.openSettings).toHaveBeenCalledTimes(1)
  })

  it('shows the away summary for show-away-summary', () => {
    runPaletteCommand({ kind: 'show-away-summary' }, handlers, api)
    expect(handlers.showAwaySummary).toHaveBeenCalledTimes(1)
    expect(handlers.openSettings).not.toHaveBeenCalled()
  })

  it('passes the id and status to setStatus for set-status', () => {
    runPaletteCommand({ kind: 'set-status', id: 's1', statusId: 'done' }, handlers, api)
    expect(handlers.setStatus).toHaveBeenCalledWith('s1', 'done')
  })

  it('does not touch the preload API for handler-only commands', () => {
    runPaletteCommand({ kind: 'open-hub' }, handlers, api)
    runPaletteCommand({ kind: 'set-status', id: 's1', statusId: 'done' }, handlers, api)
    expect(api.sleepSession).not.toHaveBeenCalled()
    expect(api.setKeepAwake).not.toHaveBeenCalled()
    expect(api.clearAttention).not.toHaveBeenCalled()
    expect(api.markUnread).not.toHaveBeenCalled()
  })
})

describe('runPaletteCommand: preload API commands', () => {
  let handlers: PaletteHandlers
  let api: PaletteApi

  beforeEach(() => {
    handlers = fakeHandlers()
    api = fakeApi()
    vi.spyOn(console, 'error').mockImplementation((): void => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('puts the session to sleep for sleep', () => {
    runPaletteCommand({ kind: 'sleep', id: 's1' }, handlers, api)
    expect(api.sleepSession).toHaveBeenCalledWith('s1')
  })

  it('sets keep-awake to the requested value for set-keep-awake', () => {
    runPaletteCommand({ kind: 'set-keep-awake', id: 's1', keepAwake: false }, handlers, api)
    expect(api.setKeepAwake).toHaveBeenCalledWith('s1', false)
  })

  it('clears the attention bell for mark-read', () => {
    runPaletteCommand({ kind: 'mark-read', id: 's1' }, handlers, api)
    expect(api.clearAttention).toHaveBeenCalledWith('s1')
    expect(api.markUnread).not.toHaveBeenCalled()
  })

  it('flags the session unread for mark-unread', () => {
    runPaletteCommand({ kind: 'mark-unread', id: 's1' }, handlers, api)
    expect(api.markUnread).toHaveBeenCalledWith('s1')
    expect(api.clearAttention).not.toHaveBeenCalled()
  })
})

describe('runPaletteCommand: failures never throw', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation((): void => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs and swallows a synchronous handler error', () => {
    const handlers = fakeHandlers()
    vi.mocked(handlers.openHub).mockImplementation((): void => {
      throw new Error('boom')
    })
    expect(() => runPaletteCommand({ kind: 'open-hub' }, handlers, fakeApi())).not.toThrow()
    expect(consoleError).toHaveBeenCalled()
  })

  it('logs and swallows a rejected API promise', async () => {
    const api = fakeApi()
    vi.mocked(api.sleepSession).mockImplementation((): Promise<void> => Promise.reject(new Error('gone')))
    expect(() => runPaletteCommand({ kind: 'sleep', id: 'ghost' }, fakeHandlers(), api)).not.toThrow()
    await flushPromises()
    expect(consoleError).toHaveBeenCalled()
  })

  it('logs and swallows a synchronous API error', () => {
    const api = fakeApi()
    vi.mocked(api.markUnread).mockImplementation((): void => {
      throw new Error('no ipc')
    })
    expect(() => runPaletteCommand({ kind: 'mark-unread', id: 's1' }, fakeHandlers(), api)).not.toThrow()
    expect(consoleError).toHaveBeenCalled()
  })

  it('logs and swallows a rejected async handler', async () => {
    const handlers = fakeHandlers()
    vi.mocked(handlers.setStatus).mockImplementation((): Promise<void> => Promise.reject(new Error('nope')))
    expect(() => runPaletteCommand({ kind: 'set-status', id: 's1', statusId: 'x' }, handlers, fakeApi())).not.toThrow()
    await flushPromises()
    expect(consoleError).toHaveBeenCalled()
  })

  it('logs an unknown command kind and does not throw', () => {
    const unknown = { kind: 'explode' } as unknown as PaletteCommand
    const handlers = fakeHandlers()
    expect(() => runPaletteCommand(unknown, handlers, fakeApi())).not.toThrow()
    expect(consoleError).toHaveBeenCalled()
    expect(handlers.openHub).not.toHaveBeenCalled()
  })
})

describe('runPaletteCommand: mode and window commands', () => {
  let handlers: PaletteHandlers

  beforeEach(() => {
    handlers = fakeHandlers()
    vi.spyOn(console, 'error').mockImplementation((): void => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('switches to the mode it is given for switch-mode', () => {
    runPaletteCommand({ kind: 'switch-mode', mode: 'code' }, handlers, fakeApi())
    expect(handlers.switchMode).toHaveBeenCalledWith('code')
  })

  it('pops the Code window out for pop-out-code', () => {
    runPaletteCommand({ kind: 'pop-out-code' }, handlers, fakeApi())
    expect(handlers.popOutCode).toHaveBeenCalledTimes(1)
    expect(handlers.dockCode).not.toHaveBeenCalled()
  })

  it('docks the Code window back for dock-code', () => {
    runPaletteCommand({ kind: 'dock-code' }, handlers, fakeApi())
    expect(handlers.dockCode).toHaveBeenCalledTimes(1)
    expect(handlers.popOutCode).not.toHaveBeenCalled()
  })

  it('starts the new worktree dialog for new-worktree', () => {
    runPaletteCommand({ kind: 'new-worktree' }, handlers, fakeApi())
    expect(handlers.newWorktree).toHaveBeenCalledTimes(1)
    expect(handlers.newSession).not.toHaveBeenCalled()
  })

  it('logs and swallows a failing mode handler', () => {
    vi.mocked(handlers.switchMode).mockImplementation((): void => {
      throw new Error('no window')
    })
    expect(() => runPaletteCommand({ kind: 'switch-mode', mode: 'ops' }, handlers, fakeApi())).not.toThrow()
    expect(console.error).toHaveBeenCalled()
  })
})