import { ipcMain } from 'electron'
import path from 'node:path'
import type { CreateWorktreeResult, FileDiff, FilePreview, HookEvent, Id, Repo, RepoBranches, Worktree, WorktreeChanges } from '../../shared/types'
import { IPC } from '../../shared/ipc'
import type { SessionStore } from '../store'
import { createGitWorktree, defaultWorktreesRoot, listBranches, readFileDiff, readWorktreeChanges, readWorktreePreview, repoFolderName, resolveRepoRoot, validateWorktreeName } from '../git'
import { asCreateWorktreeInput, assertBoolean, assertId, assertNonEmptyString } from './ipcValidation'
import type { SessionController } from './sessionController'
import { errorMessage } from '../../shared/guards'

/** A turn that just ended has usually written its files; give the file system a moment before diffing. */
const CHANGES_AFTER_TURN_MS = 1500
const MAX_PATH_LENGTH = 4096

/** What makes two results different for the windows (the time they were computed does not). */
function changesKey(changes: WorktreeChanges): string {
  return JSON.stringify([changes.files, changes.truncated, changes.error ?? null])
}

export interface CodeWiringDeps {
  readonly store: SessionStore
  readonly controller: SessionController
  /** Sends an event to every open window. */
  readonly broadcast: (channel: string, ...args: unknown[]) => void
  readonly homedir: string
  readonly now: () => number
  readonly onError: (where: string, error: unknown) => void
}

/** Code mode (D31): repos, worktrees and their changes, wired to the store, the controller and IPC. */
export interface CodeWiring {
  registerIpc(): void
  /** Adds a repo (also reachable from the createWorktree/addRepo tests). */
  addRepo(rawFolder: unknown): Promise<Repo>
  /** Creates a branch + worktree and starts the first session in it (also reachable from createWorktree tests). */
  createWorktree(raw: unknown): Promise<CreateWorktreeResult>
  /** A turn ended in some session: refresh the changes of its worktree and push them to the windows. */
  onHookEvent(event: HookEvent): void
  shutdown(): void
}

export function createCodeWiring(deps: CodeWiringDeps): CodeWiring {
  const { store, controller, broadcast, onError } = deps
  /** Last computed changes per worktree: a diff request is only answered for a path in this list. */
  const latest = new Map<Id, WorktreeChanges>()
  const inFlight = new Map<Id, Promise<WorktreeChanges>>()
  const timers = new Map<Id, ReturnType<typeof setTimeout>>()

  function worktreeOrThrow(id: Id): Worktree {
    const worktree = store.getWorktree(id)
    if (worktree === undefined) throw new Error('Worktree not found')
    return worktree
  }

  function repoOrThrow(id: Id): Repo {
    const repo = store.getRepo(id)
    if (repo === undefined) throw new Error('Repository not found')
    return repo
  }

  /** One git run per worktree at a time; callers arriving meanwhile share its result. */
  function computeChanges(worktree: Worktree): Promise<WorktreeChanges> {
    const running = inFlight.get(worktree.id)
    if (running !== undefined) return running
    const next = readWorktreeChanges(worktree, deps.now).then((changes) => {
      const previous = latest.get(worktree.id)
      latest.set(worktree.id, changes)
      // Every window (sidebar counts, an open Changes tab) learns about a different result, whoever asked for it.
      if (previous === undefined || changesKey(previous) !== changesKey(changes)) broadcast(IPC.evWorktreeChanges, changes)
      return changes
    }).finally(() => inFlight.delete(worktree.id))
    inFlight.set(worktree.id, next)
    return next
  }

  function scheduleRefresh(worktreeId: Id): void {
    const pending = timers.get(worktreeId)
    if (pending !== undefined) clearTimeout(pending)
    timers.set(worktreeId, setTimeout(() => {
      timers.delete(worktreeId)
      const worktree = store.getWorktree(worktreeId)
      if (worktree === undefined) return
      computeChanges(worktree)
        .catch((error: unknown) => onError('worktree changes refresh', error))
    }, CHANGES_AFTER_TURN_MS))
  }

  function forget(worktreeId: Id): void {
    latest.delete(worktreeId)
    const pending = timers.get(worktreeId)
    if (pending !== undefined) clearTimeout(pending)
    timers.delete(worktreeId)
  }

  async function addRepo(rawFolder: unknown): Promise<Repo> {
    const folder = assertNonEmptyString(rawFolder, 'folder', MAX_PATH_LENGTH)
    const root = await resolveRepoRoot(folder)
    // A drive root (D:\) has no basename; the worktrees folder still needs a usable name.
    return store.addRepo({ name: path.basename(root) || repoFolderName(root), path: root })
  }

  async function createWorktree(raw: unknown): Promise<CreateWorktreeResult> {
    const input = asCreateWorktreeInput(raw)
    const repo = repoOrThrow(input.repoId)
    const name = validateWorktreeName(input.name)
    const configured = store.getSettings().code.worktreesRoot
    const root = configured.length > 0 ? configured : defaultWorktreesRoot(deps.homedir)
    const created = await createGitWorktree({ repoPath: repo.path, repoName: repo.name, root, name, baseBranch: input.baseBranch })
    const worktree = store.addWorktree({
      repoId: repo.id, name, branch: created.branch, path: created.path, baseBranch: input.baseBranch, baseCommit: created.baseCommit
    })
    try {
      const session = controller.createSession({
        cwd: worktree.path, agent: input.agent, worktreeId: worktree.id, ...(input.model !== undefined ? { model: input.model } : {})
      })
      return { worktree, session }
    } catch (error) {
      // Its session never started, so the worktree has no sessions: remove it again instead of leaving a
      // sessionless one (before Fix B there was no way back once the row button had no open session).
      store.removeWorktree(worktree.id)
      forget(worktree.id)
      const reason = errorMessage(error)
      throw new Error(
        `The worktree could not be created: its session did not start (${reason}). Nothing was kept — files stay on disk.`
      )
    }
  }

  async function fileDiff(rawId: unknown, rawPath: unknown): Promise<FileDiff> {
    const worktree = worktreeOrThrow(assertId(rawId, 'worktree id'))
    const filePath = assertNonEmptyString(rawPath, 'file path', MAX_PATH_LENGTH)
    const current = latest.get(worktree.id) ?? await computeChanges(worktree)
    return readFileDiff(worktree, filePath, current)
  }

  async function filePreview(rawId: unknown, rawPath: unknown): Promise<FilePreview> {
    const worktree = worktreeOrThrow(assertId(rawId, 'worktree id'))
    const filePath = assertNonEmptyString(rawPath, 'file path', MAX_PATH_LENGTH)
    return readWorktreePreview(worktree, filePath)
  }

  function registerIpc(): void {
    ipcMain.handle(IPC.repoAdd, (_event, raw: unknown) => addRepo(raw))
    ipcMain.handle(IPC.repoRemove, (_event, rawId: unknown): void => {
      const id = assertId(rawId, 'repo id')
      for (const worktree of store.get().worktrees ?? []) {
        if (worktree.repoId === id) forget(worktree.id)
      }
      controller.removeRepo(id)
    })
    ipcMain.handle(IPC.repoSetCollapsed, (_event, rawId: unknown, rawCollapsed: unknown): void => {
      store.setRepoCollapsed(assertId(rawId, 'repo id'), assertBoolean(rawCollapsed, 'collapsed'))
    })
    ipcMain.handle(IPC.repoBranches, (_event, rawId: unknown): Promise<RepoBranches> => {
      return listBranches(repoOrThrow(assertId(rawId, 'repo id')).path)
    })
    ipcMain.handle(IPC.worktreeCreate, (_event, raw: unknown) => createWorktree(raw))
    ipcMain.handle(IPC.worktreeRemove, (_event, rawId: unknown): void => {
      const id = assertId(rawId, 'worktree id')
      forget(id)
      controller.removeWorktree(id)
    })
    ipcMain.handle(IPC.worktreeSetCollapsed, (_event, rawId: unknown, rawCollapsed: unknown): void => {
      store.setWorktreeCollapsed(assertId(rawId, 'worktree id'), assertBoolean(rawCollapsed, 'collapsed'))
    })
    ipcMain.handle(IPC.worktreeChanges, (_event, rawId: unknown): Promise<WorktreeChanges> => {
      return computeChanges(worktreeOrThrow(assertId(rawId, 'worktree id')))
    })
    ipcMain.handle(IPC.worktreeFileDiff, (_event, rawId: unknown, rawPath: unknown) => fileDiff(rawId, rawPath))
    ipcMain.handle(IPC.filePreviewRead, (_event, rawId: unknown, rawPath: unknown) => filePreview(rawId, rawPath))
  }

  return {
    registerIpc,
    addRepo,
    createWorktree,
    onHookEvent: (event) => {
      if (event.event !== 'Stop') return
      const worktreeId = store.get().sessions.find((s) => s.id === event.sessionId)?.worktreeId
      if (worktreeId !== undefined) scheduleRefresh(worktreeId)
    },
    shutdown: () => {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }
}
