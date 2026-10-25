// Rendered Markdown (rich previews, Code mode): marked -> DOMPurify -> token CSS. DOMPurify is
// non-negotiable (markdown is untrusted content); links never navigate the window — they go through
// the existing open pipeline (D12), so the will-navigate guard stays untouched.
import { useMemo, type MouseEvent, type ReactElement } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { Id } from '../../../shared/types'
import { cn } from '../../lib/utils'
import '../../styles/markdown.css'

export interface MarkdownViewProps {
  readonly content: string
  readonly truncated: boolean
  /** Links open through the app pipeline with this session's context (cwd for relative links). */
  readonly sessionId: Id
  readonly className?: string
}

const TRUNCATED_NOTE = 'File was cut at the preview size cap — the end is missing.'

function openRenderedLink(event: MouseEvent<HTMLDivElement>): void {
  const anchor = (event.target as HTMLElement).closest('a')
  if (anchor === null) return
  event.preventDefault()
  const href = anchor.getAttribute('href') ?? ''
  if (/^https?:\/\//i.test(href)) {
    // Main re-resolves; never trusts the renderer (same as terminal links, D12).
    void window.api.openLink(event.currentTarget.dataset.sessionId ?? '', href, false)
  }
}

export function MarkdownView({ content, truncated, sessionId, className }: MarkdownViewProps): ReactElement {
  const html = useMemo((): string => {
    const raw = marked.parse(content, { async: false })
    return DOMPurify.sanitize(typeof raw === 'string' ? raw : '')
  }, [content])
  return (
    <div className={cn('min-h-0 flex-1 overflow-auto', className)}>
      {truncated ? <p className="px-3 py-2 text-xs text-muted-foreground">{TRUNCATED_NOTE}</p> : null}
      <div
        data-markdown=""
        data-session-id={sessionId}
        className="px-4 py-3"
        onClick={openRenderedLink}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
