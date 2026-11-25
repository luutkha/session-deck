// Document state of the PDF body (D75): one pdf.js document per view, loaded lazily and destroyed
// when the view changes or the pane unmounts. A PDF over FILE_VIEW_PDF_MAX_BYTES arrives streamed
// (`streamed: true`, empty base64): pdf.js then reads byte ranges through main instead of the whole file.
// W4-E: only page 1 is measured before the first paint; the rest are measured when first made visible.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { PDFDataRangeTransport, PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import type { FileView, Id } from '../../shared/types'
import { decodeBase64Bytes } from './pdfBytes'
import { loadPdfJs } from './pdfjs'
import {
  PDF_PAGE_GAP,
  PDF_VIEW_PADDING,
  isPasswordError,
  pdfPageBoxes,
  type PdfPageSize
} from './pdfLogic'
import { openPdfStream, type PdfStream } from './pdfStream'

export type PdfStatus = 'loading' | 'ready' | 'password' | 'error'

export interface PdfDocumentState {
  readonly status: PdfStatus
  readonly doc: PDFDocumentProxy | null
  readonly pages: readonly PdfPageSize[]
  /** Offset to apply once the new placeholders are laid out; null when there is nothing to restore. */
  readonly savedScroll: number | null
  readonly clearSavedScroll: () => void
  /** Measures a page's real size the first time it becomes visible (no-op for already measured pages). */
  readonly measurePage: (index: number) => void
}

/** pdf.js 5 removed eval support from its API; the flag stays harmless and states the CSP rule. */
interface PdfLoadOptions {
  readonly data?: Uint8Array
  readonly range?: PDFDataRangeTransport
  readonly rangeChunkSize?: number
  readonly disableAutoFetch?: boolean
  readonly disableStream?: boolean
  readonly isEvalSupported: false
}

/** A big file: ranges on demand, no whole-file stream, no eval. */
function streamedOptions(transport: PDFDataRangeTransport): PdfLoadOptions {
  return {
    range: transport,
    rangeChunkSize: 1 << 20,
    disableAutoFetch: true,
    disableStream: true,
    isEvalSupported: false
  }
}

function logPdfError(error: unknown): void {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  console.error(`Could not read this PDF (${detail})`, error)
}

/**
 * W4-E: page 1's size is the placeholder for every other page until that page is measured. Waiting for
 * getPage on each of thousands of pages before the first paint made long PDFs unusable to open.
 */
export function pdfEstimatedPages(first: PdfPageSize, count: number): readonly PdfPageSize[] {
  const total = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  const size: PdfPageSize = {
    width: Number.isFinite(first.width) && first.width > 0 ? first.width : 1,
    height: Number.isFinite(first.height) && first.height > 0 ? first.height : 1
  }
  return Array.from({ length: total }, (): PdfPageSize => size)
}

/**
 * W4-E: a page measured above the viewport changes the content height before it; shift scrollTop by that
 * delta so the reader keeps their place. Pages below the viewport may change the scroll height unanchored.
 */
export function pdfAnchorScrollDelta(
  previous: readonly PdfPageSize[],
  measured: readonly PdfPageSize[],
  scrollTop: number,
  scale: number,
  gap: number = PDF_PAGE_GAP,
  padding: number = PDF_VIEW_PADDING
): number {
  if (previous.length !== measured.length || !Number.isFinite(scrollTop) || scrollTop <= 0) return 0
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  const before = pdfPageBoxes(previous, safeScale, gap, padding)
  let delta = 0
  for (let index = 0; index < before.length; index += 1) {
    const box = before[index]
    const old = previous[index]
    const next = measured[index]
    if (box === undefined || old === undefined || next === undefined) break
    // Past the viewport, no later page can be wholly above it either.
    if (box.top + box.height > scrollTop) break
    delta += (next.height - old.height) * safeScale
  }
  return delta
}

export function usePdfDocument(
  view: FileView,
  sessionId: Id,
  scrollRef: RefObject<HTMLDivElement | null>
): PdfDocumentState {
  const pageCountRef = useRef(0)
  const measuredRef = useRef<ReadonlySet<number>>(new Set())
  const measureRef = useRef<(index: number) => void>(() => undefined)
  const [status, setStatus] = useState<PdfStatus>('loading')
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pages, setPages] = useState<readonly PdfPageSize[]>([])
  const [savedScroll, setSavedScroll] = useState<number | null>(null)

  useEffect((): (() => void) => {
    let cancelled = false
    let failed = false
    let task: PDFDocumentLoadingTask | null = null
    let stream: PdfStream | null = null
    const previousPages = pageCountRef.current
    const scrollTop = scrollRef.current?.scrollTop ?? 0
    measuredRef.current = new Set()
    measureRef.current = (): void => undefined
    setStatus('loading')
    setDoc(null)
    setPages([])
    // A failed range arrives after loading started; a failed first request comes through the catch.
    const fail = (error: unknown): void => {
      if (cancelled || failed) return
      failed = true
      if (isPasswordError(error)) {
        setStatus('password')
        return
      }
      setStatus('error')
      logPdfError(error)
      if (task !== null) void task.destroy().catch((): undefined => undefined)
    }
    void (async (): Promise<void> => {
      try {
        const pdfjs = await loadPdfJs()
        if (cancelled) return
        let options: PdfLoadOptions
        if (view.streamed === true) {
          const opened = await openPdfStream({
            pdfjs,
            size: view.size,
            readRange: (start: number, end: number) =>
              window.api.readFileViewRange(sessionId, view.path, start, end),
            onError: fail
          })
          if (cancelled) {
            opened.cancel()
            return
          }
          stream = opened
          options = streamedOptions(opened.transport)
        } else {
          options = { data: decodeBase64Bytes(view.base64), isEvalSupported: false }
        }
        task = pdfjs.getDocument(options)
        const loaded = await task.promise
        if (cancelled) return
        // W4-E: one page up front; every other page starts at its size and is measured on first visibility.
        let sizes: readonly PdfPageSize[] = []
        if (loaded.numPages > 0) {
          const first = await loaded.getPage(1)
          if (cancelled) return
          const viewport = first.getViewport({ scale: 1 })
          first.cleanup()
          sizes = pdfEstimatedPages({ width: viewport.width, height: viewport.height }, loaded.numPages)
          measuredRef.current = new Set([0])
        }
        setSavedScroll(previousPages === loaded.numPages ? scrollTop : 0)
        pageCountRef.current = loaded.numPages
        setPages(sizes)
        setDoc(loaded)
        setStatus('ready')
        measureRef.current = (index: number): void => {
          if (
            cancelled ||
            !Number.isInteger(index) ||
            index <= 0 ||
            index >= loaded.numPages ||
            measuredRef.current.has(index)
          ) {
            return
          }
          measuredRef.current = new Set([...measuredRef.current, index])
          void loaded.getPage(index + 1).then((page): void => {
            if (cancelled) return
            const real = page.getViewport({ scale: 1 })
            page.cleanup()
            const size: PdfPageSize = { width: real.width, height: real.height }
            // Only the measured page changes; other placeholders keep the estimate until they are visible.
            setPages((current): readonly PdfPageSize[] => {
              if (current.length !== loaded.numPages || current[index] === undefined) return current
              const next = [...current]
              next[index] = size
              return next
            })
          }, (): void => undefined)
        }
      } catch (error: unknown) {
        fail(error)
      }
    })()
    return (): void => {
      cancelled = true
      stream?.cancel()
      if (task !== null) void task.destroy().catch((): undefined => undefined)
    }
  }, [view.base64, view.path, view.size, view.streamed, view.mtimeMs, sessionId, scrollRef])

  const clearSavedScroll = useCallback((): void => setSavedScroll(null), [])
  const measurePage = useCallback((index: number): void => measureRef.current(index), [])
  return { status, doc, pages, savedScroll, clearSavedScroll, measurePage }
}
