import type { ReactElement } from 'react'
import type { AgentKind } from '../../shared/types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

export interface AgentOption {
  readonly value: AgentKind
  readonly label: string
}

export const AGENT_OPTIONS: readonly AgentOption[] = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'cursor', label: 'Cursor' }
]

/** D81: Jarvis runs on Claude or OpenCode only; Cursor is not offered as its engine. */
export const JARVIS_AGENT_OPTIONS: readonly AgentOption[] = AGENT_OPTIONS.filter(
  (option): boolean => option.value !== 'cursor'
)

export interface AgentPickerProps {
  readonly value: AgentKind
  readonly onChange: (agent: AgentKind) => void
  /** Optional element id, so a <label htmlFor> can point at the dropdown. */
  readonly id?: string
  readonly disabled?: boolean
  readonly ariaLabel?: string
  /** The offered agents; defaults to every agent (AGENT_OPTIONS). */
  readonly options?: readonly AgentOption[]
}

function isAgentKind(value: string, options: readonly AgentOption[]): value is AgentKind {
  return options.some((option) => option.value === value)
}

/** Dropdown for picking the coding agent (Claude Code, OpenCode or Cursor). */
export function AgentPicker({
  value,
  onChange,
  id,
  disabled = false,
  ariaLabel = 'Agent',
  options = AGENT_OPTIONS
}: AgentPickerProps): ReactElement {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next): void => {
        if (isAgentKind(next, options)) onChange(next)
      }}
    >
      <SelectTrigger id={id} size="sm" aria-label={ariaLabel} className="w-full text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="text-xs">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
