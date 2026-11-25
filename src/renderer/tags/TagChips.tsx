import { type ReactElement } from 'react'
import { tagChipStyle } from './tagLogic'

export interface TagChipsProps {
  readonly tags: readonly string[]
}

/** Only the first few chips fit in a sidebar row; the rest are counted and kept in the title. */
const VISIBLE_TAGS = 3

/**
 * Read-only chips for a sidebar row. Everything stays inline and truncated so adding tags never grows a row's height.
 */
export function TagChips({ tags }: TagChipsProps): ReactElement | null {
  if (tags.length === 0) return null
  const shown = tags.slice(0, VISIBLE_TAGS)
  const hidden = tags.length - shown.length
  return (
    <span
      data-tag-chips=""
      title={tags.join(', ')}
      className="inline-flex min-w-0 shrink items-center gap-1 overflow-hidden align-middle text-[10px] leading-none"
    >
      {shown.map((tag) => (
        <span
          key={tag}
          data-tag={tag}
          style={tagChipStyle(tag)}
          className="inline-block min-w-0 max-w-[6rem] shrink truncate rounded-full px-1.5 py-px align-middle text-[10px] leading-none"
        >
          {tag}
        </span>
      ))}
      {hidden > 0 ? (
        <span
          title={tags.join(', ')}
          className="shrink-0 rounded-full bg-muted px-1 py-px text-[10px] leading-none text-muted-foreground"
        >
          +{hidden}
        </span>
      ) : null}
    </span>
  )
}
