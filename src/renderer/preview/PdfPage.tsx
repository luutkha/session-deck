// One page of the PDF viewer (D75): a correctly sized white sheet that draws its canvas only while it
// is near the viewport. Leaving the viewport cancels the render and drops the canvas (frees memory).
import { memo, useCallback, useEffect, useRef } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import type { ReactElement } from 'react'
import { isRenderCancelled, pdfCanvasSize } from './pdfLogic'

export interface PdfPageViewProps {
  readonly doc: PDFDocumentProxy
  /** 0-based page index. */
  readonly index: number
  /** CSS size at the current zoom. */
  readonly width: number
  readonly height: number
  readonly scale: number
  readonly active: boolean
  readonly onElement: (index: number, element: HTMLDivElement | null) => void
}

/** Memoised: scrolling changes the page label, not the props of every page. */
export const PdfPageView = memo(function PdfPageView(props: PdfPageViewProps): ReactElement {
  const { doc, index, width, height, scale, active, onElement } = props
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const setElement = useCallback(
    (element: HTMLDivElement | null): void => onElement(index, element),
    [index, onElement]
  )

  useEffect((): (() => void) => {
    const canvas = canvasRef.current
    if (!active || canvas === null) return (): void => undefined
    let cancelled = false
    let task: RenderTask | null = null
    void (async (): Promise<void> => {
      try {
        const page = await doc.getPage(index + 1)
        if (cancelled) return
        const viewport = page.getViewport({ scale })
        const pixels = pdfCanvasSize(viewport.width, viewport.height, 1, window.devicePixelRatio)
        canvas.width = pixels.width
        canvas.height = pixels.height
        const transform = [pixels.width / viewport.width, 0, 0, pixels.height / viewport.height, 0, 0]
        task = page.render({ canvas, viewport, transform })
        await task.promise
        task = null
        if (!cancelled) page.cleanup()
      } catch (error: unknown) {
        if (!cancelled && !isRenderCancelled(error)) {
          console.error(`Could not render PDF page ${String(index + 1)}`, error)
        }
      }
    })()
    return (): void => {
      cancelled = true
      task?.cancel()
    }
  }, [active, doc, index, scale])

  return (
    <div
      ref={setElement}
      data-pdf-page={index}
      className="shrink-0 bg-white shadow-md ring-1 ring-black/25"
      style={{ width: `${String(width)}px`, height: `${String(height)}px` }}
    >
      {active ? (
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Page ${String(index + 1)}`}
          className="block"
          style={{ width: `${String(width)}px`, height: `${String(height)}px` }}
        />
      ) : null}
    </div>
  )
})
