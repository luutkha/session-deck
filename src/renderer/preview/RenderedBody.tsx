// Rendered bodies of the preview pane (D73): markdown through the shared MarkdownView and sanitized
// docx HTML. Both get find highlights through their DOM (D74 #6). Markdown also gets its relative
// images and links wired up (D75); docx carries no images, so that stays markdown-only.
import { useEffect, useMemo, useRef, type MouseEvent, type ReactElement } from 'react'
import type { FileView, Id } from '../../shared/types'
import { MarkdownView } from '../code/changes/MarkdownView'
import { Notice } from './Notice'
import { sanitizeDocxHtml } from './fileViewLogic'
import { highlightRendered, scrollFindCurrent } from './renderedFind'
import { useMarkdownImages, useMarkdownLinks } from './useMarkdownAssets'

export interface RenderedBodyProps {
  readonly kind: 'markdown' | 'docx'
  readonly view: FileView
  readonly sessionId: Id
  readonly query: string
  readonly active: number
  readonly onCount: (count: number) => void
  readonly zoomPercent: number
}

const BASE_FONT_PX = 13
const EMPTY_DOCUMENT = 'The document has no text.'

export function RenderedBody(props: RenderedBodyProps): ReactElement {
  const { kind, view, sessionId, query, active, onCount, zoomPercent } = props
  const hostRef = useRef<HTMLDivElement | null>(null)
  const docxRef = useRef<HTMLDivElement | null>(null)
  const html = useMemo((): string => sanitizeDocxHtml(view.content), [view.content])

  // D75: images are filled in after the HTML is in the DOM; links are intercepted in the capture
  // phase so MarkdownView's http(s)-only handler does not swallow relative ones.
  const isMarkdown = kind === 'markdown'
  useMarkdownImages(hostRef, view, sessionId, isMarkdown)
  useMarkdownLinks(hostRef, view, sessionId, isMarkdown)

  useEffect((): void => {
    const root =
      kind === 'markdown'
        ? (hostRef.current?.querySelector<HTMLElement>('[data-markdown]') ?? null)
        : docxRef.current
    if (root === null) {
      onCount(0)
      return
    }
    onCount(highlightRendered(root, query, active))
    scrollFindCurrent(root)
  }, [kind, query, active, view.content, onCount])

  function openLink(event: MouseEvent<HTMLDivElement>): void {
    const target = event.target instanceof Element ? event.target : null
    const anchor = target === null ? null : target.closest('a')
    if (anchor === null) return
    event.preventDefault()
    const href = anchor.getAttribute('href') ?? ''
    // Main re-resolves; never trusts the renderer (same rule as MarkdownView, D12).
    if (/^https?:\/\//i.test(href)) void window.api.openLink(sessionId, href, false)
  }

  const style = { fontSize: `${String((BASE_FONT_PX * zoomPercent) / 100)}px` }

  if (kind === 'markdown') {
    return (
      <div ref={hostRef} data-file-zoom="" className="min-h-0 flex-1" style={style}>
        <MarkdownView content={view.content} truncated={view.truncated} sessionId={sessionId} />
      </div>
    )
  }

  if (view.content === '') return <Notice text={EMPTY_DOCUMENT} />

  return (
    <div
      data-file-zoom=""
      className="min-h-0 flex-1 overflow-auto"
      style={style}
      onClick={openLink}
    >
      <div
        ref={docxRef}
        data-markdown=""
        data-docx=""
        data-session-id={sessionId}
        className="px-4 py-3"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
