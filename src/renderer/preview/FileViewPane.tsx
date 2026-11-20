// Side-panel file viewer (D73): renders one FileView. It does no IPC and reads no disk: main read the
// file and this shows it. Markdown/CSV/sheet/image/docx each get their own body; the footer is fixed.
import { useEffect, useMemo, useState, type MouseEvent, type ReactElement } from 'react'
import type { FileView, Id } from '../../shared/types'
import { FILE_VIEW_MAX_COLS, FILE_VIEW_MAX_ROWS } from '../../shared/types'
import { Button } from '../components/ui/button'
import { MarkdownView } from '../code/changes/MarkdownView'
import { cn } from '../lib/utils'
import '../styles/markdown.css'
import { FileTable } from './FileTable'
import { formatBytes, imageSrc, kindLabel, sanitizeDocxHtml, visibleSheet } from './fileViewLogic'

export interface FileViewPaneProps {
  readonly view: FileView
  /** Links inside a docx open through the app pipeline with this session's context (D12). */
  readonly sessionId: Id
  readonly className?: string
}

const TEXT_TRUNCATED_NOTE = 'File was cut at the preview size cap — the end is missing.'
const TABLE_TRUNCATED_NOTE = `Showing the first ${String(FILE_VIEW_MAX_ROWS)} rows / ${String(FILE_VIEW_MAX_COLS)} columns.`
const NO_IMAGE = 'No image data.'
const EMPTY_TEXT = 'The file is empty.'
const EMPTY_DOCUMENT = 'The document has no text.'
const EMPTY_TABLE = 'No table data.'
const NO_ROWS = 'No rows.'
const FITTED_LABEL = 'Fit to pane'
const ACTUAL_SIZE_LABEL = 'Show at 100%'

/** Same dark-theme checkerboard as the Changes preview: a transparent image stays visible. */
const CHECKERBOARD = {
  backgroundImage:
    'linear-gradient(45deg, rgba(128,128,128,0.18) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.18) 75%), linear-gradient(45deg, rgba(128,128,128,0.18) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.18) 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 8px 8px'
} as const

function Notice({ text, failed }: { readonly text: string; readonly failed?: boolean }): ReactElement {
  return (
    <p role={failed === true ? 'alert' : undefined} className={cn('px-3 py-2 text-xs', failed === true ? 'text-destructive' : 'text-muted-foreground')}>
      {text}
    </p>
  )
}

interface FileViewFooterProps {
  readonly view: FileView
}

/** Always present: name, kind and size, plus the cap notice when main cut the file. */
function FileViewFooter({ view }: FileViewFooterProps): ReactElement {
  return (
    <footer
      data-file-footer=""
      className="flex shrink-0 items-center gap-2 border-t border-sidebar-border px-2 py-1 text-[11px] text-muted-foreground"
    >
      <span className="min-w-0 truncate font-medium text-foreground/80" title={view.path}>
        {view.name}
      </span>
      <span className="shrink-0">{kindLabel(view.kind)}</span>
      <span className="ml-auto shrink-0 tabular-nums">{formatBytes(view.size)}</span>
      {view.truncated ? (
        <span data-file-truncated="" className="shrink-0 text-amber-500">
          cut at the size cap
        </span>
      ) : null}
    </footer>
  )
}

interface ImageBodyProps {
  readonly view: FileView
  readonly fit: boolean
  readonly natural: { readonly width: number; readonly height: number } | null
  readonly onFitChange: (fit: boolean) => void
  readonly onLoaded: (size: { readonly width: number; readonly height: number }) => void
}

function ImageBody({ view, fit, natural, onFitChange, onLoaded }: ImageBodyProps): ReactElement {
  const src = imageSrc(view)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-2 text-[11px] text-muted-foreground">
        <span data-image-size="" className="min-w-0 truncate tabular-nums">
          {natural === null ? 'Loading image…' : `${String(natural.width)} × ${String(natural.height)} px`}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-pressed={fit}
          aria-label={fit ? ACTUAL_SIZE_LABEL : FITTED_LABEL}
          data-image-fit={fit ? 'fit' : 'actual'}
          className="text-[11px]"
          onClick={(): void => onFitChange(!fit)}
        >
          {fit ? 'Fit' : '100%'}
        </Button>
      </div>
      {src === '' ? (
        <Notice text={NO_IMAGE} failed />
      ) : (
        <div
          data-testid="file-view-image"
          className={cn('min-h-0 flex-1 overflow-auto p-3', fit && 'flex items-center justify-center')}
          style={CHECKERBOARD}
        >
          <img
            alt={view.name}
            src={src}
            className={cn('rounded-md', fit ? 'max-h-full max-w-full object-contain' : 'max-w-none')}
            onLoad={(event): void =>
              onLoaded({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
            }
          />
        </div>
      )}
    </div>
  )
}

interface TableBodyProps {
  readonly view: FileView
  readonly activeSheet: number
  readonly onSelectSheet: (index: number) => void
}

function TableBody({ view, activeSheet, onSelectSheet }: TableBodyProps): ReactElement {
  const sheet = visibleSheet(view, activeSheet)
  if (sheet === null) return <Notice text={EMPTY_TABLE} />
  const selected = view.sheets.indexOf(sheet)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {view.sheets.length > 1 ? (
        <div
          role="tablist"
          aria-label="Sheets"
          className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-sidebar-border px-1 py-1"
        >
          {view.sheets.map((option, index: number) => (
            <Button
              key={`${option.name}:${String(index)}`}
              type="button"
              role="tab"
              size="xs"
              variant={index === selected ? 'secondary' : 'ghost'}
              aria-selected={index === selected}
              data-sheet-tab={index}
              className="shrink-0 text-[11px]"
              title={option.name}
              onClick={(): void => onSelectSheet(index)}
            >
              {option.name}
            </Button>
          ))}
        </div>
      ) : null}
      {sheet.truncated ? (
        <p data-table-truncated="" className="shrink-0 border-b border-sidebar-border px-3 py-2 text-xs text-muted-foreground">
          {TABLE_TRUNCATED_NOTE}
        </p>
      ) : null}
      {sheet.rows.length === 0 ? <Notice text={NO_ROWS} /> : <FileTable sheet={sheet} columnLetters={view.kind === 'sheet'} />}
    </div>
  )
}

interface DocxBodyProps {
  readonly view: FileView
  readonly sessionId: Id
}

function DocxBody({ view, sessionId }: DocxBodyProps): ReactElement {
  const html = useMemo((): string => sanitizeDocxHtml(view.content), [view.content])

  function openLink(event: MouseEvent<HTMLDivElement>): void {
    const target = event.target instanceof Element ? event.target : null
    const anchor = target === null ? null : target.closest('a')
    if (anchor === null) return
    event.preventDefault()
    const href = anchor.getAttribute('href') ?? ''
    // Main re-resolves; never trusts the renderer (same rule as MarkdownView, D12).
    if (/^https?:\/\//i.test(href)) void window.api.openLink(sessionId, href, false)
  }

  if (view.content === '') return <Notice text={EMPTY_DOCUMENT} />
  return (
    <div className="min-h-0 flex-1 overflow-auto" onClick={openLink}>
      <div
        data-markdown=""
        data-docx=""
        data-session-id={sessionId}
        className="px-4 py-3"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

function TextBody({ view }: { readonly view: FileView }): ReactElement {
  if (view.content === '') return <Notice text={EMPTY_TEXT} />
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {view.truncated ? <p className="px-3 py-2 text-xs text-muted-foreground">{TEXT_TRUNCATED_NOTE}</p> : null}
      <pre data-file-text="" className="w-max min-w-full px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground/90">
        {view.content}
      </pre>
    </div>
  )
}

export function FileViewPane({ view, sessionId, className }: FileViewPaneProps): ReactElement {
  const [activeSheet, setActiveSheet] = useState(0)
  const [fit, setFit] = useState(true)
  const [natural, setNatural] = useState<{ readonly width: number; readonly height: number } | null>(null)

  // A new file starts over: first sheet, fit to the pane, no stale natural size from the last image.
  useEffect((): void => {
    setActiveSheet(0)
    setFit(true)
    setNatural(null)
  }, [view.path])

  function body(): ReactElement {
    switch (view.kind) {
      case 'markdown':
        return <MarkdownView content={view.content} truncated={view.truncated} sessionId={sessionId} />
      case 'text':
        return <TextBody view={view} />
      case 'image':
        return <ImageBody view={view} fit={fit} natural={natural} onFitChange={setFit} onLoaded={setNatural} />
      case 'csv':
      case 'sheet':
        return <TableBody view={view} activeSheet={activeSheet} onSelectSheet={setActiveSheet} />
      case 'docx':
        return <DocxBody view={view} sessionId={sessionId} />
    }
  }

  return (
    <section
      aria-label={`Preview: ${view.name}`}
      data-file-view={view.kind}
      className={cn('flex min-h-0 flex-col bg-card text-xs', className)}
    >
      <div className="flex min-h-0 flex-1 flex-col">{body()}</div>
      <FileViewFooter view={view} />
    </section>
  )
}
