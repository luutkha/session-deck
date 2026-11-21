// PDF toolbar of the preview pane (D75): the page from the scroll position, the zoom ladder, and Fit
// back to the container width. PDFs get this row instead of the text A-/A+ toolbar.
import { Minus, Plus } from 'lucide-react'
import type { ReactElement } from 'react'
import { Button } from '../components/ui/button'
import { PDF_ZOOM_MAX, PDF_ZOOM_MIN, pdfPageLabel, pdfPercentLabel } from './pdfLogic'
import { streamedPdfNote } from './pdfRange'

export interface PdfToolbarProps {
  readonly current: number
  readonly total: number
  readonly scale: number
  readonly zoom: number
  readonly fit: boolean
  /** Size of a big PDF read in ranges (D75); null for a PDF delivered whole. */
  readonly streamedBytes?: number | null
  readonly onZoom: (direction: 1 | -1) => void
  readonly onFit: () => void
}

export function PdfToolbar(props: PdfToolbarProps): ReactElement {
  const { current, total, scale, zoom, fit, streamedBytes = null, onZoom, onFit } = props
  return (
    <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-2 text-[11px] text-muted-foreground">
      <span data-pdf-page-label="" className="min-w-0 truncate tabular-nums">
        {pdfPageLabel(current, total)}
      </span>
      {streamedBytes !== null ? (
        <span data-pdf-streamed="" className="min-w-0 flex-1 truncate text-[11px]" title="Pages are read from the file as you scroll to them">
          {streamedPdfNote(streamedBytes)}
        </span>
      ) : null}
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Zoom out PDF"
          disabled={!fit && zoom <= PDF_ZOOM_MIN}
          onClick={(): void => onZoom(-1)}
        >
          <Minus />
        </Button>
        <span data-pdf-zoom={Math.round(scale * 100)} className="min-w-11 text-center tabular-nums">
          {pdfPercentLabel(scale)}
        </span>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Zoom in PDF"
          disabled={!fit && zoom >= PDF_ZOOM_MAX}
          onClick={(): void => onZoom(1)}
        >
          <Plus />
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          aria-pressed={fit}
          aria-label="Fit PDF to width"
          data-pdf-fit={fit ? 'fit' : 'actual'}
          className="min-w-10 text-[11px]"
          onClick={onFit}
        >
          Fit
        </Button>
      </div>
    </div>
  )
}
