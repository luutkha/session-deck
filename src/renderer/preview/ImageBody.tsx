// Image body of the preview pane (D73, zoom D74 #6): Fit or an explicit 10..800% level, which the
// pane steps with the -, + buttons and Ctrl+wheel.
import { Minus, Plus } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { FileView } from '../../shared/types'
import { Button } from '../components/ui/button'
import { cn } from '../lib/utils'
import { Notice } from './Notice'
import { imageSrc } from './fileViewLogic'
import { IMAGE_ZOOM_MAX, IMAGE_ZOOM_MIN, formatZoom } from './fileViewZoom'

export interface ImageBodyProps {
  readonly view: FileView
  readonly fit: boolean
  readonly zoom: number
  readonly natural: { readonly width: number; readonly height: number } | null
  readonly onFitChange: (fit: boolean) => void
  readonly onZoom: (direction: 1 | -1) => void
  readonly onLoaded: (size: { readonly width: number; readonly height: number }) => void
}

const NO_IMAGE = 'No image data.'
const BROKEN_IMAGE = 'Could not draw this image: the file may be damaged or not really an image.'
const FITTED_LABEL = 'Fit to pane'
const ACTUAL_SIZE_LABEL = 'Show at 100%'

/** Same dark-theme checkerboard as the Changes preview: a transparent image stays visible. */
const CHECKERBOARD = {
  backgroundImage:
    'linear-gradient(45deg, rgba(128,128,128,0.18) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.18) 75%), linear-gradient(45deg, rgba(128,128,128,0.18) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.18) 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 8px 8px'
} as const

export function ImageBody(props: ImageBodyProps): ReactElement {
  const { view, fit, zoom, natural, onFitChange, onZoom, onLoaded } = props
  const src = imageSrc(view)
  // A damaged image never fires onLoad: remember WHICH source failed so a live reload with new bytes tries again.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const failed = src !== '' && failedSrc === src
  const size =
    fit || natural === null
      ? undefined
      : { width: `${String((natural.width * zoom) / 100)}px`, height: `${String((natural.height * zoom) / 100)}px` }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-2 text-[11px] text-muted-foreground">
        <span data-image-size="" className="min-w-0 truncate tabular-nums">
          {failed ? 'Cannot draw image' : natural === null ? 'Loading image…' : `${String(natural.width)} × ${String(natural.height)} px`}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Zoom out image"
            disabled={!fit && zoom <= IMAGE_ZOOM_MIN}
            onClick={(): void => onZoom(-1)}
          >
            <Minus />
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            aria-pressed={fit}
            aria-label={fit ? ACTUAL_SIZE_LABEL : FITTED_LABEL}
            data-image-fit={fit ? 'fit' : 'actual'}
            data-image-zoom={zoom}
            className="min-w-12 text-[11px] tabular-nums"
            onClick={(): void => onFitChange(!fit)}
          >
            {fit ? 'Fit' : formatZoom(zoom)}
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Zoom in image"
            disabled={!fit && zoom >= IMAGE_ZOOM_MAX}
            onClick={(): void => onZoom(1)}
          >
            <Plus />
          </Button>
        </div>
      </div>
      {src === '' ? (
        <Notice text={NO_IMAGE} failed />
      ) : failed ? (
        <Notice text={BROKEN_IMAGE} failed />
      ) : (
        <div
          data-testid="file-view-image"
          className={cn('min-h-0 flex-1 overflow-auto p-3', fit && 'flex items-center justify-center')}
          style={CHECKERBOARD}
        >
          <img
            alt={view.name}
            src={src}
            style={size}
            className={cn('rounded-md', fit ? 'max-h-full max-w-full object-contain' : 'max-w-none')}
            onError={(): void => setFailedSrc(src)}
            onLoad={(event): void =>
              onLoaded({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
            }
          />
        </div>
      )}
    </div>
  )
}
