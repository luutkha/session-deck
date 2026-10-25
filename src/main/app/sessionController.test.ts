import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Id, Session, StoreData, AttentionReason } from '../../shared/types'
import { SessionStore } from '../store'
import { createSessionController } from './sessionController'
import { createActiveSessions } from './activeSessions'
import { PtyManager, type StartOptions } from '../pty/PtyManager'
import type { AttentionService } from '../attention/AttentionService'
import { createRuntimeRegistry } from './runtimeRegistry'
import { MAIN_ERROR_LOG_FILE } from './errorLog'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'sessiondeck-test-'))
}

function makeSession(overrides: Partial<Session> & { id: Id; name: string }): Session {
  return {
    cwd: tempDir(),
    groupId: null,
    statusId: null,
    order: 0,
    createdAt: Date.now(),
    claudeArgs: [],
    claudeSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    ...overrides
  } as Session
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
  writes: string[]
  resizes: Array<{ cols: number; rows: number }>
  killed: boolean
  exitCode: number | null
  startOpts: StartOptions
  buffer: string
}

interface TestPtyManager extends PtyManager {
  fireData: (id: Id, data: string) => void
  fireExit: (id: Id, code: number | null) => void
  getLastStartOpts: (id: Id) => StartOptions | undefined
}

function createMockPtyManager(): TestPtyManager {
  const processes = new Map<Id, MockProcess>()
  const dataListeners = new Set<(id: Id, data: string, seq: number) => void>()
  const exitListeners = new Set<(id: Id, code: number | null) => void>()

  const mockPty = {
    processes,
    dataListeners,
    exitListeners,

    start(opts: StartOptions): void {
      const previous = processes.get(opts.sessionId)
      if (previous && !previous.killed) {
        throw new Error(`Session already running: ${opts.sessionId}`)
      }
      processes.set(opts.sessionId, {
        writes: [],
        resizes: [],
        killed: false,
        exitCode: null,
        startOpts: opts,
        buffer: ''
      })
    },

    restart(opts: StartOptions): void {
      const existing = processes.get(opts.sessionId)
      if (existing) {
        existing.killed = true
      }
      processes.set(opts.sessionId, {
        writes: [],
        resizes: [],
        killed: false,
        exitCode: null,
        startOpts: opts,
        buffer: ''
      })
    },

    write(id: Id, data: string): void {
      const proc = processes.get(id)
      if (!proc) throw new Error(`Session not running: ${id}`)
      proc.writes.push(data)
      proc.buffer += data
    },

    resize(id: Id, cols: number, rows: number): void {
      const proc = processes.get(id)
      if (!proc) return
      proc.resizes.push({ cols, rows })
    },

    kill(id: Id): void {
      const proc = processes.get(id)
      if (proc) proc.killed = true
    },

    killAll(): void {
      for (const proc of processes.values()) {
        proc.killed = true
      }
    },

    replay(id: Id): { data: string; seq: number } {
      const proc = processes.get(id)
      if (!proc) return { data: '', seq: 0 }
      return { data: proc.buffer, seq: proc.writes.length }
    },

    isRunning(id: Id): boolean {
      const proc = processes.get(id)
      return proc !== undefined && !proc.killed
    },

    onData(cb: (id: Id, data: string, seq: number) => void): () => void {
      dataListeners.add(cb)
      return () => dataListeners.delete(cb)
    },

    onExit(cb: (id: Id, code: number | null) => void): () => void {
      exitListeners.add(cb)
      return () => exitListeners.delete(cb)
    },

    fireData(id: Id, data: string): void {
      const proc = processes.get(id)
      if (proc) {
        proc.buffer += data
      }
      let seq = 0
      for (const cb of dataListeners) {
        seq++
        cb(id, data, seq)
      }
    },

    fireExit(id: Id, code: number | null): void {
      const proc = processes.get(id)
      if (proc) {
        proc.exitCode = code
        proc.killed = true
      }
      for (const cb of exitListeners) {
        cb(id, code)
      }
    },

    getLastStartOpts(id: Id): StartOptions | undefined {
      return processes.get(id)?.startOpts
    },

    dispose(): void {
      for (const proc of processes.values()) {
        proc.killed = true
      }
      processes.clear()
      dataListeners.clear()
      exitListeners.clear()
    }
  } as unknown as TestPtyManager

  return mockPty
}

function createFakeAttention(): AttentionService {
  let started = true
  const settingsFilePath = '/fake/settings.json'
  const port = 12345
  const token = 'fake-token'
  const attentionMap = new Map<Id, AttentionReason | null>()

  return {
    async start() {
      started = true
    },
    async stop() {
      started = false
    },
    claudeArgs(): string[] {
      if (!started) throw new Error('AttentionService not started')
      return ['--settings', settingsFilePath]
    },
    envFor(sessionId: string): Record<string, string> {
      if (!started) throw new Error('AttentionService not started')
      return {
        SESSIONDECK_SESSION_ID: sessionId,
        SESSIONDECK_PORT: String(port),
        SESSIONDECK_TOKEN: token
      }
    },
    opencodeEnv(): Record<string, string> {
      if (!started) throw new Error('AttentionService not started')
      return { OPENCODE_CONFIG_CONTENT: '{}' }
    },
    workerEnv(): Record<string, string> {
      return { OPENCODE_CONFIG_CONTENT: '{"plugin":[]}' }
    },
    endpoint(): { port: number; token: string } {
      return { port, token }
    },
    noteOutput(_id: string): void {},
    noteInput(_id: string): void {},
    clear(id: string): void {
      attentionMap.delete(id)
    },
    markUnread(id: string): void {
      if (!attentionMap.has(id)) attentionMap.set(id, 'unread')
    },
    get(id: string): AttentionReason | null {
      return attentionMap.get(id) ?? null
    },
    onChange(_callback: (id: string, reason: AttentionReason | null) => void): () => void {
      return () => {}
    },
    setSoundEnabled(_enabled: boolean): void {},
    suspend(_id: string): void {},
    forget(id: string): void {
      attentionMap.delete(id)
    },
    raise(id: string, reason: AttentionReason): void {
      attentionMap.set(id, reason)
    }
  }
}

const createdDirs: string[] = []

afterEach(() => {
  for (const dir of createdDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  createdDirs.length = 0
})

function setupController(initialSessions: Session[] = []) {
  const initialData = makeStoreData(initialSessions)
  const saved: StoreData[] = []
  const saver = { schedule: (d: StoreData) => saved.push(d) }
  const deps = { newId: () => `id-${Date.now()}-${Math.random()}`, now: () => Date.now() }
  const store = new SessionStore(initialData, saver, deps)

  const pty = createMockPtyManager()

  const attention = createFakeAttention()
  const runtime = createRuntimeRegistry()

  const sendPtyData = vi.fn()
  const userDataDir = tempDir()
  createdDirs.push(userDataDir)

  const activeSessions = createActiveSessions()
  const controller = createSessionController({ store, pty, attention, runtime, sendPtyData, userDataDir, activeSessions })

  return { controller, store, pty, attention, runtime, sendPtyData, saved, userDataDir, activeSessions }
}

function readErrorLog(dir: string): string {
  const path = join(dir, MAIN_ERROR_LOG_FILE)
  return existsSync(path) ? readFileSync(path, 'utf-8') : ''
}

describe('sessionController', () => {
  it('removeSession clears the per-window on-screen entry of the removed session', () => {
    const { controller, activeSessions } = setupController()
    const session = controller.createSession({ cwd: tempDir() })
    activeSessions.set('main', session.id)
    activeSessions.set('code', session.id)

    controller.removeSession(session.id)

    expect(activeSessions.all()).toEqual([])
  })

  it('removeSession leaves other sessions on screen', () => {
    const { controller, activeSessions } = setupController()
    const one = controller.createSession({ cwd: tempDir() })
    const two = controller.createSession({ cwd: tempDir() })
    activeSessions.set('main', one.id)
    activeSessions.set('code', two.id)

    controller.removeSession(one.id)

    expect(activeSessions.get('main')).toBeNull()
    expect(activeSessions.get('code')).toBe(two.id)
  })

  it('createSession uses --session-id for new sessions', () => {
    const { controller, pty } = setupController()
    const session = controller.createSession({ cwd: tempDir() })

    expect(session.claudeSessionId).toBeDefined()
    const opts = pty.getLastStartOpts(session.id)
    expect(opts?.internalArgs).toContain('--session-id')
    expect(opts?.internalArgs).toContain(session.claudeSessionId)
    expect(opts?.internalArgs).not.toContain('--resume')
  })

  it('createSession starts the session and marks it running', () => {
    const { controller, pty, runtime } = setupController()
    const session = controller.createSession({ cwd: tempDir() })

    expect(pty.isRunning(session.id)).toBe(true)
    const state = runtime.snapshot().find((s: { sessionId: string }) => s.sessionId === session.id)
    expect(state?.run).toBe('running')
  })

  it('createSession cleans up on start failure', () => {
    const { controller, pty } = setupController()
    const originalStart = pty.start.bind(pty)
    pty.start = vi.fn().mockImplementation(() => { throw new Error('spawn failed') })

    expect(() => controller.createSession({ cwd: tempDir() })).toThrow('spawn failed')
    pty.start = originalStart
  })

  it('restored session without claudeSessionId gets one and starts with --session-id on first activation', () => {
    const cwd = tempDir()
    const session = makeSession({ id: 'restored-1', name: 'Restored', cwd, claudeSessionId: undefined })
    const { controller, pty, store } = setupController([session])

    controller.initializeRestoredSessions()
    controller.setActiveSession('restored-1')

    const updated = store.get().sessions.find((s) => s.id === 'restored-1')
    expect(updated?.claudeSessionId).toBeDefined()

    const opts = pty.getLastStartOpts('restored-1')
    expect(opts?.internalArgs).toContain('--session-id')
    expect(opts?.internalArgs).toContain(updated!.claudeSessionId!)
    expect(opts?.internalArgs).not.toContain('--resume')
  })

  it('restored session with claudeSessionId resumes on first activation', () => {
    const cwd = tempDir()
    const session = makeSession({ id: 'restored-2', name: 'Restored', cwd })
    const { controller, pty } = setupController([session])

    controller.initializeRestoredSessions()
    controller.setActiveSession('restored-2')

    const opts = pty.getLastStartOpts('restored-2')
    expect(opts?.internalArgs).toContain('--resume')
    expect(opts?.internalArgs).toContain(session.claudeSessionId)
    expect(opts?.internalArgs).not.toContain('--session-id')
  })

  it('restartSession uses --resume for existing conversation', () => {
    const cwd = tempDir()
    const session = makeSession({ id: 'restart-test', name: 'Restart', cwd })
    const { controller, pty } = setupController([session])

    controller.initializeRestoredSessions()
    controller.setActiveSession('restart-test')
    controller.restartSession('restart-test')

    const opts = pty.getLastStartOpts('restart-test')
    expect(opts?.internalArgs).toContain('--resume')
    expect(opts?.internalArgs).toContain(session.claudeSessionId)
  })

  it('fallback after fast failed resume restarts with --session-id', () => {
    const cwd = tempDir()
    const session = makeSession({ id: 'fallback-test', name: 'Fallback', cwd })
    const { controller, pty, runtime } = setupController([session])

    controller.initializeRestoredSessions()
    controller.setActiveSession('fallback-test')

    pty.fireData('fallback-test', 'Error: No conversation found for session')
    pty.fireExit('fallback-test', 1)

    const opts = pty.getLastStartOpts('fallback-test')
    expect(opts?.internalArgs).toContain('--session-id')
    expect(opts?.internalArgs).not.toContain('--resume')
    expect(runtime.snapshot().find((s) => s.sessionId === 'fallback-test')?.run).toBe('running')
  })

  it('no fallback for slow resume exit', () => {
    const cwd = tempDir()
    const session = makeSession({ id: 'slow-exit', name: 'Slow', cwd })
    const { controller, pty, runtime } = setupController([session])

    controller.initializeRestoredSessions()
    controller.setActiveSession('slow-exit')

    vi.useFakeTimers()
    vi.advanceTimersByTime(9000)
    pty.fireExit('slow-exit', 1)
    vi.useRealTimers()

    const opts = pty.getLastStartOpts('slow-exit')
    expect(opts?.internalArgs).toContain('--resume')
    expect(runtime.snapshot().find((s) => s.sessionId === 'slow-exit')?.run).toBe('exited')
  })

  it('no fallback for successful resume exit (code 0)', () => {
    const cwd = tempDir()
    const session = makeSession({ id: 'success-exit', name: 'Success', cwd })
    const { controller, pty, runtime } = setupController([session])

    controller.initializeRestoredSessions()
    controller.setActiveSession('success-exit')

    pty.fireExit('success-exit', 0)

    const opts = pty.getLastStartOpts('success-exit')
    expect(opts?.internalArgs).toContain('--resume')
    expect(runtime.snapshot().find((s) => s.sessionId === 'success-exit')?.run).toBe('exited')
  })

  it('no fallback for non-matching error output', () => {
    const cwd = tempDir()
    const session = makeSession({ id: 'other-error', name: 'OtherError', cwd })
    const { controller, pty, runtime } = setupController([session])

    controller.initializeRestoredSessions()
    controller.setActiveSession('other-error')

    pty.fireData('other-error', 'Some unrelated error message')
    pty.fireExit('other-error', 1)

    const opts = pty.getLastStartOpts('other-error')
    expect(opts?.internalArgs).toContain('--resume')
    expect(runtime.snapshot().find((s) => s.sessionId === 'other-error')?.run).toBe('exited')
  })

  it('never auto-starts at launch (only on setActiveSession)', () => {
    const cwd = tempDir()
    const session = makeSession({ id: 'no-auto', name: 'NoAuto', cwd })
    const { controller, pty } = setupController([session])

    controller.initializeRestoredSessions()

    expect(pty.isRunning('no-auto')).toBe(false)
  })

  it('does not start session whose cwd no longer exists', () => {
    const cwd = tempDir()
    rmSync(cwd, { recursive: true, force: true })
    const session = makeSession({ id: 'bad-cwd', name: 'BadCwd', cwd })
    const { controller, pty, runtime } = setupController([session])

    controller.initializeRestoredSessions()
    controller.setActiveSession('bad-cwd')

    expect(pty.isRunning('bad-cwd')).toBe(false)
    const state = runtime.snapshot().find((s) => s.sessionId === 'bad-cwd')
    expect(state?.run).toBe('exited')
    expect(state?.exitCode).toBeNull()
  })

  it('removed session cleanup clears startState', () => {
    const cwd = tempDir()
    const session = makeSession({ id: 'remove-me', name: 'RemoveMe', cwd })
    const { controller, pty, store } = setupController([session])

    controller.initializeRestoredSessions()
    controller.setActiveSession('remove-me')
    controller.removeSession('remove-me')

    expect(store.get().sessions).toHaveLength(0)
    expect(pty.isRunning('remove-me')).toBe(false)
  })

  it('internalArgs include attention.claudeArgs before chosen args', () => {
    const { controller, pty } = setupController()
    const session = controller.createSession({ cwd: tempDir() })

    const opts = pty.getLastStartOpts(session.id)
    const settingsIdx = opts?.internalArgs.indexOf('--settings') ?? -1
    const sessionIdIdx = opts?.internalArgs.indexOf('--session-id') ?? -1
    expect(settingsIdx).toBeGreaterThan(-1)
    expect(sessionIdIdx).toBeGreaterThan(settingsIdx)
  })

  it('fallback happens at most once per start attempt', () => {
    const cwd = tempDir()
    const session = makeSession({ id: 'fallback-once', name: 'FallbackOnce', cwd })
    const { controller, pty, runtime } = setupController([session])

    controller.initializeRestoredSessions()
    controller.setActiveSession('fallback-once')

    pty.fireData('fallback-once', 'Error: No conversation found for session')
    pty.fireExit('fallback-once', 1)

    const opts1 = pty.getLastStartOpts('fallback-once')
    expect(opts1?.internalArgs).toContain('--session-id')

    pty.fireData('fallback-once', 'Error: No conversation found for session')
    pty.fireExit('fallback-once', 1)

    const opts2 = pty.getLastStartOpts('fallback-once')
    expect(opts2?.internalArgs).toContain('--session-id')
    expect(runtime.snapshot().find((s) => s.sessionId === 'fallback-once')?.run).toBe('exited')
  })

  describe('closeSession / reopenSession', () => {
    function startedController(sessions: Session[]) {
      const setup = setupController(sessions)
      setup.controller.initializeRestoredSessions()
      return setup
    }

    it('closeSession kills the running process and stores closedAt', () => {
      const session = makeSession({ id: 'close-kill', name: 'CloseKill', cwd: tempDir() })
      const { controller, pty, store, runtime } = startedController([session])
      controller.setActiveSession('close-kill')
      const killSpy = vi.spyOn(pty, 'kill')

      controller.closeSession('close-kill')

      expect(killSpy).toHaveBeenCalledWith('close-kill')
      expect(pty.isRunning('close-kill')).toBe(false)
      expect(store.get().sessions[0].closedAt).toEqual(expect.any(Number))
      const state = runtime.snapshot().find((s) => s.sessionId === 'close-kill')
      expect(state?.run).toBe('exited')
      expect(state?.exitCode).toBeNull()
    })

    it('closeSession keeps name, folder, group, status and claude conversation id', () => {
      const session = makeSession({
        id: 'close-keep',
        name: 'Keep',
        cwd: tempDir(),
        groupId: 'g1',
        statusId: 'working'
      })
      const { controller, store } = startedController([session])

      controller.closeSession('close-keep')

      const closed = store.get().sessions[0]
      expect(closed.name).toBe('Keep')
      expect(closed.cwd).toBe(session.cwd)
      expect(closed.groupId).toBe('g1')
      expect(closed.statusId).toBe('working')
      expect(closed.claudeSessionId).toBe(session.claudeSessionId)
    })

    it('closeSession clears the active session and forgets attention', () => {
      const session = makeSession({ id: 'close-active', name: 'Active', cwd: tempDir() })
      const { controller, attention } = startedController([session])
      controller.setActiveSession('close-active')
      const forgetSpy = vi.spyOn(attention, 'forget')

      controller.closeSession('close-active')

      expect(controller.getActiveSessionId()).toBeNull()
      expect(forgetSpy).toHaveBeenCalledWith('close-active')
    })

    it('closeSession does not change the active session when another session is active', () => {
      const a = makeSession({ id: 'a', name: 'A', cwd: tempDir() })
      const b = makeSession({ id: 'b', name: 'B', cwd: tempDir() })
      const { controller } = startedController([a, b])
      controller.setActiveSession('a')

      controller.closeSession('b')

      expect(controller.getActiveSessionId()).toBe('a')
    })

    it('closeSession does not call kill when the process is not running', () => {
      const session = makeSession({ id: 'close-idle', name: 'Idle', cwd: tempDir() })
      const { controller, pty } = startedController([session])
      const killSpy = vi.spyOn(pty, 'kill')

      controller.closeSession('close-idle')

      expect(killSpy).not.toHaveBeenCalled()
    })

    it('closeSession throws for an unknown id and kills nothing', () => {
      const session = makeSession({ id: 'known', name: 'Known', cwd: tempDir() })
      const { controller, pty } = startedController([session])
      controller.setActiveSession('known')
      const killSpy = vi.spyOn(pty, 'kill')

      expect(() => controller.closeSession('nope')).toThrow('Unknown session: nope')
      expect(killSpy).not.toHaveBeenCalled()
      expect(pty.isRunning('known')).toBe(true)
    })

    it('a process exit after close keeps the exit code null and does not fall back', () => {
      const session = makeSession({ id: 'close-exit', name: 'CloseExit', cwd: tempDir() })
      const { controller, pty, runtime } = startedController([session])
      controller.setActiveSession('close-exit')
      controller.closeSession('close-exit')

      pty.fireData('close-exit', 'Error: No conversation found for session')
      pty.fireExit('close-exit', 1)

      const state = runtime.snapshot().find((s) => s.sessionId === 'close-exit')
      expect(state?.run).toBe('exited')
      expect(state?.exitCode).toBeNull()
      expect(pty.isRunning('close-exit')).toBe(false)
    })

    it('a closed session is not auto-started by setActiveSession', () => {
      const session = makeSession({ id: 'closed-no-start', name: 'Closed', cwd: tempDir(), closedAt: 100 })
      const { controller, pty } = startedController([session])

      controller.setActiveSession('closed-no-start')

      expect(pty.isRunning('closed-no-start')).toBe(false)
      expect(pty.getLastStartOpts('closed-no-start')).toBeUndefined()
      expect(controller.getActiveSessionId()).toBeNull()
    })

    it('reopenSession clears closedAt and starts with --resume and the same conversation', () => {
      const session = makeSession({ id: 'reopen-resume', name: 'Reopen', cwd: tempDir() })
      const { controller, pty, store, runtime } = startedController([session])
      controller.setActiveSession('reopen-resume')
      controller.closeSession('reopen-resume')

      controller.reopenSession('reopen-resume')

      expect(store.get().sessions[0].closedAt).toBeUndefined()
      const opts = pty.getLastStartOpts('reopen-resume')
      expect(opts?.internalArgs).toContain('--resume')
      expect(opts?.internalArgs).toContain(session.claudeSessionId)
      expect(opts?.internalArgs).not.toContain('--session-id')
      expect(pty.isRunning('reopen-resume')).toBe(true)
      expect(runtime.snapshot().find((s) => s.sessionId === 'reopen-resume')?.run).toBe('running')
    })

    it('reopenSession of a previously closed (never started this run) session starts it with --resume', () => {
      const session = makeSession({ id: 'reopen-cold', name: 'Cold', cwd: tempDir(), closedAt: 100 })
      const { controller, pty } = startedController([session])

      controller.reopenSession('reopen-cold')

      const opts = pty.getLastStartOpts('reopen-cold')
      expect(opts?.internalArgs).toContain('--resume')
      expect(pty.isRunning('reopen-cold')).toBe(true)
    })

    it('reopenSession falls back to a fresh start when the conversation does not exist', () => {
      const session = makeSession({ id: 'reopen-fallback', name: 'Fallback', cwd: tempDir(), closedAt: 100 })
      const { controller, pty } = startedController([session])
      controller.reopenSession('reopen-fallback')

      pty.fireData('reopen-fallback', 'Error: No conversation found for session')
      pty.fireExit('reopen-fallback', 1)

      const opts = pty.getLastStartOpts('reopen-fallback')
      expect(opts?.internalArgs).toContain('--session-id')
      expect(opts?.internalArgs).not.toContain('--resume')
    })

    it('reopenSession with a missing folder reopens the session, marks it exited and throws', () => {
      const cwd = tempDir()
      const session = makeSession({ id: 'reopen-missing', name: 'Missing', cwd, closedAt: 100 })
      const { controller, pty, store, runtime } = startedController([session])
      rmSync(cwd, { recursive: true, force: true })

      expect(() => controller.reopenSession('reopen-missing')).toThrow(`Directory not found: ${cwd}`)

      expect(store.get().sessions[0].closedAt).toBeUndefined()
      expect(pty.isRunning('reopen-missing')).toBe(false)
      const state = runtime.snapshot().find((s) => s.sessionId === 'reopen-missing')
      expect(state?.run).toBe('exited')
      expect(state?.exitCode).toBeNull()
    })

    it('reopenSession with an unknown id throws', () => {
      const { controller } = startedController([])
      expect(() => controller.reopenSession('nope')).toThrow('Unknown session: nope')
    })

    it('reopenSession refuses while the old process is still stopping and keeps the session closed', () => {
      const session = makeSession({ id: 'reopen-busy', name: 'Busy', cwd: tempDir() })
      const { controller, pty, store } = startedController([session])
      controller.setActiveSession('reopen-busy')
      const realIsRunning = pty.isRunning.bind(pty)
      controller.closeSession('reopen-busy')
      vi.spyOn(pty, 'isRunning').mockImplementation((id: Id) => (id === 'reopen-busy' ? true : realIsRunning(id)))

      expect(() => controller.reopenSession('reopen-busy')).toThrow('Session is still stopping: reopen-busy')
      expect(store.get().sessions[0].closedAt).toEqual(expect.any(Number))
    })

    it('removeSession on a closed session works and does not kill a process that is not running', () => {
      const session = makeSession({ id: 'remove-closed', name: 'RemoveClosed', cwd: tempDir(), closedAt: 100 })
      const { controller, pty, store } = startedController([session])
      const killSpy = vi.spyOn(pty, 'kill')

      controller.removeSession('remove-closed')

      expect(killSpy).not.toHaveBeenCalled()
      expect(store.get().sessions).toHaveLength(0)
    })

    it('restartSession rejects a closed session', async () => {
      const session = makeSession({ id: 'restart-closed', name: 'RestartClosed', cwd: tempDir(), closedAt: 100 })
      const { controller, pty } = startedController([session])

      await expect(controller.restartSession('restart-closed')).rejects.toThrow('Session is closed: restart-closed')
      expect(pty.isRunning('restart-closed')).toBe(false)
    })
  })

  describe('writeToPty / resizePty', () => {
    it('writeToPty for an unknown session is a no-op and records no input', () => {
      const { controller, pty, attention } = setupController()
      const noteSpy = vi.spyOn(attention, 'noteInput')
      const writeSpy = vi.spyOn(pty, 'write')

      expect(() => controller.writeToPty('ghost', 'ls\r')).not.toThrow()
      expect(noteSpy).not.toHaveBeenCalled()
      expect(writeSpy).not.toHaveBeenCalled()
    })

    it('writeToPty for a known but exited session does not throw and records the input for attention', () => {
      const session = makeSession({ id: 'exited-write', name: 'Exited', cwd: tempDir() })
      const { controller, pty, attention } = setupController([session])
      controller.initializeRestoredSessions()
      const noteSpy = vi.spyOn(attention, 'noteInput')
      const writeSpy = vi.spyOn(pty, 'write')

      expect(() => controller.writeToPty('exited-write', 'hello')).not.toThrow()
      expect(noteSpy).toHaveBeenCalledWith('exited-write')
      expect(writeSpy).not.toHaveBeenCalled()
    })

    it('writeToPty forwards data to a running session', () => {
      const session = makeSession({ id: 'running-write', name: 'Running', cwd: tempDir() })
      const { controller, pty } = setupController([session])
      controller.initializeRestoredSessions()
      controller.setActiveSession('running-write')

      controller.writeToPty('running-write', 'ls\r')

      expect(pty.getLastStartOpts('running-write')).toBeDefined()
      const writeSpy = vi.spyOn(pty, 'write')
      controller.writeToPty('running-write', 'pwd\r')
      expect(writeSpy).toHaveBeenCalledWith('running-write', 'pwd\r')
    })

    it('resizePty for an unknown or non-running session is a no-op', () => {
      const session = makeSession({ id: 'idle-resize', name: 'Idle', cwd: tempDir() })
      const { controller, pty } = setupController([session])
      controller.initializeRestoredSessions()
      const resizeSpy = vi.spyOn(pty, 'resize')

      expect(() => controller.resizePty('ghost', 80, 24)).not.toThrow()
      expect(() => controller.resizePty('idle-resize', 80, 24)).not.toThrow()
      expect(resizeSpy).not.toHaveBeenCalled()
    })
  })

  describe('createSession validation', () => {
    it('leaves no session behind when the folder does not exist', () => {
      const cwd = tempDir()
      rmSync(cwd, { recursive: true, force: true })
      const { controller, store, runtime } = setupController()
      const runtimeBefore = runtime.snapshot().length

      expect(() => controller.createSession({ cwd })).toThrow(`Directory not found: ${cwd}`)

      expect(store.get().sessions).toHaveLength(0)
      expect(runtime.snapshot()).toHaveLength(runtimeBefore)
    })
  })

  describe('process exit handling', () => {
    it('ignores an exit for a session that was removed from the store', () => {
      const session = makeSession({ id: 'gone', name: 'Gone', cwd: tempDir() })
      const { controller, pty, runtime } = setupController([session])
      controller.initializeRestoredSessions()
      controller.setActiveSession('gone')
      controller.removeSession('gone')
      const listener = vi.fn()
      runtime.subscribe(listener)

      expect(() => pty.fireExit('gone', 1)).not.toThrow()

      expect(listener).not.toHaveBeenCalled()
      expect(runtime.snapshot().find((s) => s.sessionId === 'gone')).toBeUndefined()
    })

    it('a failing automatic fallback restart marks the session exited, logs, and does not throw', () => {
      const session = makeSession({ id: 'fallback-fail', name: 'FallbackFail', cwd: tempDir() })
      const { controller, pty, runtime, userDataDir } = setupController([session])
      controller.initializeRestoredSessions()
      controller.setActiveSession('fallback-fail')
      vi.spyOn(pty, 'restart').mockImplementation(() => {
        throw new Error('restart boom')
      })

      pty.fireData('fallback-fail', 'Error: No conversation found for session')
      expect(() => pty.fireExit('fallback-fail', 1)).not.toThrow()

      const state = runtime.snapshot().find((s) => s.sessionId === 'fallback-fail')
      expect(state?.run).toBe('exited')
      expect(state?.exitCode).toBeNull()
      expect(readErrorLog(userDataDir)).toContain('restart boom')
    })
  })

  describe('restartSession failure', () => {
    it('restores the previous start state when pty.restart throws, so a later start is not blocked', async () => {
      const session = makeSession({ id: 'restart-fail', name: 'RestartFail', cwd: tempDir() })
      const { controller, pty, runtime } = setupController([session])
      controller.initializeRestoredSessions()
      vi.spyOn(pty, 'restart').mockImplementation(() => {
        throw new Error('spawn denied')
      })

      await expect(controller.restartSession('restart-fail')).rejects.toThrow('spawn denied')
      expect(runtime.snapshot().find((s) => s.sessionId === 'restart-fail')?.run).not.toBe('running')

      vi.restoreAllMocks()
      controller.setActiveSession('restart-fail')

      const opts = pty.getLastStartOpts('restart-fail')
      expect(opts?.internalArgs).toContain('--resume')
      expect(pty.isRunning('restart-fail')).toBe(true)
    })
  })
})