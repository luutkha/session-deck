// Document state of the PDF body (D75): one pdf.js document per view, loaded lazily and destroyed
// when the view changes or the pane unmounts. A PDF over FILE_VIEW_PDF_MAX_BYTES arrives streamed
// (`streamed: true`, empty base64): pdf.js then reads byte ranges through main instead of the whole file.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { PDFDataRangeTransport, PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import type { FileView, Id } from '../../shared/types'
import { decodeBase64Bytes } from './pdfBytes'
import { loadPdfJs } from './pdfjs'
import { isPasswordError, type PdfPageSize } from './pdfLogic'
import { openPdfStream, type PdfStream } from './pdfStream'

export type PdfStatus = 'loading' | 'ready' | 'password' | 'error'

export interface PdfDocumentState {
  readonly status: PdfStatus
  readonly doc: PDFDocumentProxy | null
  readonly pages: readonly PdfPageSize[]
  /** Offset to apply once the new placeholders are laid out; null when there is nothing to restore. */
  readonly savedScroll: number | null
  readonly clearSavedScroll: () => void
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

export function usePdfDocument(
  view: FileView,
  sessionId: Id,
  scrollRef: RefObject<HTMLDivElement | null>
): PdfDocumentState {
  const pageCountRef = useRef(0)
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
        const sizes = await Promise.all(
          Array.from({ length: loaded.numPages }, (_value: unknown, offset: number): Promise<PdfPageSize> =>
            loaded.getPage(offset + 1).then((page): PdfPageSize => {
              const viewport = page.getViewport({ scale: 1 })
              page.cleanup()
              return { width: viewport.width, height: viewport.height }
            })
          )
        )
        if (cancelled) return
        setSavedScroll(previousPages === loaded.numPages ? scrollTop : 0)
        pageCountRef.current = loaded.numPages
        setPages(sizes)
        setDoc(loaded)
        setStatus('ready')
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
  return { status, doc, pages, savedScroll, clearSavedScroll }
}
