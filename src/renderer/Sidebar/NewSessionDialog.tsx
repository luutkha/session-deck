import {
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement
} from 'react'
import type { AgentKind, Group, Id, SessionPreset, StoreData } from '../../shared/types'
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
import { buildCreateInput, initialFolder, validateOpenCodeModel } from './dialogLogic'
import { NEW_GROUP_CHOICE, NO_VALUE_CHOICE, NewSessionFields } from './NewSessionFields'
import { errorMessage } from '../../shared/guards'
import { Input } from '@/components/ui/input'
import { PresetMenu } from '../presets/PresetMenu'
import { formFromPreset, presetFromInput, presetIdForName, suggestedPresetName } from '../presets/presetLogic'

export interface NewSessionDialogProps {
  readonly data: StoreData
  readonly defaultGroupId?: Id | null
  /** Prefilled folder, e.g. when started from a workspace header. */
  readonly defaultFolder?: string
  /** Preselected agent; the caller should pass AppSettings.agents.defaultAgent. Falls back to 'claude'. */
  readonly defaultAgent?: AgentKind
  /** Prefilled OpenCode model; the caller should pass AppSettings.agents.opencodeModel. */
  readonly defaultOpenCodeModel?: string
  readonly actions: Pick<SessionActions, 'createSession' | 'createGroup' | 'pickFolder' | 'savePreset' | 'removePreset'>
  readonly onClose: () => void
  readonly onCreated: (sessionId: Id) => void
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
  defaultFolder,
  defaultAgent,
  defaultOpenCodeModel,
  actions,
  onClose,
  onCreated
}: NewSessionDialogProps): ReactElement {
  const [agent, setAgent] = useState<AgentKind>(defaultAgent ?? 'claude')
  const [folder, setFolder] = useState((): string => initialFolder(defaultFolder, data.sessions))
  const [name, setName] = useState('')
  const [groupChoice, setGroupChoice] = useState<string>(defaultGroupId ?? NO_VALUE_CHOICE)
  const [statusChoice, setStatusChoice] = useState<string>(NO_VALUE_CHOICE)
  const [argsRaw, setArgsRaw] = useState('')
  const [modelRaw, setModelRaw] = useState(defaultOpenCodeModel ?? '')
  // D79: OpenCode only, off by default (yolo, D10). Never sent for Claude/Shell.
  const [askPermissions, setAskPermissions] = useState(false)
  const [remoteControl, setRemoteControl] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // D49: null = the "Save as preset" row is closed; a string = its name field.
  const [presetName, setPresetName] = useState<string | null>(null)
  const [presetNotice, setPresetNotice] = useState<string | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const presets = data.presets ?? []

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
      setError(errorMessage(err))
    }
  }

  function applyPreset(preset: SessionPreset): void {
    const form = formFromPreset(preset)
    setAgent(form.agent)
    setFolder(form.folder)
    // A group or status deleted since the preset was saved is left empty.
    setGroupChoice(form.groupId !== null && data.groups.some((g) => g.id === form.groupId) ? form.groupId : NO_VALUE_CHOICE)
    setStatusChoice(form.statusId !== null && data.statuses.some((s) => s.id === form.statusId) ? form.statusId : NO_VALUE_CHOICE)
    setArgsRaw(form.argsRaw)
    setModelRaw(form.modelRaw)
    setRemoteControl(form.remoteControl)
    setError(null)
    setPresetNotice(`Filled from "${preset.name}"`)
  }

  async function removePreset(preset: SessionPreset): Promise<void> {
    try {
      await actions.removePreset(preset.id)
      setPresetNotice(`Deleted preset "${preset.name}"`)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function savePreset(): Promise<void> {
    if (presetName === null) return
    const trimmedName = presetName.trim()
    if (trimmedName.length === 0) {
      setError('Preset name required')
      return
    }
    const groupId = creatingGroup || groupChoice === NO_VALUE_CHOICE ? null : groupChoice
    const statusId = statusChoice === NO_VALUE_CHOICE ? null : statusChoice
    const built = buildCreateInput({ folder, name, groupId, statusId, argsRaw, agent, modelRaw, remoteControl, openCodeAskPermissions: askPermissions })
    if (!built.ok) {
      setError(built.error)
      return
    }
    try {
      await actions.savePreset(presetFromInput(built.input, trimmedName, presetIdForName(presets, trimmedName, crypto.randomUUID())))
      setPresetName(null)
      setError(null)
      setPresetNotice(`Saved preset "${trimmedName}"`)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function submit(): Promise<void> {
    if (busy) return
    setError(null)

    const groupId = creatingGroup || groupChoice === NO_VALUE_CHOICE ? null : groupChoice
    const statusId = statusChoice === NO_VALUE_CHOICE ? null : statusChoice
    const built = buildCreateInput({ folder, name, groupId, statusId, argsRaw, agent, modelRaw, remoteControl, openCodeAskPermissions: askPermissions })
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
      setError(errorMessage(err))
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
    // Enter in the preset name field saves the preset, not the session.
    if (target.dataset['presetName'] !== undefined) {
      event.preventDefault()
      void savePreset()
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
          <div className="flex items-center gap-2">
            <PresetMenu
              presets={presets}
              disabled={busy}
              onApply={applyPreset}
              onRemove={(preset): void => void removePreset(preset)}
            />
            {presetNotice !== null ? (
              <span className="min-w-0 truncate text-[11px] text-muted-foreground" data-preset-notice="">{presetNotice}</span>
            ) : null}
          </div>
          <NewSessionFields
            agent={agent}
            folder={folder}
            name={name}
            groupChoice={groupChoice}
            statusChoice={statusChoice}
            argsRaw={argsRaw}
            modelRaw={modelRaw}
            remoteControl={remoteControl}
            askPermissions={askPermissions}
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
            onAskPermissionsChange={setAskPermissions}
          />

          {error !== null ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}

          {presetName !== null ? (
            <div className="flex items-center gap-2" data-preset-save-row="">
              <Input
                value={presetName}
                onChange={(event): void => setPresetName(event.target.value)}
                aria-label="Preset name"
                data-preset-name=""
                maxLength={60}
                autoFocus
                className="h-8 flex-1 text-xs"
              />
              <Button type="button" size="sm" className="text-xs" onClick={(): void => void savePreset()}>
                Save preset
              </Button>
              <Button type="button" variant="ghost" size="sm" className="text-xs" onClick={(): void => setPresetName(null)}>
                Cancel
              </Button>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mr-auto text-xs text-muted-foreground"
              disabled={busy || folder.trim().length === 0 || presetName !== null}
              onClick={(): void => setPresetName(suggestedPresetName(name, folder))}
            >
              Save as preset
            </Button>
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
