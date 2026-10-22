// CONTRACT STUB (orchestrator): the props are frozen; the implementation is filled in by the code-sidebar worker.
import type { ReactElement } from 'react'
import type { AppSettings, Id, Worktree } from '../../../shared/types'
import type { SessionActions } from '../../state/useSessionStore'

export interface NewWorktreeSessionDialogProps {
  readonly worktree: Worktree
  readonly settings: AppSettings
  readonly actions: SessionActions
  readonly onClose: () => void
  /** The session was created: open its tab. */
  readonly onCreated: (sessionId: Id) => void
}

export function NewWorktreeSessionDialog(_props: NewWorktreeSessionDialogProps): ReactElement | null {
  return null
}
