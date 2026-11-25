import { X } from 'lucide-react'
import { useState, type KeyboardEvent, type ReactElement } from 'react'
import type { Id } from '../../shared/types'
import { addTag, parseTagInput, removeTag, tagChipStyle } from './tagLogic'

export interface TagEditorProps {
  readonly sessionId: Id
  readonly tags: readonly string[]
}

/** Sends a changed tag list to the store; the broadcast re-syncs the editor, so a failed write needs no error UI. */
function commitTags(sessionId: Id, current: readonly string[], next: readonly string[]): void {
  if (next === current) return
  void window.api.setSessionTags(sessionId, next).catch(() => undefined)
}

/** One editor for the Notes tab: removable chips plus a field that commits on Enter or comma. */
export function TagEditor({ sessionId, tags }: TagEditorProps): ReactElement {
  const [input, setInput] = useState('')

  function commitInput(text: string): void {
    const next = parseTagInput(text).reduce<readonly string[]>((current, tag) => addTag(current, tag), tags)
    commitTags(sessionId, tags, next)
    setInput('')
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      commitInput(input)
    } else if (event.key === 'Backspace' && input === '') {
      const last = tags[tags.length - 1]
      if (last === undefined) return
      commitTags(sessionId, tags, removeTag(tags, last))
    }
  }

  return (
    <div data-tag-editor="" className="flex flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          data-tag={tag}
          style={tagChipStyle(tag)}
          className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] leading-none"
        >
          {tag}
          <button
            type="button"
            aria-label={`Remove tag ${tag}`}
            className="flex size-3 items-center justify-center rounded-full hover:bg-foreground/10"
            onClick={(): void => commitTags(sessionId, tags, removeTag(tags, tag))}
          >
            <X className="size-2.5" aria-hidden="true" />
          </button>
        </span>
      ))}
      <input
        type="text"
        aria-label="Add tag"
        placeholder="Add tag"
        value={input}
        onChange={(event): void => setInput(event.target.value)}
        onKeyDown={handleKeyDown}
        className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground/60"
      />
    </div>
  )
}
