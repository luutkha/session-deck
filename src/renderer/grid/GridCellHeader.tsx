// The header of one grid cell (D32): status dot, session picker (a small self-contained popover of the
// open sessions — picking one MOVES it into this cell) and unassign. A grid variant of SplitPaneHeader.
// No portal/overlay: the popover lives inside the header, so clicks and keyboard always reach it.
import { useState, type MouseEvent, type ReactElement } from 'react'
import { ChevronDown, X } from 'lucide-react'
import type { AttentionReason, Id, SessionRun } from '../../shared/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { tabIndicatorFor } from '../shell/tabStatus'

export interface GridCellSessionChoice {
  readonly id: Id
  readonly name: string
  readonly run: SessionRun | null
  readonly attention: AttentionReason | null
}

export interface GridCellHeaderProps {
  readonly name: string | null
  readonly run: SessionRun | null
  readonly attention: AttentionReason | null
  /** The open sessions for the picker (the cell's own session is listed too — picking it is a no-op). */
  readonly choices: readonly GridCellSessionChoice[]
  readonly onPick: (id: Id) => void
  readonly onUnassign: () => void
}

const PICK_LABEL = 'Choose the session for this cell'
const UNASSIGN_LABEL = 'Empty this cell'

export function GridCellHeader(props: GridCellHeaderProps): ReactElement {
  const [open, setOpen] = useState(false)
  const indicator = props.name === null ? null : tabIndicatorFor(props.run, props.attention)
  return (
    <div className="relative flex h-6 shrink-0 items-center gap-1 border-b border-border bg-card px-1 text-[11px] text-muted-foreground">
      {indicator !== null ? (
        <>
          <span
            aria-hidden="true"
            className={cn('size-1.5 shrink-0 rounded-full', indicator.colorClass, indicator.pulse && 'animate-pulse motion-reduce:animate-none')}
          />
          <span className="sr-only">{indicator.label}</span>
        </>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        aria-label={PICK_LABEL}
        aria-expanded={open}
        className="app-no-drag min-w-0 flex-1 justify-start gap-1 px-1 text-[11px] text-muted-foreground hover:text-foreground"
        onMouseDown={(event: MouseEvent<HTMLButtonElement>): void => event.stopPropagation()}
        onClick={(event: MouseEvent<HTMLButtonElement>): void => {
          event.stopPropagation()
          setOpen(!open)
        }}
        onKeyDown={(event): void => {
          if (event.key === 'Escape') setOpen(false)
        }}
      >
        <span className="min-w-0 flex-1 truncate text-left">{props.name ?? 'Pick a session'}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </Button>
      {props.name !== null ? (
        <button
          type="button"
          aria-label={UNASSIGN_LABEL}
          className="app-no-drag flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground"
          onMouseDown={(event: MouseEvent<HTMLButtonElement>): void => event.stopPropagation()}
          onClick={(event: MouseEvent<HTMLButtonElement>): void => {
            event.stopPropagation()
            props.onUnassign()
          }}
        >
          <X size={12} aria-hidden="true" />
        </button>
      ) : null}
      {open ? (
        <div
          data-cell-menu=""
          className="absolute left-1 right-1 top-6 z-30 max-h-56 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
        >
          {props.choices.length === 0 ? (
            <p className="px-2 py-1 text-[11px] text-muted-foreground">No open sessions.</p>
          ) : (
            props.choices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                data-cell-choice-id={choice.id}
                className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-[11px] text-foreground outline-none hover:bg-accent focus-visible:bg-accent"
                onClick={(event: MouseEvent<HTMLButtonElement>): void => {
                  event.stopPropagation()
                  props.onPick(choice.id)
                  setOpen(false)
                }}
              >
                <span
                  aria-hidden="true"
                  className={cn('size-1.5 shrink-0 rounded-full', tabIndicatorFor(choice.run, choice.attention).colorClass)}
                />
                <span className="min-w-0 truncate">{choice.name}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
