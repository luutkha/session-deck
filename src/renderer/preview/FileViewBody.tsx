// Body switch of the preview pane (D73): one renderer per file kind, each owning its own find and
// zoom details. FileViewPane keeps the shared state.
import type { ReactElement } from 'react'
import type { FileView, Id } from '../../shared/types'
import { ImageBody } from './ImageBody'
import { PdfBody } from './PdfBody'
import { RenderedBody } from './RenderedBody'
import { TableBody } from './TableBody'
import { TextBody } from './TextBody'

export interface FileViewBodyProps {
  readonly view: FileView
  readonly sessionId: Id
  readonly activeSheet: number
  readonly onSelectSheet: (index: number) => void
  readonly query: string
  readonly active: number
  readonly onCount: (count: number) => void
  readonly zoomPercent: number
  readonly fit: boolean
  readonly imageZoom: number
  readonly natural: { readonly width: number; readonly height: number } | null
  readonly onFitChange: (fit: boolean) => void
  readonly onImageZoom: (direction: 1 | -1) => void
  readonly onLoaded: (size: { readonly width: number; readonly height: number }) => void
}

export function FileViewBody(props: FileViewBodyProps): ReactElement {
  const { view, sessionId, activeSheet, onSelectSheet, query, active, onCount, zoomPercent } = props
  switch (view.kind) {
    case 'markdown':
    case 'docx':
      return (
        <RenderedBody
          kind={view.kind}
          view={view}
          sessionId={sessionId}
          query={query}
          active={active}
          onCount={onCount}
          zoomPercent={zoomPercent}
        />
      )
    case 'text':
      return <TextBody view={view} query={query} active={active} onCount={onCount} zoomPercent={zoomPercent} />
    case 'image':
      return (
        <ImageBody
          view={view}
          fit={props.fit}
          zoom={props.imageZoom}
          natural={props.natural}
          onFitChange={props.onFitChange}
          onZoom={props.onImageZoom}
          onLoaded={props.onLoaded}
        />
      )
    case 'pdf':
      return <PdfBody view={view} />
    case 'csv':
    case 'sheet':
      return (
        <TableBody
          view={view}
          activeSheet={activeSheet}
          onSelectSheet={onSelectSheet}
          query={query}
          active={active}
          onCount={onCount}
          zoomPercent={zoomPercent}
        />
      )
  }
}
