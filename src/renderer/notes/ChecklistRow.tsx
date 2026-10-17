import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { ChecklistItem } from '../../shared/types'
import { Button } from '../components/ui/button'
import { Checkbox } from '../components/ui/checkbox'
import { Input } from '../components/ui/input'
import { cn } from '../lib/utils'
import type { MoveDirection } from './checklistLogic'

export interface ChecklistRowProps {
  readonly item: ChecklistItem
  readonly first: boolean
  readonly last: boolean
  readonly onToggle: (id: string) => void
  readonly onEdit: (id: string, text: string) => void
  readonly onRemove: (id: string) => void
  readonly onMove: (id: string, direction: MoveDirection) => void
}

export function ChecklistRow({
  item,
  first,
  last,
  onToggle,
  onEdit,
  onRemove,
  onMove
}: ChecklistRowProps): ReactElement {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.text)
  const inputRef = useRef<HTMLInputElement>(null)
  const settledRef = useRef(false)

  useEffect(() => {
    if (editing) {
      settledRef.current = false
      inputRef.current?.select()
    }
  }, [editing])

  function startEdit(): void {
    setDraft(item.text)
    setEditing(true)
  }

  function commit(): void {
    if (settledRef.current) return
    settledRef.current = true
    setEditing(false)
    onEdit(item.id, draft)
  }

  function cancel(): void {
    if (settledRef.current) return
    settledRef.current = true
    setEditing(false)
    setDraft(item.text)
  }

  return (
    <li className="group/row flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-accent/40 focus-within:bg-accent/40">
      <Checkbox
        checked={item.done}
        aria-label={item.done ? `Mark ${item.text} not done` : `Mark ${item.text} done`}
        onCheckedChange={(): void => onToggle(item.id)}
        className="size-3.5"
      />
      {editing ? (
        <Input
          ref={inputRef}
          value={draft}
          aria-label="Edit step"
          className="h-6 min-w-0 flex-1 px-1.5 text-xs"
          onChange={(event): void => setDraft(event.target.value)}
          onKeyDown={(event): void => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              cancel()
            }
          }}
          onBlur={commit}
        />
      ) : (
        <button
          type="button"
          onClick={startEdit}
          onDoubleClick={startEdit}
          className={cn(
            'min-w-0 flex-1 truncate text-left text-xs',
            item.done ? 'text-muted-foreground line-through' : 'text-foreground'
          )}
        >
          {item.text}
        </button>
      )}
      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={first}
          aria-label={`Move ${item.text} up`}
          onClick={(): void => onMove(item.id, 'up')}
          className="size-5 text-muted-foreground"
        >
          <ChevronUp className="size-3" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={last}
          aria-label={`Move ${item.text} down`}
          onClick={(): void => onMove(item.id, 'down')}
          className="size-5 text-muted-foreground"
        >
          <ChevronDown className="size-3" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Delete ${item.text}`}
          onClick={(): void => onRemove(item.id)}
          className="size-5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-3" aria-hidden="true" />
        </Button>
      </div>
    </li>
  )
}
