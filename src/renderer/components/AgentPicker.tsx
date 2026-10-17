import type { ReactElement } from 'react'
import type { AgentKind } from '../../shared/types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

export const AGENT_OPTIONS: readonly { readonly value: AgentKind; readonly label: string }[] = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'opencode', label: 'OpenCode' }
]

export interface AgentPickerProps {
  readonly value: AgentKind
  readonly onChange: (agent: AgentKind) => void
  /** Optional element id, so a <label htmlFor> can point at the dropdown. */
  readonly id?: string
  readonly disabled?: boolean
  readonly ariaLabel?: string
}

function isAgentKind(value: string): value is AgentKind {
  return AGENT_OPTIONS.some((option) => option.value === value)
}

/** Dropdown for picking the coding agent (Claude Code or OpenCode). */
export function AgentPicker({
  value,
  onChange,
  id,
  disabled = false,
  ariaLabel = 'Agent'
}: AgentPickerProps): ReactElement {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next): void => {
        if (isAgentKind(next)) onChange(next)
      }}
    >
      <SelectTrigger id={id} size="sm" aria-label={ariaLabel} className="w-full text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {AGENT_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value} className="text-xs">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
