import type { ReactElement } from 'react'
import type { AgentKind } from '../../../shared/types'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { MAX_OPENCODE_MODEL_LENGTH } from '../../Sidebar/dialogLogic'
import { AGENT_CHOICES } from './worktreeDialogLogic'

export const LABEL_CLASS = 'text-[11px] text-muted-foreground'
export const INPUT_CLASS = 'h-8 text-xs'
const SELECT_CLASS = 'w-full text-xs'

function isAgentKind(value: string): value is AgentKind {
  return AGENT_CHOICES.some((choice): boolean => choice.value === value)
}

export interface SessionAgentFieldsProps {
  /** Prefix for element ids, so two dialogs never clash. */
  readonly idPrefix: string
  readonly agent: AgentKind
  readonly onAgentChange: (agent: AgentKind) => void
  readonly model: string
  readonly onModelChange: (value: string) => void
  /** Why the OpenCode model is not valid (shown under the field), or null. */
  readonly modelError: string | null
  readonly disabled: boolean
}

/** Agent (Claude Code / OpenCode / Shell) and, for OpenCode only, the model. */
export function SessionAgentFields(props: SessionAgentFieldsProps): ReactElement {
  const { idPrefix, agent, disabled } = props
  return (
    <>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-agent`} className={LABEL_CLASS}>Agent</Label>
        <Select
          value={agent}
          disabled={disabled}
          onValueChange={(value): void => {
            if (isAgentKind(value)) props.onAgentChange(value)
          }}
        >
          <SelectTrigger id={`${idPrefix}-agent`} aria-label="Agent" size="sm" className={SELECT_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {AGENT_CHOICES.map((choice) => (
              <SelectItem key={choice.value} value={choice.value} className="text-xs">
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {agent === 'opencode' && <ModelField {...props} />}
    </>
  )
}

function ModelField({ idPrefix, model, onModelChange, modelError, disabled }: SessionAgentFieldsProps): ReactElement {
  const id = `${idPrefix}-model`
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className={LABEL_CLASS}>Model (optional)</Label>
      <Input
        id={id}
        type="text"
        value={model}
        disabled={disabled}
        onChange={(event): void => onModelChange(event.target.value)}
        placeholder="provider/model, e.g. opencode/deepseek-v4.1-flash-free"
        maxLength={MAX_OPENCODE_MODEL_LENGTH}
        aria-invalid={modelError !== null}
        className={INPUT_CLASS}
      />
      {modelError !== null ? (
        <p role="alert" className="text-[11px] text-destructive">{modelError}</p>
      ) : (
        <p className="text-[11px] text-muted-foreground">Empty uses OpenCode&apos;s own default model</p>
      )}
    </div>
  )
}
