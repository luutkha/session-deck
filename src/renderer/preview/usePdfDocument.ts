// Document state of the PDF body (D75): one pdf.js document per view.base64, loaded lazily and
// destroyed when the view changes or the pane unmounts. Live reload keeps the scroll offset when the
// new file has the same page count.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import type { FileView } from '../../shared/types'
import { loadPdfJs } from './pdfjs'
import { isPasswordError, type PdfPageSize } from './pdfLogic'

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
  readonly data: Uint8Array
  readonly isEvalSupported: false
}

/** base64 of the whole file (main caps it at FILE_VIEW_PDF_MAX_BYTES) to the bytes pdf.js wants. */
function decodeBase64(base64: string): Uint8Array {
  const binary = window.atob(base64.replace(/\s+/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function usePdfDocument(
  view: FileView,
  scrollRef: RefObject<HTMLDivElement | null>
): PdfDocumentState {
  const pageCountRef = useRef(0)
  const [status, setStatus] = useState<PdfStatus>('loading')
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pages, setPages] = useState<readonly PdfPageSize[]>([])
  const [savedScroll, setSavedScroll] = useState<number | null>(null)

  useEffect((): (() => void) => {
    let cancelled = false
    let task: PDFDocumentLoadingTask | null = null
    const previousPages = pageCountRef.current
    const scrollTop = scrollRef.current?.scrollTop ?? 0
    setStatus('loading')
    setDoc(null)
    setPages([])
    void (async (): Promise<void> => {
      try {
        const pdfjs = await loadPdfJs()
        if (cancelled) return
        task = pdfjs.getDocument({
          data: decodeBase64(view.base64),
          isEvalSupported: false
        } as PdfLoadOptions)
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
        if (cancelled) return
        setStatus(isPasswordError(error) ? 'password' : 'error')
        if (!isPasswordError(error)) {
          const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
          console.error(`Could not read this PDF (${detail})`, error)
        }
      }
    })()
    return (): void => {
      cancelled = true
      if (task !== null) void task.destroy().catch((): undefined => undefined)
    }
  }, [view.base64, scrollRef])

  const clearSavedScroll = useCallback((): void => setSavedScroll(null), [])
  return { status, doc, pages, savedScroll, clearSavedScroll }
}
