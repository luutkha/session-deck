import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AttentionReason, Id, Session, StoreData } from '../../shared/types'
import { SessionStore } from '../store'
import { emptyStore } from '../store/reducers'
import type { PtyManager, StartOptions } from '../pty/PtyManager'
import type { AttentionService } from '../attention'
import { createRuntimeRegistry } from './runtimeRegistry'
import { createSessionController, type SessionController } from './sessionController'

const SHA = 'd'.repeat(40)
const tmpDirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sd-controller-code-'))
  tmpDirs.push(dir)
  return dir
}

/** A PTY stand-in: records starts and kills, and lets a test fire an exit. */
function fakePty() {
  const starts: StartOptions[] = []
  const killed: Id[] = []
  const forgetCalls: Id[] = []
  const running = new Map<Id, boolean>()
  const exitListeners = new Set<(id: Id, code: number | null) => void>()
  const pty = {
    starts,
    killed,
    forgetCalls,
    start(opts: StartOptions): void {
      if (running.get(opts.sessionId)) throw new Error(`Session already running: ${opts.sessionId}`)
      running.set(opts.sessionId, true)
      starts.push(opts)
    },
    restart(opts: StartOptions): void {
      running.set(opts.sessionId, true)
      starts.push(opts)
    },
    kill(id: Id): void {
      running.set(id, false)
      killed.push(id)
    },
    forget(id: Id): void {
      forgetCalls.push(id)
      running.delete(id)
    },
    isRunning(id: Id): boolean {
      return running.get(id) === true
    },
    replay(): { data: string; seq: number } {
      return { data: '', seq: 0 }
    },
    write(): void {},
    resize(): void {},
    onData(): () => void {
      return () => {}
    },
    onExit(cb: (id: Id, code: number | null) => void): () => void {
      exitListeners.add(cb)
      return () => exitListeners.delete(cb)
    },
    fireExit(id: Id, code: number | null): void {
      running.set(id, false)
      for (const cb of exitListeners) cb(id, code)
    }
  }
  return pty
}

function fakeAttention(): AttentionService {
  const reasons = new Map<Id, AttentionReason>()
  return {
    claudeArgs: () => ['--settings', 'x.json'],
    envFor: (id: string) => ({ SESSIONDECK_SESSION_ID: id }),
    opencodeEnv: () => ({ OPENCODE_CONFIG_CONTENT: '{}' }),
    workerEnv: () => ({ OPENCODE_CONFIG_CONTENT: '{"plugin":[]}' }),
    noteOutput(): void {},
    noteInput(): void {},
    clear: (id: Id) => reasons.delete(id),
    suspend(): void {},
    forget: (id: Id) => reasons.delete(id),
    onChange: () => () => {}
  } as unknown as AttentionService
}

interface Harness {
  readonly controller: SessionController
  readonly store: SessionStore
  readonly pty: ReturnType<typeof fakePty>
  readonly runtime: ReturnType<typeof createRuntimeRegistry>
}

function harness(initial: StoreData = emptyStore()): Harness {
  let counter = 0
  const store = new SessionStore(initial, { schedule: () => {} }, {
    newId: () => `id-${++counter}`,
    now: () => 1_000 + counter
  })
  const pty = fakePty()
  const runtime = createRuntimeRegistry(() => 1)
  const controller = createSessionController({
    store,
    pty: pty as unknown as PtyManager,
    attention: fakeAttention(),
    runtime,
    sendPtyData: () => {},
    userDataDir: tmpdir()
  })
  return { controller, store, pty, runtime }
}

/** Adds a repo and a worktree whose folder really exists (session start checks it). */
async function addWorktree(store: SessionStore, name: string): Promise<{ repoId: Id; worktreeId: Id; path: string }> {
  const repoPath = await tempDir()
  const repo = store.addRepo({ name: `repo-${name}`, path: repoPath })
  const path = await tempDir()
  const worktree = store.addWorktree({
    repoId: repo.id,
    branch: `sd/${name}`,
    name,
    path,
    baseBranch: 'main',
    baseCommit: SHA
  })
  return { repoId: repo.id, worktreeId: worktree.id, path: resolve(path) }
}

describe('createSession in a worktree', () => {
  it('runs in the worktree path even when input.cwd points elsewhere', async () => {
    const h = harness()
    const wt = await addWorktree(h.store, 'feature')
    const session = h.controller.createSession({ cwd: resolve('/somewhere/else'), worktreeId: wt.worktreeId, agent: 'shell' })
    expect(session.cwd).toBe(wt.path)
    expect(h.pty.starts[0].cwd).toBe(wt.path)
  })

  it('an unknown worktreeId throws and stores and starts nothing', async () => {
    const h = harness()
    const folder = await tempDir()
    expect(() => h.controller.createSession({ cwd: folder, worktreeId: 'missing' })).toThrow('Worktree not found')
    expect(h.store.get().sessions).toEqual([])
    expect(h.pty.starts).toEqual([])
  })
})

describe('shell sessions', () => {
  it('start powershell with -NoLogo, no hook env and no Claude session id', async () => {
    const h = harness()
    const wt = await addWorktree(h.store, 'shell')
    const session = h.controller.createSession({ cwd: wt.path, worktreeId: wt.worktreeId, agent: 'shell' })
    expect(session.claudeSessionId).toBeUndefined()
    expect(h.store.get().sessions[0].claudeSessionId).toBeUndefined()
    const opts = h.pty.starts[0]
    expect(opts.command).toBe('powershell')
    expect(opts.internalArgs).toEqual(['-NoLogo'])
    expect(opts.env).not.toHaveProperty('SESSIONDECK_SESSION_ID')
  })

  it('uses the shell chosen in settings (cmd)', async () => {
    const h = harness()
    h.store.updateSettings({ code: { shell: 'cmd' } })
    const wt = await addWorktree(h.store, 'cmd')
    h.controller.createSession({ cwd: wt.path, worktreeId: wt.worktreeId, agent: 'shell' })
    expect(h.pty.starts[0]).toMatchObject({ command: 'cmd', internalArgs: [] })
  })

  it('restart after the shell exited starts a fresh shell and never resumes', async () => {
    const h = harness()
    const wt = await addWorktree(h.store, 'restart')
    const session = h.controller.createSession({ cwd: wt.path, worktreeId: wt.worktreeId, agent: 'shell' })
    h.pty.fireExit(session.id, 0)
    expect(h.pty.starts).toHaveLength(1)
    await h.controller.restartSession(session.id)
    expect(h.pty.starts).toHaveLength(2)
    const restarted = h.pty.starts[1]
    expect(restarted.command).toBe('powershell')
    expect(restarted.internalArgs).toEqual(['-NoLogo'])
    expect(JSON.stringify(restarted.internalArgs)).not.toContain('--resume')
  })

  it('an exit does not trigger a Claude-style resume fallback', async () => {
    const h = harness()
    const wt = await addWorktree(h.store, 'exit')
    const session = h.controller.createSession({ cwd: wt.path, worktreeId: wt.worktreeId, agent: 'shell' })
    h.pty.fireExit(session.id, 1)
    expect(h.pty.starts).toHaveLength(1)
    expect(h.runtime.get(session.id)?.run).toBe('exited')
  })

  it('waking a sleeping shell starts a fresh shell', async () => {
    const h = harness()
    const wt = await addWorktree(h.store, 'sleep')
    const session = h.controller.createSession({ cwd: wt.path, worktreeId: wt.worktreeId, agent: 'shell' })
    h.controller.sleepSession(session.id)
    expect(h.runtime.get(session.id)?.sleeping).toBe(true)
    expect(h.controller.wakeSession(session.id)).toBe(true)
    expect(h.pty.starts.at(-1)).toMatchObject({ command: 'powershell', internalArgs: ['-NoLogo'] })
  })

  it('restored shell sessions are left without a Claude session id', async () => {
    const h = harness()
    const wt = await addWorktree(h.store, 'restored')
    const session = h.controller.createSession({ cwd: wt.path, worktreeId: wt.worktreeId, agent: 'shell' })
    h.controller.initializeRestoredSessions()
    expect(h.store.get().sessions.find((s) => s.id === session.id)?.claudeSessionId).toBeUndefined()
  })
})

describe('removeWorktree and removeRepo', () => {
  async function twoWorktreesWithOps() {
    const h = harness()
    const first = await addWorktree(h.store, 'first')
    const second = await addWorktree(h.store, 'second')
    const inFirst = h.controller.createSession({ cwd: first.path, worktreeId: first.worktreeId, agent: 'shell' })
    const inSecond = h.controller.createSession({ cwd: second.path, worktreeId: second.worktreeId, agent: 'shell' })
    const ops = h.controller.createSession({ cwd: await tempDir() })
    return { h, first, second, inFirst, inSecond, ops }
  }

  it('removeWorktree stops and removes that worktree\'s sessions only', async () => {
    const { h, first, second, inFirst, inSecond, ops } = await twoWorktreesWithOps()
    h.controller.removeWorktree(first.worktreeId)
    expect(h.pty.killed).toContain(inFirst.id)
    expect(h.store.getWorktree(first.worktreeId)).toBeUndefined()
    const ids = h.store.get().sessions.map((s: Session) => s.id)
    expect(ids).toEqual([inSecond.id, ops.id])
    expect(h.store.getWorktree(second.worktreeId)).toBeDefined()
  })

  it('removeRepo removes each of its worktrees with their sessions, and the repo', async () => {
    const { h, first, inFirst, inSecond, ops } = await twoWorktreesWithOps()
    h.controller.removeRepo(first.repoId)
    expect(h.store.getRepo(first.repoId)).toBeUndefined()
    expect(h.store.get().worktrees?.map((w) => w.repoId)).not.toContain(first.repoId)
    expect(h.pty.killed).toContain(inFirst.id)
    expect(h.store.get().sessions.map((s: Session) => s.id)).not.toContain(inFirst.id)
    expect(h.store.get().sessions.map((s: Session) => s.id)).toEqual(expect.arrayContaining([inSecond.id, ops.id]))
  })

  it('an unknown worktree or repo id changes nothing', async () => {
    const { h, ops } = await twoWorktreesWithOps()
    const before = h.store.get()
    h.controller.removeWorktree('missing')
    h.controller.removeRepo('missing')
    expect(h.store.get()).toEqual(before)
    expect(h.store.get().sessions.map((s: Session) => s.id)).toContain(ops.id)
  })
})

describe('moveToWorktree (D88)', () => {
  it('restarts a running shell session in the worktree, keeps its card, and leaves its Ops group', async () => {
    const h = harness()
    const wt = await addWorktree(h.store, 'target')
    const group = h.store.createGroup('Work')
    const session = h.controller.createSession({ cwd: await tempDir(), agent: 'shell', name: 'Keep me', groupId: group.id })
    const moved = h.controller.moveToWorktree(session.id, wt.worktreeId)
    expect(moved).toMatchObject({ id: session.id, name: 'Keep me', cwd: wt.path, worktreeId: wt.worktreeId, groupId: null })
    expect(h.pty.killed).toContain(session.id)
    expect(h.pty.starts.at(-1)?.cwd).toBe(wt.path)
    expect(h.runtime.get(session.id)?.run).toBe('running')
  })

  it('a Claude session starts a NEW conversation in the worktree (new --session-id, never --resume of the old one)', async () => {
    const h = harness()
    const wt = await addWorktree(h.store, 'target')
    const session = h.controller.createSession({ cwd: await tempDir(), agent: 'claude' })
    const oldConversation = session.claudeSessionId
    expect(oldConversation).toBeDefined()
    h.controller.moveToWorktree(session.id, wt.worktreeId)
    const started = h.pty.starts.at(-1)
    expect(started?.cwd).toBe(wt.path)
    expect(started?.internalArgs).not.toContain('--resume')
    expect(started?.internalArgs).toContain('--session-id')
    const after = h.store.get().sessions.find((s: Session) => s.id === session.id)
    expect(after?.claudeSessionId).toBeDefined()
    expect(after?.claudeSessionId).not.toBe(oldConversation)
  })

  it('a closed session only changes folder: nothing starts', async () => {
    const h = harness()
    const wt = await addWorktree(h.store, 'target')
    const session = h.controller.createSession({ cwd: await tempDir(), agent: 'shell' })
    h.controller.closeSession(session.id)
    const startsBefore = h.pty.starts.length
    h.controller.moveToWorktree(session.id, wt.worktreeId)
    expect(h.pty.starts.length).toBe(startsBefore)
    expect(h.store.get().sessions.find((s: Session) => s.id === session.id)?.worktreeId).toBe(wt.worktreeId)
  })

  it('moveToOps sends a Code session back to a folder and restarts it there', async () => {
    const h = harness()
    const wt = await addWorktree(h.store, 'target')
    const folder = await tempDir()
    const session = h.controller.createSession({ cwd: wt.path, worktreeId: wt.worktreeId, agent: 'shell' })
    const back = h.controller.moveToOps(session.id, folder, null)
    expect(back.worktreeId).toBeUndefined()
    expect(resolve(back.cwd)).toBe(resolve(folder))
    expect(h.pty.starts.at(-1)?.cwd).toBe(resolve(folder))
    expect(() => h.controller.moveToOps(session.id, folder, null)).toThrow('not a Code session')
  })

  it('refuses an unknown session or worktree, a session already there, and changes nothing', async () => {
    const h = harness()
    const wt = await addWorktree(h.store, 'target')
    const session = h.controller.createSession({ cwd: await tempDir(), agent: 'shell' })
    expect(() => h.controller.moveToWorktree('missing', wt.worktreeId)).toThrow('Unknown session')
    expect(() => h.controller.moveToWorktree(session.id, 'missing')).toThrow('Worktree not found')
    h.controller.moveToWorktree(session.id, wt.worktreeId)
    const before = h.store.get()
    expect(() => h.controller.moveToWorktree(session.id, wt.worktreeId)).toThrow('already in this worktree')
    expect(h.store.get()).toEqual(before)
  })
})
