// The dialogs one mode's workspace can open: New session (Ops), New worktree / New session in a worktree (Code),
// and Settings. Kept apart from ModeWorkspace so the layout file stays small.
import type { ReactElement } from 'react'
import { resolveSettings, type Id, type StoreData } from '../../shared/types'
import { NewSessionDialog } from '../Sidebar/NewSessionDialog'
import { NewWorktreeDialog } from '../code/dialogs/NewWorktreeDialog'
import { NewWorktreeSessionDialog } from '../code/dialogs/NewWorktreeSessionDialog'
import { SettingsDialog, type SettingsSection } from '../settings/SettingsDialog'
import type { SessionActions } from '../state/useSessionStore'
import type { NewDialog } from './newSessionTarget'

export interface WorkspaceDialogsProps {
  readonly data: StoreData | null
  readonly actions: SessionActions
  readonly newDialog: NewDialog | null
  readonly onCloseNew: () => void
  /** A session was created from one of the dialogs: open its tab (and apply the wanted status, Ops only).
   * D89: a new worktree also passes its id so the caller can move the other selected sessions in. */
  readonly onCreated: (sessionId: Id, worktreeId?: Id) => void
  readonly settingsSection: SettingsSection | null
  readonly onSettingsSectionChange: (section: SettingsSection) => void
  readonly onCloseSettings: () => void
}

function NewDialogView(props: WorkspaceDialogsProps & { readonly data: StoreData; readonly newDialog: NewDialog }): ReactElement {
  const { data, newDialog, actions, onCloseNew, onCreated } = props
  const settings = resolveSettings(data.settings)
  switch (newDialog.kind) {
    case 'ops':
      return (
        <NewSessionDialog
          data={data}
          defaultGroupId={newDialog.groupId}
          defaultFolder={newDialog.folder}
          actions={actions}
          onClose={onCloseNew}
          onCreated={onCreated}
        />
      )
    case 'worktree':
      return (
        <NewWorktreeDialog
          moveSession={newDialog.moveSessionId === undefined ? undefined : data.sessions.find((x) => x.id === newDialog.moveSessionId)}
          moveSessionIds={newDialog.moveSessionIds}
          repos={data.repos ?? []}
          worktrees={data.worktrees ?? []}
          defaultRepoId={newDialog.repoId}
          settings={settings}
          onClose={onCloseNew}
          onCreated={onCreated}
        />
      )
    case 'worktree-session':
      return (
        <NewWorktreeSessionDialog
          worktree={newDialog.worktree}
          settings={settings}
          actions={actions}
          onClose={onCloseNew}
          onCreated={onCreated}
        />
      )
  }
}

export function WorkspaceDialogs(props: WorkspaceDialogsProps): ReactElement | null {
  const { data, newDialog, settingsSection } = props
  if (data === null) return null
  return (
    <>
      {newDialog !== null ? <NewDialogView {...props} data={data} newDialog={newDialog} /> : null}
      {settingsSection !== null ? (
        <SettingsDialog
          section={settingsSection}
          onSectionChange={props.onSettingsSectionChange}
          settings={resolveSettings(data.settings)}
          statuses={data.statuses}
          actions={props.actions}
          onClose={props.onCloseSettings}
        />
      ) : null}
    </>
  )
}
