// Types shared by the Code sidebar components (what a row needs from CodeSidebar). Type-only file.
import type { Id, Repo, RuntimeState, StoreData, Worktree, WorktreeChanges, WorktreeRemoveOptions } from '../../../shared/types'
import type { SessionActions } from '../../state/useSessionStore'

/** Sidebar-level callbacks: selection, rename and the remove requests (the confirm dialog lives in CodeSidebar). */
export interface CodeTreeHandlers {
  readonly onSelect: (id: Id) => void
  readonly onStartRename: (id: Id) => void
  readonly onCommitRename: (id: Id, name: string) => void
  readonly onCancelRename: () => void
  readonly onCloseSession: (id: Id) => void
  readonly onRequestRemoveSession: (id: Id) => void
  readonly onRequestRemoveRepo: (repo: Repo) => void
  readonly onRequestRemoveWorktree: (worktree: Worktree) => void
  readonly onNewWorktree: (repoId: Id) => void
  readonly onNewSessionInWorktree: (worktreeId: Id) => void
}

/** IPC commands for repos, worktrees and session flags. Each one reports its own failure; none throws. */
export interface CodeCommands {
  readonly addRepository: () => Promise<void>
  readonly removeRepo: (repoId: Id) => Promise<void>
  /** D60: options.deleteFromDisk also deletes the folder and branch; a note about what stayed goes to the banner. */
  readonly removeWorktree: (worktreeId: Id, options?: WorktreeRemoveOptions) => Promise<void>
  readonly toggleRepo: (repo: Repo) => Promise<void>
  readonly toggleWorktree: (worktree: Worktree) => Promise<void>
  readonly copyPath: (path: string) => Promise<void>
  readonly openFolder: (sessionId: Id, path: string) => Promise<void>
  readonly sleepSession: (sessionId: Id) => Promise<void>
  readonly setKeepAwake: (sessionId: Id, keepAwake: boolean) => Promise<void>
}

/** Everything a row of the tree reads. */
export interface CodeTreeView {
  readonly data: StoreData
  readonly runtime: ReadonlyMap<Id, RuntimeState>
  readonly lastChange: ReadonlyMap<Id, number>
  readonly now: number
  readonly activeId: Id | null
  readonly renamingId: Id | null
  /** True while the search box has text: collapsed nodes show their matches. */
  readonly searching: boolean
  readonly changeCounts: ReadonlyMap<Id, WorktreeChanges>
  readonly actions: SessionActions
  readonly commands: CodeCommands
  readonly handlers: CodeTreeHandlers
  /** D52: forks a Claude session and opens the fork. Absent = no menu item. */
  readonly onForkSession?: (id: Id) => void
  /** D82: shows the session's Changes tab in the side panel. Absent = no menu item. */
  readonly onViewChanges?: (id: Id) => void
}
