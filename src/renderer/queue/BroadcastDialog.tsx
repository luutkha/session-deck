// "Send prompt to N sessions" (D48): one prompt goes into the queue of every selected Claude/OpenCode session.
import { useState, type KeyboardEvent, type ReactElement } from 'react'
import { QUEUE_TEXT_MAX } from '../../shared/types'
import { Button } from '../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Textarea } from '../components/ui/textarea'
import type { BroadcastPlan } from './queueLogic'

export interface BroadcastDialogProps {
  readonly open: boolean
  readonly plan: BroadcastPlan
  readonly onOpenChange: (open: boolean) => void
  readonly onSend: (text: string) => void
}

function planLines(plan: BroadcastPlan): readonly string[] {
  const lines: string[] = []
  if (plan.now.length > 0) lines.push(`${plan.now.length} idle: sent right away`)
  if (plan.later.length > 0) lines.push(`${plan.later.length} busy: sent when their turn finishes`)
  if (plan.stopped.length > 0) lines.push(`${plan.stopped.length} not running: queued until they run and finish a turn`)
  if (plan.skipped.length > 0) lines.push(`${plan.skipped.length} skipped (Shell session or full queue)`)
  return lines
}

export function BroadcastDialog({ open, plan, onOpenChange, onSend }: BroadcastDialogProps): ReactElement {
  const [text, setText] = useState('')
  const reach = plan.now.length + plan.later.length + plan.stopped.length
  const trimmed = text.trim()
  const canSend = reach > 0 && trimmed.length > 0 && trimmed.length <= QUEUE_TEXT_MAX

  function send(): void {
    if (!canSend) return
    onSend(trimmed)
    setText('')
    onOpenChange(false)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      send()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]" data-broadcast-dialog="">
        <DialogHeader>
          <DialogTitle>Send prompt to {reach === 1 ? '1 session' : `${reach} sessions`}</DialogTitle>
          <DialogDescription>
            The prompt goes through each session&apos;s queue, so a running turn is never interrupted.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(event): void => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Prompt for every selected session… (Ctrl+Enter sends)"
          aria-label="Prompt for the selected sessions"
          rows={5}
          autoFocus
          className="resize-none text-[13px]"
        />
        <ul className="flex flex-col gap-0.5 text-[12px] text-muted-foreground" data-broadcast-plan="">
          {planLines(plan).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={(): void => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!canSend} onClick={send}>
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
