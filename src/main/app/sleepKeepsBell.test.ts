import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Id, Session, StoreData } from '../../shared/types'
import { SessionStore } from '../store'
import { createSessionController, type SessionController } from './sessionController'
import type { PtyManager, StartOptions } from '../pty/PtyManager'
import { createAttentionService, type AttentionService } from '../attention/AttentionService'
import { createRuntimeRegistry, type RuntimeRegistry } from './runtimeRegistry'

// Uses the real AttentionService (bell, idle detector) wired the way main does: the controller subscribes to its changes.

const SESSION_ID = 's1'
const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sessiondeck-bell-'))
  dirs.push(dir)
  return dir
}

function makeSession(): Session {
  return {
    id: SESSION_ID,
    name: SESSION_ID,
    cwd: tempDir(),
    groupId: null,
    statusId: null,
    order: 0,
    createdAt: 1,
    claudeArgs: [],
    claudeSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  }
}

function makeStoreData(sessions: Session[]): StoreData {
  return { version: 1, sessions, groups: [], statuses: [], groupOrder: [] }
}

function createFakePty(): PtyManager {
  const running = new Set<Id>()
  const pty = {
    start(opts: StartOptions): void {
      running.add(opts.sessionId)
    },
    restart(opts: StartOptions): void {
      running.add(opts.sessionId)
    },
    kill(id: Id): void {
      running.delete(id)
    },
    isRunning: (id: Id): boolean => running.has(id),
    replay: (): { data: string; seq: number } => ({ data: '', seq: 0 }),
    onData: (): (() => void) => () => {},
    onExit: (): (() => void) => () => {}
  }
  return pty as unknown as PtyManager
}

interface Harness {
  readonly controller: SessionController
  readonly attention: AttentionService
  readonly runtime: RuntimeRegistry
  readonly store: SessionStore
}

async function setup(): Promise<Harness> {
  const session = makeSession()
  const store = new SessionStore(makeStoreData([session]), { schedule: vi.fn() }, { newId: () => 'x', now: () => 1 })
  const attention = createAttentionService({
    isKnownSession: (id) => id === SESSION_ID,
    isFocused: () => false,
    beep: () => {},
    flash: () => {},
    isWindowFocused: () => false,
    settingsDir: tempDir()
  })
  await attention.start()
  const runtime = createRuntimeRegistry()
  const controller = createSessionController({
    store,
    pty: createFakePty(),
    attention,
    runtime,
    sendPtyData: vi.fn(),
    userDataDir: tempDir()
  })
  controller.initializeRestoredSessions()
  controller.setActiveSession(SESSION_ID)
  return { controller, attention, runtime, store }
}

beforeEach(() => {
  dirs.length = 0
})

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

describe('sleep keeps the attention bell', () => {
  let h: Harness

  beforeEach(async () => {
    h = await setup()
  })

  afterEach(async () => {
    await h.attention.stop()
  })

  it('sleeping a session with a done bell keeps the reason and its time in the runtime state', () => {
    h.attention.raise(SESSION_ID, 'done')
    const raisedAt = h.runtime.get(SESSION_ID)!.attentionAt

    h.controller.sleepSession(SESSION_ID)

    const state = h.runtime.get(SESSION_ID)!
    expect(state.sleeping).toBe(true)
    expect(state.attention).toBe('done')
    expect(state.attentionAt).toBe(raisedAt)
    expect(h.attention.get(SESSION_ID)).toBe('done')
  })

  it('sleeping a session with a permission bell keeps it', () => {
    h.attention.raise(SESSION_ID, 'permission')

    h.controller.sleepSession(SESSION_ID)

    expect(h.runtime.get(SESSION_ID)!.attention).toBe('permission')
  })

  it('sleeping a session with no bell leaves attention null', () => {
    h.controller.sleepSession(SESSION_ID)

    expect(h.runtime.get(SESSION_ID)!.attention).toBeNull()
    expect(h.attention.get(SESSION_ID)).toBeNull()
  })

  it('waking a sleeping session keeps the bell until the user clears it', () => {
    h.attention.raise(SESSION_ID, 'done')
    h.controller.sleepSession(SESSION_ID)

    h.controller.setActiveSession(SESSION_ID)

    const state = h.runtime.get(SESSION_ID)!
    expect(state.run).toBe('running')
    expect(state.attention).toBe('done')
    expect(h.attention.get(SESSION_ID)).toBe('done')
  })

  it('clearing the bell of a sleeping session clears it in the runtime state too', () => {
    h.attention.raise(SESSION_ID, 'done')
    h.controller.sleepSession(SESSION_ID)

    h.attention.clear(SESSION_ID)

    const state = h.runtime.get(SESSION_ID)!
    expect(state.attention).toBeNull()
    expect(state).not.toHaveProperty('attentionAt')
  })

  it('Mark as unread still works on a sleeping session', () => {
    h.controller.sleepSession(SESSION_ID)

    h.attention.markUnread(SESSION_ID)

    expect(h.runtime.get(SESSION_ID)!.attention).toBe('unread')
  })

  it('closing a sleeping session erases its bell', () => {
    h.attention.raise(SESSION_ID, 'done')
    h.controller.sleepSession(SESSION_ID)

    h.controller.closeSession(SESSION_ID)

    expect(h.attention.get(SESSION_ID)).toBeNull()
    expect(h.runtime.get(SESSION_ID)!.attention).toBeNull()
  })

  it('removing a sleeping session erases its bell', () => {
    h.attention.raise(SESSION_ID, 'done')
    h.controller.sleepSession(SESSION_ID)

    h.controller.removeSession(SESSION_ID)

    expect(h.attention.get(SESSION_ID)).toBeNull()
    expect(h.runtime.get(SESSION_ID)).toBeUndefined()
  })

  it('closing a running session erases its bell', () => {
    h.attention.raise(SESSION_ID, 'done')

    h.controller.closeSession(SESSION_ID)

    expect(h.attention.get(SESSION_ID)).toBeNull()
    expect(h.runtime.get(SESSION_ID)!.attention).toBeNull()
  })
})
