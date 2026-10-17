import {
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement
} from 'react'
import type { AgentKind, Group, Id, StoreData } from '../../shared/types'
import type { SessionActions } from '../state/useSessionStore'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { buildCreateInput, validateOpenCodeModel } from './dialogLogic'
import { NEW_GROUP_CHOICE, NO_VALUE_CHOICE, NewSessionFields } from './NewSessionFields'

export interface NewSessionDialogProps {
  readonly data: StoreData
  readonly defaultGroupId?: Id | null
  /** Preselected agent; the caller should pass AppSettings.agents.defaultAgent. Falls back to 'claude'. */
  readonly defaultAgent?: AgentKind
  /** Prefilled OpenCode model; the caller should pass AppSettings.agents.opencodeModel. */
  readonly defaultOpenCodeModel?: string
  readonly actions: Pick<SessionActions, 'createSession' | 'createGroup' | 'pickFolder'>
  readonly onClose: () => void
  readonly onCreated: (sessionId: Id) => void
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function orderedGroups(data: StoreData): readonly Group[] {
  const position = new Map(data.groupOrder.map((id, index) => [id, index]))
  return [...data.groups].sort(
    (a, b) =>
      (position.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (position.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  )
}

/**
 * "New session" form in Orca's dialog layout. Validation, the create/group
 * flow and error handling live here; markup lives in NewSessionFields.
 */
export function NewSessionDialog({
  data,
  defaultGroupId,
  defaultAgent,
  defaultOpenCodeModel,
  actions,
  onClose,
  onCreated
}: NewSessionDialogProps): ReactElement {
  const [agent, setAgent] = useState<AgentKind>(defaultAgent ?? 'claude')
  const [folder, setFolder] = useState('')
  const [name, setName] = useState('')
  const [groupChoice, setGroupChoice] = useState<string>(defaultGroupId ?? NO_VALUE_CHOICE)
  const [statusChoice, setStatusChoice] = useState<string>(NO_VALUE_CHOICE)
  const [argsRaw, setArgsRaw] = useState('')
  const [modelRaw, setModelRaw] = useState(defaultOpenCodeModel ?? '')
  const [remoteControl, setRemoteControl] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const folderInputRef = useRef<HTMLInputElement | null>(null)

  const creatingGroup = groupChoice === NEW_GROUP_CHOICE
  const modelResult = validateOpenCodeModel(modelRaw)
  const modelError = agent === 'opencode' && !modelResult.ok ? modelResult.error : null

  async function handleBrowse(): Promise<void> {
    setError(null)
    try {
      const picked = await actions.pickFolder()
      if (picked !== null) {
        setFolder(picked)
      }
    } catch (err) {
      setError(toMessage(err))
    }
  }

  async function submit(): Promise<void> {
    if (busy) return
    setError(null)

    const groupId = creatingGroup || groupChoice === NO_VALUE_CHOICE ? null : groupChoice
    const statusId = statusChoice === NO_VALUE_CHOICE ? null : statusChoice
    const built = buildCreateInput({ folder, name, groupId, statusId, argsRaw, agent, modelRaw, remoteControl })
    if (!built.ok) {
      setError(built.error)
      return
    }

    setBusy(true)
    try {
      let effectiveGroupId = built.input.groupId ?? null
      if (creatingGroup) {
        const groupName = newGroupName.trim()
        if (groupName.length === 0) {
          setError('Group name required')
          return
        }
        const group = await actions.createGroup(groupName)
        effectiveGroupId = group.id
      }
      const session = await actions.createSession({
        ...built.input,
        groupId: effectiveGroupId
      })
      onCreated(session.id)
      onClose()
    } catch (err) {
      setError(toMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    void submit()
  }

  function handleFormKeyDown(event: KeyboardEvent<HTMLFormElement>): void {
    const target = event.target
    if (event.key !== 'Enter' || !(target instanceof HTMLInputElement)) {
      return
    }
    // Enter submits from any text field. Intercepted explicitly so a single
    // Enter never submits twice.
    event.preventDefault()
    void submit()
  }

  return (
    <Dialog
      open
      onOpenChange={(open: boolean): void => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="max-w-md sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          folderInputRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-sm">New session</DialogTitle>
          <DialogDescription className="text-xs">
            Start a Claude Code or OpenCode session in a folder.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit} onKeyDown={handleFormKeyDown}>
          <NewSessionFields
            agent={agent}
            folder={folder}
            name={name}
            groupChoice={groupChoice}
            statusChoice={statusChoice}
            argsRaw={argsRaw}
            modelRaw={modelRaw}
            remoteControl={remoteControl}
            modelError={modelError}
            newGroupName={newGroupName}
            groups={orderedGroups(data)}
            statuses={data.statuses}
            busy={busy}
            folderInputRef={folderInputRef}
            onAgentChange={setAgent}
            onFolderChange={setFolder}
            onBrowse={() => void handleBrowse()}
            onNameChange={setName}
            onGroupChange={setGroupChoice}
            onNewGroupNameChange={setNewGroupName}
            onStatusChange={setStatusChoice}
            onArgsChange={setArgsRaw}
            onModelChange={setModelRaw}
            onRemoteControlChange={setRemoteControl}
          />

          {error !== null ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="text-xs"
              disabled={folder.trim().length === 0 || busy || modelError !== null}
            >
              Create session
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
