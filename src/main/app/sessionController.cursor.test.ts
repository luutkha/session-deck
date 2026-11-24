import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Id, AttentionReason, RuntimeState, Session, StoreData } from '../../shared/types'
import { SessionStore } from '../store'
import type { PtyManager, StartOptions } from '../pty/PtyManager'
import type { AttentionService } from '../attention/AttentionService'
import { createRuntimeRegistry } from './runtimeRegistry'
import { createSessionController } from './sessionController'
import { setCursorCommandRunnerForTests, resetCursorCommandCache } from '../cursor/command'

const dirs: string[] = []
const CHAT_ID = 'chat_12345678'

afterEach(() => {
  setCursorCommandRunnerForTests(null)
  resetCursorCommandCache()
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sessiondeck-cursor-'))
  dirs.push(dir)
  return dir
}

function makeStoreData(sessions: Session[] = []): StoreData {
  return {
    version: 1,
    sessions,
    groups: [],
    statuses: [
      { id: 'todo', name: 'Todo', color: '#9e9e9e' },
      { id: 'working', name: 'Working', color: '#42a5f5' }
    ],
    groupOrder: []
  }
}

interface MockProcess {
  killed: boolean
  exitCode: number | null
  startOpts: StartOptions
  buffer: string
}

function createMockPty(): PtyManager & { getLastStartOpts: (id: Id) => StartOptions | undefined } {
  const processes = new Map<Id, MockProcess>()
  const mock = {
    start(opts: StartOptions): void {
      const previous = processes.get(opts.sessionId)
      if (previous && !previous.killed) throw new Error(`Session already running: ${opts.sessionId}`)
      processes.set(opts.sessionId, { killed: false, exitCode: null, startOpts: opts, buffer: '' })
    },
    restart(opts: StartOptions): void {
      const existing = processes.get(opts.sessionId)
      if (existing) existing.killed = true
      processes.set(opts.sessionId, { killed: false, exitCode: null, startOpts: opts, buffer: '' })
    },
    write(): void {},
    resize(): void {},
    kill(id: Id): void {
      const proc = processes.get(id)
      if (proc) proc.killed = true
    },
    killAll(): void {
      for (const proc of processes.values()) proc.killed = true
    },
    replay(id: Id): { data: string; seq: number } {
      const proc = processes.get(id)
      return { data: proc?.buffer ?? '', seq: 0 }
    },
    isRunning(id: Id): boolean {
      const proc = processes.get(id)
      return proc !== undefined && !proc.killed
    },
    onData(): () => void {
      return () => {}
    },
    onExit(): () => void {
      return () => {}
    },
    getLastStartOpts(id: Id): StartOptions | undefined {
      return processes.get(id)?.startOpts
    },
    dispose(): void {
      processes.clear()
    }
  } as unknown as PtyManager & { getLastStartOpts: (id: Id) => StartOptions | undefined }
  return mock
}

function createFakeAttention(): AttentionService & { prepareCursor: ReturnType<typeof vi.fn> } {
  const attentionMap = new Map<Id, AttentionReason | null>()
  return {
    async start() {},
    async stop() {},
    claudeArgs: (): string[] => ['--settings', '/fake/settings.json'],
    envFor: (sessionId: string): Record<string, string> => ({ SESSIONDECK_SESSION_ID: sessionId }),
    opencodeEnv: (): Record<string, string> => ({ OPENCODE_CONFIG_CONTENT: '{}' }),
    workerEnv: (): Record<string, string> => ({ OPENCODE_CONFIG_CONTENT: '{"plugin":[]}' }),
    prepareCursor: vi.fn(),
    endpoint: (): { port: number; token: string } => ({ port: 1, token: 't' }),
    noteOutput(): void {},
    noteInput(): void {},
    clear: vi.fn((id: string) => {
      attentionMap.delete(id)
    }),
    get: (id: string): AttentionReason | null => attentionMap.get(id) ?? null,
    onChange: (): (() => void) => () => {},
    setSoundEnabled(): void {},
    suspend(_id: string): void {},
    forget(id: string): void {
      attentionMap.delete(id)
    },
    raise(id: string, reason: AttentionReason): void {
      attentionMap.set(id, reason)
    }
  } as unknown as AttentionService & { prepareCursor: ReturnType<typeof vi.fn> }
}

function setup(sessions: Session[] = [], options: { prepareCursorThrows?: boolean } = {}) {
  // A session start must never spawn the real CLI in a unit test.
  setCursorCommandRunnerForTests((command) => command === 'cursor-agent')
  const store = new SessionStore(makeStoreData(sessions), { schedule: vi.fn() }, { newId: () => 'new-id', now: () => 10 })
  const pty = createMockPty()
  const attention = createFakeAttention()
  if (options.prepareCursorThrows === true) attention.prepareCursor.mockImplementation(() => { throw new Error('hooks.json is not valid JSON') })
  const runtime = createRuntimeRegistry()
  const controller = createSessionController({
    store,
    pty,
    attention,
    runtime,
    sendPtyData: vi.fn(),
    userDataDir: tempDir()
  })
  const stateOf = (id: Id): RuntimeState | undefined => runtime.get(id)
  return { controller, store, pty, attention, runtime, stateOf }
}

describe('cursor sessions: hook events', () => {
  it('stores a new chat id and does not store an invalid one', () => {
    const { controller, store } = setup([{ id: 'c1', name: 'C', cwd: tempDir(), groupId: null, statusId: 'todo', order: 0, createdAt: 1, claudeArgs: [], agent: 'cursor' }])

    controller.handleHookEvent({ sessionId: 'c1', event: 'UserPromptSubmit', chatId: CHAT_ID })
    expect(store.get().sessions[0].cursorChatId).toBe(CHAT_ID)

    controller.handleHookEvent({ sessionId: 'c1', event: 'UserPromptSubmit', chatId: 'not a chat id!' })
    expect(store.get().sessions[0].cursorChatId).toBe(CHAT_ID)
  })

  it('keeps a CursorAnswer in memory and does not touch activity, status or attention', () => {
    const { controller, store, stateOf, attention } = setup([{ id: 'c1', name: 'C', cwd: tempDir(), groupId: null, statusId: 'todo', order: 0, createdAt: 1, claudeArgs: [], agent: 'cursor' }])

    controller.handleHookEvent({ sessionId: 'c1', event: 'CursorAnswer', chatId: CHAT_ID, answer: 'All 42 tests passed.' })

    expect(controller.lastCursorAnswer('c1')).toBe('All 42 tests passed.')
    expect(stateOf('c1')).toBeUndefined()
    expect(store.get().sessions[0].statusId).toBe('todo')
    expect(attention.clear).not.toHaveBeenCalled()
    expect(store.get().sessions[0].cursorChatId).toBe(CHAT_ID)
  })

  it('keeps the latest reply, and forgets it when the session is removed or closed', () => {
    const first = setup([{ id: 'c1', name: 'C', cwd: tempDir(), groupId: null, statusId: 'todo', order: 0, createdAt: 1, claudeArgs: [], agent: 'cursor' }])
    first.controller.handleHookEvent({ sessionId: 'c1', event: 'CursorAnswer', answer: 'one' })
    first.controller.handleHookEvent({ sessionId: 'c1', event: 'CursorAnswer', answer: 'two' })
    expect(first.controller.lastCursorAnswer('c1')).toBe('two')
    first.controller.removeSession('c1')
    expect(first.controller.lastCursorAnswer('c1')).toBeNull()

    const second = setup([{ id: 'c2', name: 'C', cwd: tempDir(), groupId: null, statusId: 'todo', order: 0, createdAt: 1, claudeArgs: [], agent: 'cursor' }])
    second.controller.handleHookEvent({ sessionId: 'c2', event: 'CursorAnswer', answer: 'bye' })
    second.controller.closeSession('c2')
    expect(second.controller.lastCursorAnswer('c2')).toBeNull()
  })

  it('still records activity for a Cursor prompt and Stop', () => {
    const { controller, stateOf } = setup([{ id: 'c1', name: 'C', cwd: tempDir(), groupId: null, statusId: 'todo', order: 0, createdAt: 1, claudeArgs: [], agent: 'cursor' }])

    controller.handleHookEvent({ sessionId: 'c1', event: 'UserPromptSubmit', chatId: CHAT_ID })
    expect(stateOf('c1')?.activity).toBe('working')
    controller.handleHookEvent({ sessionId: 'c1', event: 'Stop', chatId: CHAT_ID })
    expect(stateOf('c1')?.activity).toBe('finished')
  })
})

describe('cursor sessions: launch and lifecycle', () => {
  it('installs the Cursor hooks before the start and resumes with the known chat id', () => {
    const { controller, store, pty, attention } = setup()
    const created = controller.createSession({ cwd: tempDir(), agent: 'cursor' })
    expect(attention.prepareCursor).toHaveBeenCalled()
    expect(pty.getLastStartOpts(created.id)!.command).toBe('cursor-agent')
    expect(pty.getLastStartOpts(created.id)!.internalArgs).toEqual(['--force', '--trust'])

    controller.handleHookEvent({ sessionId: created.id, event: 'UserPromptSubmit', chatId: CHAT_ID })
    controller.sleepSession(created.id)
    controller.setActiveSession(created.id)

    expect(pty.getLastStartOpts(created.id)!.internalArgs).toEqual(['--force', '--trust', '--resume', CHAT_ID])
    expect(store.get().sessions.find((s) => s.id === created.id)!.claudeSessionId).toBeUndefined()
  })

  it('starts the session even when installing the hooks throws', () => {
    const { controller, pty } = setup([], { prepareCursorThrows: true })
    const created = controller.createSession({ cwd: tempDir(), agent: 'cursor' })
    expect(pty.getLastStartOpts(created.id)).toBeDefined()
  })

  it('never creates a Claude conversation id for a restored Cursor session', () => {
    const { controller, store } = setup([{ id: 'c1', name: 'C', cwd: tempDir(), groupId: null, statusId: 'todo', order: 0, createdAt: 1, claudeArgs: [], agent: 'cursor' }])
    controller.initializeRestoredSessions()
    expect(store.get().sessions[0].claudeSessionId).toBeUndefined()
  })

  it('refuses to fork a Cursor session with a clear message', async () => {
    const { controller } = setup([{ id: 'c1', name: 'C', cwd: tempDir(), groupId: null, statusId: 'todo', order: 0, createdAt: 1, claudeArgs: [], agent: 'cursor', cursorChatId: CHAT_ID }])
    await expect(controller.forkSession('c1')).rejects.toThrow('Forking a Cursor session is not supported yet')
  })
})

describe('cursor sessions: setOpencodeModel (D81)', () => {
  const NEW_MODEL = 'sonnet-4-thinking'

  it('restarts a running conversation that has a chat id on the new model (--resume + --model)', () => {
    const { controller, store, pty, stateOf } = setup()
    const created = controller.createSession({ cwd: tempDir(), agent: 'cursor', model: 'gpt-5' })
    controller.handleHookEvent({ sessionId: created.id, event: 'UserPromptSubmit', chatId: CHAT_ID })

    expect(controller.setOpencodeModel(created.id, NEW_MODEL)).toBe('restarted')

    expect(store.get().sessions.find((s) => s.id === created.id)!.model).toBe(NEW_MODEL)
    expect(pty.getLastStartOpts(created.id)!.internalArgs).toEqual([
      '--force',
      '--trust',
      '--model',
      NEW_MODEL,
      '--resume',
      CHAT_ID
    ])
    expect(stateOf(created.id)?.sleeping).not.toBe(true)
    expect(stateOf(created.id)?.run).toBe('running')
  })

  it('only stores the model for a running session with no chat id yet; the next start uses it', () => {
    const { controller, store, pty, stateOf } = setup()
    const created = controller.createSession({ cwd: tempDir(), agent: 'cursor', model: 'gpt-5' })
    const before = pty.getLastStartOpts(created.id)

    expect(controller.setOpencodeModel(created.id, NEW_MODEL)).toBe('next-start')

    expect(store.get().sessions.find((s) => s.id === created.id)!.model).toBe(NEW_MODEL)
    expect(pty.getLastStartOpts(created.id)).toBe(before)
    expect(stateOf(created.id)?.sleeping).not.toBe(true)

    controller.sleepSession(created.id)
    controller.setActiveSession(created.id)
    expect(pty.getLastStartOpts(created.id)!.internalArgs).toEqual(['--force', '--trust', '--model', NEW_MODEL])
  })

  it('clears the model with undefined, keeps the chat, and does not restart for the same value', () => {
    const { controller, store, pty } = setup()
    const created = controller.createSession({ cwd: tempDir(), agent: 'cursor', model: 'gpt-5' })
    controller.handleHookEvent({ sessionId: created.id, event: 'UserPromptSubmit', chatId: CHAT_ID })

    const before = pty.getLastStartOpts(created.id)
    expect(controller.setOpencodeModel(created.id, 'gpt-5')).toBe('next-start')
    expect(pty.getLastStartOpts(created.id)).toBe(before)

    expect(controller.setOpencodeModel(created.id, undefined)).toBe('restarted')
    expect(store.get().sessions.find((s) => s.id === created.id)!.model).toBeUndefined()
    expect(pty.getLastStartOpts(created.id)!.internalArgs).toEqual(['--force', '--trust', '--resume', CHAT_ID])
  })

  it('rejects a bad Cursor model name and accepts what only the Cursor rule allows', () => {
    const { controller, store } = setup()
    const created = controller.createSession({ cwd: tempDir(), agent: 'cursor', model: 'gpt-5' })

    expect(() => controller.setOpencodeModel(created.id, 'gpt 5')).toThrow(
      '"gpt 5" is not a Cursor model name: use letters, digits and . _ : / @ - only, like gpt-5 or sonnet-4-thinking.'
    )
    expect(() => controller.setOpencodeModel(created.id, 'provider model')).toThrow('is not a Cursor model name')
    expect(() => controller.setOpencodeModel(created.id, `g${'x'.repeat(100)}`)).toThrow('is not a Cursor model name')
    expect(store.get().sessions.find((s) => s.id === created.id)!.model).toBe('gpt-5')

    // '@' is refused by the OpenCode rule and allowed by Cursor's: this session used the Cursor rule.
    expect(controller.setOpencodeModel(created.id, 'gpt-5@latest')).toBe('next-start')
    expect(store.get().sessions.find((s) => s.id === created.id)!.model).toBe('gpt-5@latest')
  })
})
