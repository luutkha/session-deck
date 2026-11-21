import type { ReactElement, Ref } from 'react'
import { FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { AgentPicker } from '../components/AgentPicker'
import type { AgentKind, Group, StatusDef } from '../../shared/types'
import { defaultNameFromFolder, MAX_OPENCODE_MODEL_LENGTH } from './dialogLogic'

/** Internal choice values. The empty string means "no value" in dialog state. */
export const NEW_GROUP_CHOICE = '__new_group__'
export const NO_VALUE_CHOICE = ''
/** Radix Select cannot use an empty string as an item value, so "None" maps to this token. */
const NONE_ITEM_VALUE = '__none__'
const ARGS_HINT_ALLOWED = 'A-Z a-z 0-9 and _ @ = : , . / \\ -'

export interface NewSessionFieldsProps {
  readonly agent: AgentKind
  readonly folder: string
  readonly name: string
  readonly groupChoice: string
  readonly statusChoice: string
  readonly argsRaw: string
  readonly modelRaw: string
  readonly remoteControl: boolean
  /** D79: OpenCode only; false = yolo (the default everywhere), true = ask before running tools. */
  readonly askPermissions: boolean
  readonly modelError: string | null
  readonly newGroupName: string
  readonly groups: readonly Group[]
  readonly statuses: readonly StatusDef[]
  readonly busy: boolean
  readonly folderInputRef: Ref<HTMLInputElement>
  readonly onAgentChange: (agent: AgentKind) => void
  readonly onFolderChange: (value: string) => void
  readonly onBrowse: () => void
  readonly onNameChange: (value: string) => void
  readonly onGroupChange: (value: string) => void
  readonly onNewGroupNameChange: (value: string) => void
  readonly onStatusChange: (value: string) => void
  readonly onArgsChange: (value: string) => void
  readonly onModelChange: (value: string) => void
  readonly onRemoteControlChange: (value: boolean) => void
  readonly onAskPermissionsChange: (value: boolean) => void
}

const LABEL_CLASS = 'text-[11px] text-muted-foreground'
const INPUT_CLASS = 'h-8 text-xs'
const SELECT_CLASS = 'w-full text-xs'

export function NewSessionFields({
  agent,
  folder,
  name,
  groupChoice,
  statusChoice,
  argsRaw,
  modelRaw,
  remoteControl,
  askPermissions,
  modelError,
  newGroupName,
  groups,
  statuses,
  busy,
  folderInputRef,
  onAgentChange,
  onFolderChange,
  onBrowse,
  onNameChange,
  onGroupChange,
  onNewGroupNameChange,
  onStatusChange,
  onArgsChange,
  onModelChange,
  onRemoteControlChange,
  onAskPermissionsChange
}: NewSessionFieldsProps): ReactElement {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <span className={LABEL_CLASS}>Agent</span>
        <AgentPicker
          value={agent}
          onChange={onAgentChange}
          disabled={busy}
          ariaLabel="Agent"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="new-session-folder" className={LABEL_CLASS}>
          Folder
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="new-session-folder"
            ref={folderInputRef}
            type="text"
            value={folder}
            onChange={(event) => onFolderChange(event.target.value)}
            placeholder="C:\path\to\project"
            className={`${INPUT_CLASS} min-w-0 flex-1`}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 text-xs"
            onClick={onBrowse}
            disabled={busy}
          >
            <FolderOpen className="size-3.5" aria-hidden="true" />
            Browse...
          </Button>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="new-session-name" className={LABEL_CLASS}>
          Name (optional)
        </Label>
        <Input
          id="new-session-name"
          type="text"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={defaultNameFromFolder(folder)}
          maxLength={100}
          className={INPUT_CLASS}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="new-session-group" className={LABEL_CLASS}>
          Group
        </Label>
        <Select
          value={groupChoice === NO_VALUE_CHOICE ? NONE_ITEM_VALUE : groupChoice}
          onValueChange={(value) =>
            onGroupChange(value === NONE_ITEM_VALUE ? NO_VALUE_CHOICE : value)
          }
        >
          <SelectTrigger id="new-session-group" size="sm" className={SELECT_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={NONE_ITEM_VALUE} className="text-xs">
              No group
            </SelectItem>
            {groups.map((group) => (
              <SelectItem key={group.id} value={group.id} className="text-xs">
                {group.name}
              </SelectItem>
            ))}
            <SelectItem value={NEW_GROUP_CHOICE} className="text-xs">
              New group...
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {groupChoice === NEW_GROUP_CHOICE ? (
        <div className="space-y-1">
          <Label htmlFor="new-session-new-group" className={LABEL_CLASS}>
            New group name
          </Label>
          <Input
            id="new-session-new-group"
            type="text"
            value={newGroupName}
            onChange={(event) => onNewGroupNameChange(event.target.value)}
            placeholder="Group name"
            maxLength={100}
            className={INPUT_CLASS}
          />
        </div>
      ) : null}

      <div className="space-y-1">
        <Label htmlFor="new-session-status" className={LABEL_CLASS}>
          Status
        </Label>
        <Select
          value={statusChoice === NO_VALUE_CHOICE ? NONE_ITEM_VALUE : statusChoice}
          onValueChange={(value) =>
            onStatusChange(value === NONE_ITEM_VALUE ? NO_VALUE_CHOICE : value)
          }
        >
          <SelectTrigger id="new-session-status" size="sm" className={SELECT_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={NONE_ITEM_VALUE} className="text-xs">
              None
            </SelectItem>
            {statuses.map((status) => (
              <SelectItem key={status.id} value={status.id} className="text-xs">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="inline-block size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: status.color }}
                  />
                  {status.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {agent === 'opencode' ? (
        <div className="space-y-1">
          <Label htmlFor="new-session-model" className={LABEL_CLASS}>
            Model (optional)
          </Label>
          <Input
            id="new-session-model"
            type="text"
            value={modelRaw}
            onChange={(event) => onModelChange(event.target.value)}
            placeholder="provider/model, e.g. opencode/deepseek-v4.1-flash-free"
            maxLength={MAX_OPENCODE_MODEL_LENGTH}
            aria-invalid={modelError !== null}
            className={INPUT_CLASS}
          />
          {modelError !== null ? (
            <p role="alert" className="text-[11px] text-destructive">
              {modelError}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Empty uses OpenCode&apos;s own default model
            </p>
          )}
          <div className="flex items-start gap-2 pt-1">
            <Checkbox
              id="new-session-opencode-ask"
              checked={askPermissions}
              onCheckedChange={(checked) => onAskPermissionsChange(checked === true)}
              data-opencode-ask-permissions=""
              className="mt-0.5"
            />
            <div className="space-y-0.5">
              <Label htmlFor="new-session-opencode-ask" className="text-xs">
                Ask before running tools (use my own OpenCode permission rules)
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Off: tools run without asking (the default). On: your own OpenCode permission rules apply.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <Label htmlFor="new-session-args" className={LABEL_CLASS}>
            Extra claude args (optional)
          </Label>
          <Input
            id="new-session-args"
            type="text"
            value={argsRaw}
            onChange={(event) => onArgsChange(event.target.value)}
            placeholder="--model opus"
            className={INPUT_CLASS}
          />
          <p className="text-[11px] text-muted-foreground">
            Space-separated arguments. Allowed characters: {ARGS_HINT_ALLOWED}.
          </p>
          <div className="flex items-start gap-2 pt-1">
            <Checkbox
              id="new-session-remote"
              checked={remoteControl}
              onCheckedChange={(checked) => onRemoteControlChange(checked === true)}
              className="mt-0.5"
            />
            <div className="space-y-0.5">
              <Label htmlFor="new-session-remote" className="text-xs">
                Remote Control
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Use this session from claude.ai/code or the Claude app. It is kept awake while connected.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
