// The Preview view of the Changes panel (rich previews, Code mode): images at fit-width on a
// dark-theme-safe checkerboard, markdown rendered through MarkdownView. Notices match DiffView's style.
import type { ReactElement } from 'react'
import type { FilePreview } from '../../../shared/types'
import { cn } from '../../lib/utils'
import { MarkdownView } from './MarkdownView'

export interface PreviewViewProps {
  readonly preview: FilePreview | null
  readonly loading: boolean
  readonly error: string | null
  readonly sessionId: string
}

const LOADING_MESSAGE = 'Loading preview...'
const NO_IMAGE = 'No image data.'

function Notice({ text, failed }: { readonly text: string; readonly failed?: boolean }): ReactElement {
  return (
    <p role={failed ? 'alert' : undefined} className={cn('px-3 py-2 text-xs', failed ? 'text-destructive' : 'text-muted-foreground')}>
      {text}
    </p>
  )
}

/** The image bytes arrive as base64; the mime rides along. One broken image = a notice, not a crash. */
function ImageView({ preview }: { readonly preview: FilePreview }): ReactElement {
  if (preview.base64.length === 0) return <Notice text={NO_IMAGE} failed />
  return (
    <div
      data-testid="preview-image"
      className="flex min-h-0 flex-1 items-start justify-center overflow-auto p-3"
      style={{
        backgroundImage:
          'linear-gradient(45deg, rgba(128,128,128,0.18) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.18) 75%), linear-gradient(45deg, rgba(128,128,128,0.18) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.18) 75%)',
        backgroundSize: '16px 16px',
        backgroundPosition: '0 0, 8px 8px'
      }}
    >
      <img
        alt={preview.path}
        src={`data:${preview.mime};base64,${preview.base64}`}
        className="max-w-full rounded-md"
      />
    </div>
  )
}

export function PreviewView({ preview, loading, error, sessionId }: PreviewViewProps): ReactElement {
  if (error !== null) {
    return <Notice text={error} failed />
  }
  if (preview === null) {
    return <Notice text={loading ? LOADING_MESSAGE : ''} />
  }
  if (preview.kind === 'image') {
    return <ImageView preview={preview} />
  }
  return <MarkdownView content={preview.content} truncated={preview.truncated} sessionId={sessionId} />
}
