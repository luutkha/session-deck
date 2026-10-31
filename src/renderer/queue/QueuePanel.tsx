// The Queue tab of the side panel (D47): prompts typed into the session one by one as its turns finish.
import { ArrowUp, ListOrdered, SendHorizontal, X } from 'lucide-react'
import { useState, type KeyboardEvent, type ReactElement } from 'react'
import { QUEUE_MAX_ITEMS, QUEUE_TEXT_MAX, type QueuedPrompt, type RuntimeState, type Session } from '../../shared/types'
import { Button } from '../components/ui/button'
import { ScrollArea } from '../components/ui/scroll-area'
import { Textarea } from '../components/ui/textarea'
import { cn } from '../lib/utils'
import { addPrompt, movePromptUp, QUEUE_STATE_TEXT, queueState, removePrompt } from './queueLogic'

export interface QueuePanelProps {
  readonly session: Session
  readonly state: RuntimeState | undefined
  readonly onSetQueue: (id: string, items: readonly QueuedPrompt[]) => Promise<void>
  readonly onSendNow: (id: string, promptId: string) => Promise<void>
}

export function QueuePanel({ session, state, onSetQueue, onSendNow }: QueuePanelProps): ReactElement {
  const [draft, setDraft] = useState('')
  const queue = session.queue ?? []
  const mode = queueState(session, state)
  const full = queue.length >= QUEUE_MAX_ITEMS
  const tooLong = draft.trim().length > QUEUE_TEXT_MAX
  const canAdd = mode !== 'shell' && !full && !tooLong && draft.trim().length > 0

  function save(next: readonly QueuedPrompt[]): void {
    // A rejected save is shown in the store banner by the action wrapper; the list stays as main has it.
    onSetQueue(session.id, next).catch(() => undefined)
  }

  function add(): void {
    if (!canAdd) return
    save(addPrompt(queue, draft, crypto.randomUUID(), Date.now()))
    setDraft('')
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      add()
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-queue-panel="">
      <p data-queue-state={mode} className="shrink-0 border-b border-sidebar-border px-3 py-2 text-[11px] text-muted-foreground">
        {QUEUE_STATE_TEXT[mode]}
      </p>
      <ScrollArea className="min-h-0 flex-1">
        {queue.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground/80">
            No queued prompts. Line up the next instructions here; each one is sent when the turn before it finishes.
          </p>
        ) : (
          <ol aria-label="Queued prompts" className="flex flex-col gap-1.5 px-2 py-2">
            {queue.map((item, index) => (
              <li
                key={item.id}
                data-queue-item={item.id}
                className="group flex items-start gap-1.5 rounded-md border border-border bg-background/40 px-2 py-1.5"
              >
                <span className="mt-0.5 w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{index + 1}</span>
                <span className="line-clamp-4 min-w-0 flex-1 whitespace-pre-wrap break-words text-[12px] leading-snug">{item.text}</span>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Move up"
                    title="Send this one sooner"
                    disabled={index === 0}
                    className="text-muted-foreground"
                    onClick={(): void => save(movePromptUp(queue, item.id))}
                  >
                    <ArrowUp className="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Send now"
                    title="Type it in now, without waiting for the turn to finish"
                    disabled={mode === 'shell' || mode === 'stopped'}
                    className="text-muted-foreground"
                    onClick={(): void => {
                      onSendNow(session.id, item.id).catch(() => undefined)
                    }}
                  >
                    <SendHorizontal className="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Remove from queue"
                    className="text-muted-foreground"
                    onClick={(): void => save(removePrompt(queue, item.id))}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </ScrollArea>
      <div className="flex shrink-0 flex-col gap-1.5 border-t border-sidebar-border px-3 py-2">
        <Textarea
          value={draft}
          onChange={(event): void => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={mode === 'shell' ? 'Not available for Shell sessions' : 'Next prompt… (Ctrl+Enter adds it)'}
          aria-label="Prompt to queue"
          disabled={mode === 'shell'}
          rows={3}
          className="min-h-[64px] resize-none text-[12px]"
        />
        <div className="flex items-center gap-2">
          <span className={cn('text-[11px] tabular-nums text-muted-foreground', (full || tooLong) && 'text-destructive')}>
            {full ? `Queue is full (${QUEUE_MAX_ITEMS})` : tooLong ? `Too long (max ${QUEUE_TEXT_MAX})` : `${queue.length}/${QUEUE_MAX_ITEMS}`}
          </span>
          <Button type="button" size="xs" className="ml-auto" disabled={!canAdd} onClick={add}>
            <ListOrdered className="size-3.5" aria-hidden="true" />
            Add to queue
          </Button>
        </div>
      </div>
    </div>
  )
}
