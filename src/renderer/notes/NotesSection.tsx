import { SquareCheck } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, type ReactElement } from 'react'
import { Button } from '../components/ui/button'
import { Textarea } from '../components/ui/textarea'
import { cn } from '../lib/utils'
import { MAX_NOTES } from './checklistLogic'
import { insertCheckbox } from './parseSteps'

export interface NotesSectionProps {
  readonly notes: string
  readonly onChange: (text: string) => void
  readonly onBlur: () => void
}

/** The counter turns destructive once fewer than this many characters remain. */
const NEAR_LIMIT_THRESHOLD = 2000

export function NotesSection({ notes, onChange, onBlur }: NotesSectionProps): ReactElement {
  const ref = useRef<HTMLTextAreaElement>(null)

  const resize = useCallback((): void => {
    const el = ref.current
    if (el === null) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useLayoutEffect((): void => {
    resize()
  }, [notes, resize])

  const addCheckbox = useCallback((): void => {
    const el = ref.current
    const caret = el?.selectionStart ?? notes.length
    const next = insertCheckbox(notes, caret)
    onChange(next.text)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(next.caret, next.caret)
    })
  }, [notes, onChange])

  const nearLimit = notes.length >= MAX_NOTES - NEAR_LIMIT_THRESHOLD

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-medium tracking-tight">Notes</h2>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label="Insert checkbox"
          title="Insert a - [ ] checkbox on the current line"
          className="text-xs text-muted-foreground"
          onMouseDown={(event): void => event.preventDefault()}
          onClick={addCheckbox}
        >
          <SquareCheck className="size-3.5" aria-hidden="true" />
          Checkbox
        </Button>
      </div>
      <Textarea
        ref={ref}
        value={notes}
        aria-label="Session notes"
        placeholder="Anything worth remembering for this session..."
        className="min-h-24 resize-none text-sm leading-relaxed"
        onChange={(event): void => onChange(event.target.value)}
        onBlur={onBlur}
      />
      <span
        className={cn(
          'text-right text-[11px] tabular-nums',
          nearLimit ? 'text-destructive' : 'text-muted-foreground'
        )}
      >
        {notes.length} / {MAX_NOTES}
      </span>
    </section>
  )
}