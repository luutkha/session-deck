import { useState, type ReactElement } from 'react'
import { Trash2 } from 'lucide-react'
import type { Id, StatusDef } from '../../shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { evaluateStatusDraft } from './statusDraft'

const MAX_STATUS_NAME = 100
const DELETE_WARNING = 'Sessions with this status will have no status'
const ERROR_INDENT = 'pl-8'

export interface StatusRowProps {
  readonly status: StatusDef
  readonly error: string | null
  readonly confirmingDelete: boolean
  readonly onCommit: (status: StatusDef) => void
  readonly onClearError: (id: Id) => void
  readonly onDeleteClick: (id: Id) => void
  readonly onCancelDelete: () => void
}

interface StatusSwatchProps {
  readonly color: string
  readonly label: string
  readonly onChange: (color: string) => void
}

/** Rounded color swatch with the native color input hidden over it (Orca's picker swatch look). */
function StatusSwatch({ color, label, onChange }: StatusSwatchProps): ReactElement {
  return (
    <span className="relative block size-6 shrink-0 cursor-pointer rounded-[4px] border border-border/70 outline-none focus-within:ring-[3px] focus-within:ring-ring/50">
      <span
        aria-hidden="true"
        className="block size-full rounded-[3px]"
        style={{ backgroundColor: color }}
      />
      <input
        type="color"
        value={color}
        aria-label={label}
        className="absolute inset-0 size-full cursor-pointer opacity-0 outline-none focus-visible:outline-none"
        onChange={(event): void => onChange(event.target.value)}
      />
    </span>
  )
}

export function StatusRow({
  status,
  error,
  confirmingDelete,
  onCommit,
  onClearError,
  onDeleteClick,
  onCancelDelete
}: StatusRowProps): ReactElement {
  const [name, setName] = useState(status.name)
  const [color, setColor] = useState(status.color)
  const [draftError, setDraftError] = useState<string | null>(null)

  function commitDraft(nextName: string, nextColor: string): void {
    const result = evaluateStatusDraft(status, nextName, nextColor)
    if (result.error !== null) {
      setDraftError(result.error)
      return
    }
    setDraftError(null)
    if (result.next === null) {
      onClearError(status.id)
      return
    }
    onCommit(result.next)
  }

  const shownError = draftError ?? error

  return (
    <li className="flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <StatusSwatch
          color={color}
          label={`Color for ${status.name}`}
          onChange={(next): void => {
            setColor(next)
            commitDraft(name, next)
          }}
        />
        <Input
          type="text"
          className="h-8 min-w-0 flex-1 text-xs"
          value={name}
          maxLength={MAX_STATUS_NAME}
          aria-label={`Name for ${status.name}`}
          onChange={(event): void => {
            setName(event.target.value)
            if (draftError !== null) setDraftError(null)
          }}
          onBlur={(): void => commitDraft(name, color)}
        />
        <Badge
          variant="dot"
          className="h-4 max-w-[9rem] shrink-0 px-1.5 text-[10px] font-medium leading-none text-muted-foreground"
        >
          <span
            aria-hidden="true"
            className="inline-block size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span className="truncate">{name}</span>
        </Badge>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${status.name}`}
          onClick={(): void => onDeleteClick(status.id)}
          className={cn(
            'shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
            confirmingDelete && 'bg-destructive/10 text-destructive hover:bg-destructive/15'
          )}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      </div>
      {shownError !== null ? (
        <p className={cn(ERROR_INDENT, 'text-xs text-destructive')} role="alert">
          {shownError}
        </p>
      ) : null}
      {confirmingDelete ? (
        <div className={cn(ERROR_INDENT, 'flex items-center gap-2')}>
          <p className="text-xs text-muted-foreground">{DELETE_WARNING}</p>
          <Button type="button" variant="ghost" size="xs" className="text-xs" onClick={onCancelDelete}>
            Cancel
          </Button>
        </div>
      ) : null}
    </li>
  )
}