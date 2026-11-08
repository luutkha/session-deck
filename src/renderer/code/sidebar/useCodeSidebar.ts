import { useCallback, useMemo, useState } from 'react'
import type { Id, Repo, StoreData, Worktree, WorktreeRemoveOptions } from '../../../shared/types'
import type { SessionActions } from '../../state/useSessionStore'
import { ignoreRejection } from '../../Sidebar/ignoreRejection'
import { repoRemoveMessage, sessionRemoveCopy } from './removeCopy'
import { repoSessionCount } from './codeTree'
import type { CodeCommands, CodeTreeHandlers } from './codeTreeView'
import { useCodeCommands } from './useCodeCommands'

/** The confirm dialog of a remove request. */
export interface PendingRemove {
  readonly title: string
  readonly message: string
  readonly confirmLabel: string
  readonly onConfirm: () => void
}

export interface CodeSidebarController {
  readonly commands: CodeCommands
  readonly handlers: CodeTreeHandlers
  readonly renamingId: Id | null
  readonly pending: PendingRemove | null
  /** D60: the worktree whose Remove dialog is open (with the delete-from-disk choice), or null. */
  readonly pendingWorktree: Worktree | null
  readonly confirmRemoveWorktree: (options: WorktreeRemoveOptions) => void
  readonly cancelPending: () => void
  /** Error from a command of this sidebar (shown in the banner), or null. */
  readonly localError: string | null
  readonly dismissLocalError: () => void
}

export interface CodeSidebarControllerInput {
  readonly data: StoreData
  readonly actions: SessionActions
  readonly onSelect: (id: Id) => void
  readonly onNewWorktree: (repoId?: Id) => void
  readonly onNewSessionInWorktree: (worktreeId: Id) => void
}

/** Sidebar state and commands: rename, the remove confirms, and the IPC commands with their error banner. */
export function useCodeSidebar(input: CodeSidebarControllerInput): CodeSidebarController {
  const { data, actions, onSelect, onNewWorktree, onNewSessionInWorktree } = input
  const [renamingId, setRenamingId] = useState<Id | null>(null)
  const [pending, setPending] = useState<PendingRemove | null>(null)
  const [pendingWorktree, setPendingWorktree] = useState<Worktree | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const commands = useCodeCommands(setLocalError)

  const cancelPending = useCallback((): void => {
    setPending(null)
    setPendingWorktree(null)
  }, [])
  const dismissLocalError = useCallback((): void => setLocalError(null), [])

  const requestRemoveSession = useCallback(
    (id: Id): void => {
      const session = data.sessions.find((candidate): boolean => candidate.id === id)
      if (session === undefined) return
      const copy = sessionRemoveCopy(session.name, session.closedAt !== undefined)
      setPending({
        ...copy,
        onConfirm: (): void => {
          setPending(null)
          ignoreRejection(actions.removeSession(id))
        }
      })
    },
    [data.sessions, actions]
  )

  const requestRemoveRepo = useCallback(
    (repo: Repo): void => {
      setPending({
        title: 'Remove repository',
        message: repoRemoveMessage(repo.name, repoSessionCount(data, repo.id)),
        confirmLabel: 'Remove',
        onConfirm: (): void => {
          setPending(null)
          void commands.removeRepo(repo.id)
        }
      })
    },
    [data, commands]
  )

  // D60: its own dialog (RemoveWorktreeDialog), for the delete-from-disk choice.
  const requestRemoveWorktree = useCallback((worktree: Worktree): void => setPendingWorktree(worktree), [])

  const handlers = useMemo(
    (): CodeTreeHandlers => ({
      onSelect,
      onStartRename: setRenamingId,
      onCommitRename: (id: Id, name: string): void => {
        setRenamingId(null)
        ignoreRejection(actions.renameSession(id, name))
      },
      onCancelRename: (): void => setRenamingId(null),
      onCloseSession: (id: Id): void => ignoreRejection(actions.closeSession(id)),
      onRequestRemoveSession: requestRemoveSession,
      onRequestRemoveRepo: requestRemoveRepo,
      onRequestRemoveWorktree: requestRemoveWorktree,
      onNewWorktree: (repoId: Id): void => onNewWorktree(repoId),
      onNewSessionInWorktree
    }),
    [onSelect, actions, requestRemoveSession, requestRemoveRepo, requestRemoveWorktree, onNewWorktree, onNewSessionInWorktree]
  )

  const confirmRemoveWorktree = useCallback((options: WorktreeRemoveOptions): void => {
    const worktree = pendingWorktree
    setPendingWorktree(null)
    if (worktree !== null) void commands.removeWorktree(worktree.id, options)
  }, [pendingWorktree, commands])

  return { commands, handlers, renamingId, pending, pendingWorktree, confirmRemoveWorktree, cancelPending, localError, dismissLocalError }
}
