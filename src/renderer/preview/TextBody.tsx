// Plain-text body of the preview pane (D73, find D74 #6): highlights every match with a <mark>
// segment and scrolls the active one into view.
import { useEffect, useMemo, useRef, type ReactElement } from 'react'
import type { FileView } from '../../shared/types'
import { Notice } from './Notice'
import { splitByMatches } from './fileViewFind'

export interface TextBodyProps {
  readonly view: FileView
  readonly query: string
  readonly active: number
  readonly onCount: (count: number) => void
  readonly zoomPercent: number
}

const TEXT_TRUNCATED_NOTE = 'File was cut at the preview size cap — the end is missing.'
const EMPTY_TEXT = 'The file is empty.'
const MATCH_CLASS = 'rounded-sm bg-amber-400/30 text-inherit'
const CURRENT_CLASS = 'rounded-sm bg-amber-400 text-black'

export function TextBody({ view, query, active, onCount, zoomPercent }: TextBodyProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const segments = useMemo(() => splitByMatches(view.content, query), [view.content, query])
  const count = useMemo(
    (): number => segments.reduce((total: number, segment): number => total + (segment.match ? 1 : 0), 0),
    [segments]
  )

  useEffect((): void => {
    onCount(count)
  }, [count, onCount])

  useEffect((): void => {
    hostRef.current
      ?.querySelector<HTMLElement>('[data-find-current]')
      ?.scrollIntoView({ block: 'center', inline: 'nearest' })
  }, [active, query])

  if (view.content === '') return <Notice text={EMPTY_TEXT} />

  let ordinal = 0
  return (
    <div
      ref={hostRef}
      className="min-h-0 flex-1 overflow-auto"
      style={{ fontSize: `${String((11 * zoomPercent) / 100)}px` }}
    >
      {view.truncated ? <p className="px-3 py-2 text-xs text-muted-foreground">{TEXT_TRUNCATED_NOTE}</p> : null}
      <pre data-file-text="" className="w-max min-w-full px-3 py-2 font-mono leading-relaxed text-foreground/90">
        {segments.map((segment, index) => {
          if (!segment.match) return segment.text
          const own = ordinal
          ordinal += 1
          return (
            <mark
              key={index}
              data-find-match=""
              data-find-current={own === active ? '' : undefined}
              className={own === active ? CURRENT_CLASS : MATCH_CLASS}
            >
              {segment.text}
            </mark>
          )
        })}
      </pre>
    </div>
  )
}
