// Text zoom toolbar of the preview pane (D74 #6): A- / A+ on the 70..200% ladder, remembered across
// previews by useTextZoom.
import type { ReactElement } from 'react'
import { Button } from '../components/ui/button'
import { TEXT_ZOOM_MAX, TEXT_ZOOM_MIN } from './fileViewZoom'

export interface TextZoomToolbarProps {
  readonly zoomPercent: number
  readonly onZoom: (direction: 1 | -1) => void
}

export function TextZoomToolbar({ zoomPercent, onZoom }: TextZoomToolbarProps): ReactElement {
  return (
    <div
      data-file-zoom-controls=""
      className="flex shrink-0 items-center justify-end gap-1 border-b border-sidebar-border px-1 py-0.5 text-muted-foreground"
    >
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label="Decrease text size"
        disabled={zoomPercent <= TEXT_ZOOM_MIN}
        onClick={(): void => onZoom(-1)}
        className="text-[11px] font-medium"
      >
        A-
      </Button>
      <span data-text-zoom={zoomPercent} className="min-w-9 text-center text-[10px] tabular-nums">
        {String(zoomPercent)}%
      </span>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label="Increase text size"
        disabled={zoomPercent >= TEXT_ZOOM_MAX}
        onClick={(): void => onZoom(1)}
        className="text-[11px] font-medium"
      >
        A+
      </Button>
    </div>
  )
}
