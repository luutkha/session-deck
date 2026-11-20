// The find bar of the preview pane (D74 #6). It only owns markup and keys: the query, the active
// match and the counted matches live in the pane and its bodies.
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useEffect, type ChangeEvent, type KeyboardEvent, type ReactElement, type RefObject } from 'react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { matchCounter } from './fileViewFind'

export interface FindBarProps {
  readonly query: string
  readonly active: number
  readonly total: number
  readonly inputRef: RefObject<HTMLInputElement | null>
  readonly onQueryChange: (query: string) => void
  readonly onNext: () => void
  readonly onPrevious: () => void
  readonly onClose: () => void
}

export function FindBar(props: FindBarProps): ReactElement {
  useEffect((): void => {
    props.inputRef.current?.focus()
    props.inputRef.current?.select()
  }, [props.inputRef])

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      props.onClose()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.shiftKey) props.onPrevious()
      else props.onNext()
    }
  }

  return (
    <div
      role="search"
      aria-label="Find in preview"
      data-file-find=""
      className="flex shrink-0 items-center gap-1 border-b border-sidebar-border bg-card px-1.5 py-1"
    >
      <Input
        ref={props.inputRef}
        type="text"
        className="h-6 flex-1 px-2 text-[11px]"
        placeholder="Find in preview"
        aria-label="Find in preview"
        autoComplete="off"
        spellCheck={false}
        value={props.query}
        onChange={(event: ChangeEvent<HTMLInputElement>): void => props.onQueryChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <span
        data-find-counter=""
        aria-live="polite"
        className="min-w-10 shrink-0 text-center text-[10px] tabular-nums text-muted-foreground"
      >
        {matchCounter(props.query, props.active, props.total)}
      </span>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label="Previous match"
        disabled={props.total <= 0}
        onClick={props.onPrevious}
      >
        <ChevronUp />
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label="Next match"
        disabled={props.total <= 0}
        onClick={props.onNext}
      >
        <ChevronDown />
      </Button>
      <Button type="button" size="icon-xs" variant="ghost" aria-label="Close find" onClick={props.onClose}>
        <X />
      </Button>
    </div>
  )
}
