// PDF body of the preview pane (D75): pdf.js on canvases, because Chromium's own PDF viewer does not
// render in this window. Fit-to-width by default, its own page/zoom toolbar, lazy per-page drawing.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { FileView, Id } from '../../shared/types'
import { Notice } from './Notice'
import { PdfPageView } from './PdfPage'
import { PdfToolbar } from './PdfToolbar'
import {
  PDF_PAGE_GAP,
  PDF_VIEW_PADDING,
  fitPdfScale,
  pdfCurrentPage,
  pdfPageBoxes,
  stepPdfZoom,
  type PdfPageSize
} from './pdfLogic'
import { usePdfContainerWidth } from './usePdfContainerWidth'
import { pdfAnchorScrollDelta, usePdfDocument } from './usePdfDocument'
import { usePdfPageObserver } from './usePdfPageObserver'

export interface PdfBodyProps {
  readonly view: FileView
  /** A streamed PDF reads its byte ranges through main with this session's context (D75). */
  readonly sessionId: Id
}

const PASSWORD_NOTICE = 'This PDF is password protected'
const ERROR_NOTICE = 'Could not read this PDF'
const EMPTY_NOTICE = 'This PDF has no pages.'

export function PdfBody({ view, sessionId }: PdfBodyProps): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const { status, doc, pages, savedScroll, clearSavedScroll, measurePage } = usePdfDocument(view, sessionId, scrollRef)
  const containerWidth = usePdfContainerWidth(scrollRef)
  const active = status === 'ready' && doc !== null
  const { visible, observe } = usePdfPageObserver(scrollRef, active)
  const [fit, setFit] = useState(true)
  const [zoom, setZoom] = useState(100)
  const [current, setCurrent] = useState(0)

  // W4-E: fit to page 1, the only size known before paint. Fitting to a page measured later would rescale
  // every placeholder mid-scroll; an unusually wide page can still be reached with zoom/horizontal scroll.
  const fitWidth = pages[0]?.width ?? 0
  const fitScale = fitPdfScale(containerWidth, fitWidth)
  const scale = fit ? fitScale : zoom / 100
  const boxes = useMemo(() => pdfPageBoxes(pages, scale), [pages, scale])

  // Apply the offset once the new placeholders are laid out (a live reload with the same page count).
  useLayoutEffect((): void => {
    if (savedScroll === null) return
    const node = scrollRef.current
    if (node !== null) node.scrollTop = savedScroll
    clearSavedScroll()
  }, [savedScroll, clearSavedScroll])

  // W4-E: a lazily measured page above the viewport changes the content above the reader. Keep scrollTop
  // anchored by exactly that height delta; a new document is handled by savedScroll above instead.
  const laidOutRef = useRef<{ doc: PDFDocumentProxy | null; pages: readonly PdfPageSize[] }>({ doc: null, pages: [] })
  useLayoutEffect((): void => {
    const previous = laidOutRef.current
    laidOutRef.current = { doc, pages }
    if (previous.doc !== doc || doc === null || previous.pages.length !== pages.length) return
    const node = scrollRef.current
    if (node === null) return
    const delta = pdfAnchorScrollDelta(previous.pages, pages, node.scrollTop, scale)
    if (delta !== 0) node.scrollTop = Math.max(0, node.scrollTop + delta)
  }, [doc, pages, scale])

  // A zoom or a re-layout changes the page heights under a fixed scrollTop; keep the label honest.
  useLayoutEffect((): void => {
    const node = scrollRef.current
    if (node !== null && status === 'ready') setCurrent(pdfCurrentPage(boxes, node.scrollTop, node.clientHeight, node.scrollHeight))
  }, [boxes, status])

  function handleScroll(): void {
    const node = scrollRef.current
    if (node === null || status !== 'ready') return
    setCurrent(pdfCurrentPage(boxes, node.scrollTop, node.clientHeight, node.scrollHeight))
  }

  // W4-E: the observer already tells us which pages are near the viewport; measure them on first sight.
  useEffect((): void => {
    if (!active) return
    for (const index of visible) measurePage(index)
  }, [active, visible, measurePage])

  const zoomBy = useCallback(
    (direction: 1 | -1): void => {
      setZoom((currentZoom: number): number =>
        stepPdfZoom(fit ? Math.round(fitScale * 100) : currentZoom, direction)
      )
      setFit(false)
    },
    [fit, fitScale]
  )

  // Ctrl+wheel must be a native passive:false listener; the pane skips its text zoom for PDFs.
  useEffect((): (() => void) => {
    const node = rootRef.current
    if (node === null) return (): void => undefined
    function onWheel(event: WheelEvent): void {
      if (!event.ctrlKey || event.deltaY === 0) return
      event.preventDefault()
      zoomBy(event.deltaY < 0 ? 1 : -1)
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return (): void => node.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  const ready = status === 'ready' && doc !== null && pages.length > 0

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      {ready ? (
        <PdfToolbar
          current={current}
          total={pages.length}
          scale={scale}
          zoom={zoom}
          fit={fit}
          streamedBytes={view.streamed === true ? view.size : null}
          onZoom={zoomBy}
          onFit={(): void => setFit(true)}
        />
      ) : null}
      <div
        ref={scrollRef}
        data-testid="file-view-pdf"
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-auto bg-muted/30"
      >
        {ready ? (
          <div
            className="flex w-max min-w-full flex-col items-center"
            style={{ paddingTop: PDF_VIEW_PADDING, paddingBottom: PDF_VIEW_PADDING, paddingLeft: PDF_VIEW_PADDING, paddingRight: PDF_VIEW_PADDING, gap: PDF_PAGE_GAP }}
          >
            {doc !== null
              ? pages.map((page: PdfPageSize, index: number) => {
                  const box = boxes[index]
                  return (
                    <PdfPageView
                      key={index}
                      doc={doc}
                      index={index}
                      width={box?.width ?? page.width}
                      height={box?.height ?? page.height}
                      scale={scale}
                      active={visible.has(index)}
                      onElement={observe}
                    />
                  )
                })
              : null}
          </div>
        ) : null}
        {status === 'loading' ? (
          <p
            role="status"
            data-pdf-loading=""
            className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground"
          >
            {view.streamed === true ? 'Loading a large PDF...' : 'Rendering...'}
          </p>
        ) : null}
        {status === 'password' ? (
          <div className="flex h-full items-center justify-center p-4">
            <Notice text={PASSWORD_NOTICE} />
          </div>
        ) : null}
        {status === 'error' ? (
          <div className="flex h-full items-center justify-center p-4">
            <Notice text={ERROR_NOTICE} failed />
          </div>
        ) : null}
        {status === 'ready' && pages.length === 0 ? (
          <div className="flex h-full items-center justify-center p-4">
            <Notice text={EMPTY_NOTICE} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
