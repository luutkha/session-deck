import { ipcMain } from 'electron'
import path from 'node:path'
import type { CreateWorktreeResult, FileDiff, FilePreview, HookEvent, Id, Repo, RepoBranches, Worktree, WorktreeChanges } from '../../shared/types'
import { IPC } from '../../shared/ipc'
import type { SessionStore } from '../store'
import { createGitWorktree, defaultWorktreesRoot, listBranches, readFileDiff, resolveCommit, readWorktreeChanges, readWorktreePreview, repoFolderName, resolveRepoRoot, validateWorktreeName } from '../git'
import { asCreateWorktreeInput, assertBoolean, assertId, assertNonEmptyString } from './ipcValidation'
import type { SessionController } from './sessionController'
import { createCodeGitOps, type CodeGitOps } from './codeGitOps'
import { asCommitInput, asPullRequestInput, asWorktreeRemoveOptions } from './codeGitValidation'
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
  /** D60: opens a web page in the user's browser (the PR page when the GitHub CLI is not set up). */
  readonly openExternal: (url: string) => Promise<void>
  /** D60: GitHub CLI installed and signed in (cached). */
  readonly ghReady: () => Promise<boolean>
}

/** Code mode (D31): repos, worktrees and their changes, wired to the store, the controller and IPC. */
export interface CodeWiring {
  registerIpc(): void
  /** Adds a repo (also reachable from the createWorktree/addRepo tests). */
  addRepo(rawFolder: unknown): Promise<Repo>
  /** Creates a branch + worktree and starts the first session in it (also reachable from createWorktree tests). */
  createWorktree(raw: unknown): Promise<CreateWorktreeResult>
  /** D54 (Jarvis): local branches of a repo, a worktree's changes, and worktree removal (same paths as the IPC). */
  branches(repoId: Id): Promise<RepoBranches>
  changes(worktreeId: Id): Promise<WorktreeChanges>
  removeWorktree(worktreeId: Id): void
  /** D55 (Jarvis): removes a repo with its worktrees and sessions; one file's diff (same paths as the IPC). */
  removeRepo(repoId: Id): void
  fileDiff(rawWorktreeId: unknown, rawPath: unknown): Promise<FileDiff>
  /** D60: commit, push, pull request, merge, delete from disk (the Changes panel and Jarvis). */
  readonly git: CodeGitOps
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

  /** The run that starts after the one in flight, shared by every `fresh` caller that arrived meanwhile. */
  const trailing = new Map<Id, Promise<WorktreeChanges>>()

  /**
   * One git run per worktree at a time. A background caller arriving meanwhile shares the running one. A `fresh` caller
   * (it just changed files, or must see them: Jarvis commit, the refresh after a commit/push, an explicit read) never gets
   * a result older than its request: it gets the next run, which starts after the running one ends. Git slots are limited
   * (gitRunner), so a run can stay in flight for a while; without this, such a caller read a snapshot from before its write.
   */
  function computeChanges(worktree: Worktree, fresh = false): Promise<WorktreeChanges> {
    const running = inFlight.get(worktree.id)
    if (running !== undefined) {
      if (!fresh) return running
      const queued = trailing.get(worktree.id)
      if (queued !== undefined) return queued
      const after = running.then(() => undefined, () => undefined).then(() => {
        trailing.delete(worktree.id)
        return computeChanges(worktree, true)
      })
      trailing.set(worktree.id, after)
      return after
    }
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
    let worktree: Worktree
    if (input.source === 'main') {
      // D57: the repo's own folder as a workspace. No branch is created; nothing on disk changes.
      const open = (store.get().worktrees ?? []).find((w) => w.repoId === repo.id && w.main === true)
      if (open !== undefined) throw new Error(`The repository folder is already open in SessionDeck as "${open.name}".`)
      const head = await listBranches(repo.path)
      const branch = head.current ?? 'HEAD'
      const baseCommit = await resolveCommit(repo.path, 'HEAD')
      worktree = store.addWorktree({ repoId: repo.id, name, branch, path: repo.path, baseBranch: branch, baseCommit, main: true })
    } else {
      const configured = store.getSettings().code.worktreesRoot
      const root = configured.length > 0 ? configured : defaultWorktreesRoot(deps.homedir)
      const created = await createGitWorktree({
        repoPath: repo.path, repoName: repo.name, root, name, baseBranch: input.baseBranch,
        ...(input.source === 'existing' && input.branch !== undefined ? { existingBranch: input.branch } : {})
      })
      worktree = store.addWorktree({
        repoId: repo.id, name: created.name, branch: created.branch, path: created.path, baseBranch: input.baseBranch, baseCommit: created.baseCommit
      })
    }
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

  function branches(repoId: Id): Promise<RepoBranches> {
    return listBranches(repoOrThrow(repoId).path)
  }

  function changes(worktreeId: Id): Promise<WorktreeChanges> {
    return computeChanges(worktreeOrThrow(worktreeId), true)
  }

  function removeWorktree(worktreeId: Id): void {
    forget(worktreeId)
    controller.removeWorktree(worktreeId)
  }

  function removeRepo(id: Id): void {
    for (const worktree of store.get().worktrees ?? []) {
      if (worktree.repoId === id) forget(worktree.id)
    }
    controller.removeRepo(id)
  }

  const git = createCodeGitOps({
    store,
    removeFromSessionDeck: removeWorktree,
    refreshChanges: (worktree) => computeChanges(worktree, true),
    latestChanges: (id) => latest.get(id),
    openExternal: deps.openExternal,
    ghReady: deps.ghReady
  })

  function registerIpc(): void {
    ipcMain.handle(IPC.repoAdd, (_event, raw: unknown) => addRepo(raw))
    ipcMain.handle(IPC.repoRemove, (_event, rawId: unknown): void => removeRepo(assertId(rawId, 'repo id')))
    ipcMain.handle(IPC.repoSetCollapsed, (_event, rawId: unknown, rawCollapsed: unknown): void => {
      store.setRepoCollapsed(assertId(rawId, 'repo id'), assertBoolean(rawCollapsed, 'collapsed'))
    })
    ipcMain.handle(IPC.repoBranches, (_event, rawId: unknown): Promise<RepoBranches> => branches(assertId(rawId, 'repo id')))
    ipcMain.handle(IPC.worktreeCreate, (_event, raw: unknown) => createWorktree(raw))
    ipcMain.handle(IPC.worktreeRemove, (_event, rawId: unknown, rawOptions: unknown) =>
      git.remove(assertId(rawId, 'worktree id'), asWorktreeRemoveOptions(rawOptions)))
    ipcMain.handle(IPC.worktreeRemovalInfo, (_event, rawId: unknown) => git.removalInfo(assertId(rawId, 'worktree id')))
    ipcMain.handle(IPC.worktreeBranchStatus, (_event, rawId: unknown) => git.branchStatus(assertId(rawId, 'worktree id')))
    ipcMain.handle(IPC.worktreeCommit, (_event, raw: unknown) => git.commit(asCommitInput(raw)))
    ipcMain.handle(IPC.worktreePush, (_event, rawId: unknown) => git.push(assertId(rawId, 'worktree id')))
    ipcMain.handle(IPC.worktreeCreatePr, (_event, rawId: unknown, raw: unknown) => git.createPr(assertId(rawId, 'worktree id'), asPullRequestInput(raw)))
    ipcMain.handle(IPC.worktreeMerge, (_event, rawId: unknown) => git.merge(assertId(rawId, 'worktree id')))
    ipcMain.handle(IPC.worktreeSetCollapsed, (_event, rawId: unknown, rawCollapsed: unknown): void => {
      store.setWorktreeCollapsed(assertId(rawId, 'worktree id'), assertBoolean(rawCollapsed, 'collapsed'))
    })
    ipcMain.handle(IPC.worktreeChanges, (_event, rawId: unknown): Promise<WorktreeChanges> => changes(assertId(rawId, 'worktree id')))
    ipcMain.handle(IPC.worktreeFileDiff, (_event, rawId: unknown, rawPath: unknown) => fileDiff(rawId, rawPath))
    ipcMain.handle(IPC.filePreviewRead, (_event, rawId: unknown, rawPath: unknown) => filePreview(rawId, rawPath))
  }

  return {
    registerIpc,
    addRepo,
    createWorktree,
    branches,
    changes,
    removeWorktree,
    removeRepo,
    fileDiff,
    git,
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
