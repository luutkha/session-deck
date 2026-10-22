import type { ReactElement } from 'react'
import type { AwaySessionSummary, AwaySummary, Id } from '../../shared/types'
import { Button } from '../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../components/ui/dialog'
import { openAwayRow } from './awayState'
import { awayHeadline, awayRowDetail, singleLine } from './timelineFormat'

export interface AwayDialogProps {
  readonly summary: AwaySummary | null
  readonly onOpenSession: (id: Id) => void
  readonly onClose: () => void
}

interface AwayRowProps {
  readonly row: AwaySessionSummary
  readonly onOpen: (id: Id) => void
}

function AwayRow({ row, onOpen }: AwayRowProps): ReactElement {
  const detail = awayRowDetail(row)
  const lastPrompt = singleLine(row.lastPrompt)
  return (
    <button
      type="button"
      data-away-row={row.sessionId}
      className="flex w-full min-w-0 flex-col items-start gap-0.5 rounded-md border border-border/60 px-3 py-2 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      onClick={(): void => onOpen(row.sessionId)}
    >
      <span className="w-full truncate text-[13px] font-semibold text-foreground">{row.name}</span>
      {detail !== '' ? (
        <span className="w-full truncate text-xs text-muted-foreground">{detail}</span>
      ) : null}
      {lastPrompt !== '' ? (
        <span className="w-full truncate text-xs text-muted-foreground">{lastPrompt}</span>
      ) : null}
    </button>
  )
}

export function AwayDialog({ summary, onOpenSession, onClose }: AwayDialogProps): ReactElement {
  const openRow = (id: Id): void => openAwayRow(id, onOpenSession, onClose)
  return (
    <Dialog
      open={summary !== null}
      onOpenChange={(open: boolean): void => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        {summary !== null ? (
          <>
            <DialogHeader>
              <DialogTitle>While you were away</DialogTitle>
              <DialogDescription>{awayHeadline(summary)}</DialogDescription>
            </DialogHeader>
            <div className="flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto">
              {summary.sessions.map((row: AwaySessionSummary): ReactElement => (
                <AwayRow key={row.sessionId} row={row} onOpen={openRow} />
              ))}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
