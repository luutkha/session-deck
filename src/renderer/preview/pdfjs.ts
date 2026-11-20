// Lazy pdf.js loader of the PDF body (D75). It uses pdf.js' LEGACY build (with polyfills): the modern build calls
// Uint8Array.prototype.toHex, which Electron 34's Chromium 132 does not have ("a.toHex is not a function"). The static `?url` import only emits the worker asset and
// adds its URL to the main bundle; the ~1 MB library itself is a dynamic import on first PDF view.
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

export type PdfJs = typeof import('pdfjs-dist')

let pending: Promise<PdfJs> | null = null

/** The same promise for every PDF: one load, one worker URL assignment, a retry after a failure. */
export function loadPdfJs(): Promise<PdfJs> {
  pending ??= import('pdfjs-dist/legacy/build/pdf.mjs')
    .then((pdfjs: PdfJs): PdfJs => {
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
      return pdfjs
    })
    .catch((error: unknown) => {
      pending = null
      throw error
    })
  return pending
}
