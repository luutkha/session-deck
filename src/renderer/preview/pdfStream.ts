// Streamed reading of a big PDF (D75): pdf.js' range transport over window.api.readFileViewRange.
// pdf.js asks for the byte ranges it needs (never the whole file); main re-resolves the path and
// answers each one. This file owns the request queue, so at most two IPC reads run at once.
import type { PDFDataRangeTransport } from 'pdfjs-dist'
import type { FileViewRangeResult } from '../../shared/types'
import { FILE_VIEW_PDF_RANGE_MAX_BYTES } from '../../shared/types'
import { decodeBase64Bytes } from './pdfBytes'
import { PDF_RANGE_CONCURRENCY, pdfFirstChunkSize, splitRange } from './pdfRange'
import type { PdfJs } from './pdfjs'

export type ReadFileViewRange = (start: number, end: number) => Promise<FileViewRangeResult>

export interface PdfStreamOptions {
  readonly pdfjs: PdfJs
  /** The whole file, as main reported it: the transport's length and the first-chunk size. */
  readonly size: number
  readonly readRange: ReadFileViewRange
  /** A range that failed after loading started: the document cannot continue. */
  readonly onError: (error: unknown) => void
}

export interface PdfStream {
  readonly transport: PDFDataRangeTransport
  readonly cancel: () => void
}

interface RangeQueue {
  /** Runs the task once fewer than the concurrency cap are active; keeps the order of calls. */
  run: <T>(task: () => Promise<T>) => Promise<T>
  /** Drops the waiting tasks and starts no new one (the pane unmounted). */
  stop: () => void
}

function createRangeQueue(maxInFlight: number = PDF_RANGE_CONCURRENCY): RangeQueue {
  const waiting: Array<() => void> = []
  let active = 0
  let stopped = false

  function pump(): void {
    while (!stopped && active < maxInFlight && waiting.length > 0) {
      const start = waiting.shift()
      if (start === undefined) break
      active += 1
      start()
    }
  }

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject): void => {
        waiting.push((): void => {
          task().then(
            (value: T): void => {
              active -= 1
              resolve(value)
              pump()
            },
            (error: unknown): void => {
              active -= 1
              reject(error)
              pump()
            }
          )
        })
        pump()
      })
    },
    stop(): void {
      stopped = true
      waiting.length = 0
    }
  }
}

/** Fetches [begin, end) in capped pieces, in order, as the one chunk pdf.js asked for. */
async function readRangeBytes(
  queue: RangeQueue,
  read: ReadFileViewRange,
  begin: number,
  end: number
): Promise<Uint8Array> {
  const pieces = splitRange(begin, end, FILE_VIEW_PDF_RANGE_MAX_BYTES)
  const chunks = await Promise.all(
    pieces.map(([start, stop]: [number, number]): Promise<Uint8Array> =>
      queue.run(async (): Promise<Uint8Array> => {
        const result = await read(start, stop)
        if (!result.ok) throw new Error(result.error === '' ? 'range read failed' : result.error)
        return decodeBase64Bytes(result.base64)
      })
    )
  )
  const total = chunks.reduce((sum: number, chunk: Uint8Array): number => sum + chunk.length, 0)
  if (total !== end - begin) throw new Error(`short range read (${String(total)} of ${String(end - begin)} bytes)`)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

/**
 * First chunk, transport, then the hook calls getDocument({ range: transport, ... }). pdf.js' stream
 * wants one onDataRange per requested range (its range reader ends after the first chunk), so split
 * pieces are joined back together under the requested begin.
 */
export async function openPdfStream(options: PdfStreamOptions): Promise<PdfStream> {
  const { pdfjs, size, readRange, onError } = options
  const length = Number.isFinite(size) && size > 0 ? Math.floor(size) : 0
  const firstEnd = pdfFirstChunkSize(length)
  const first = firstEnd > 0 ? await readRange(0, firstEnd) : null
  if (first !== null && !first.ok) throw new Error(first.error === '' ? 'range read failed' : first.error)

  const initialData = first === null ? null : decodeBase64Bytes(first.base64)
  const transport = new pdfjs.PDFDataRangeTransport(length, initialData)
  const queue = createRangeQueue()
  let cancelled = false

  const stop = (): void => {
    cancelled = true
    queue.stop()
  }
  transport.abort = stop

  transport.requestDataRange = (begin: number, end: number): void => {
    const from = Math.max(0, Math.floor(begin))
    const to = Math.min(length, Math.floor(end))
    if (to <= from) {
      // Never leave pdf.js waiting on a range that cannot exist in the file.
      if (!cancelled) transport.onDataRange(from, new Uint8Array(0))
      return
    }
    void readRangeBytes(queue, readRange, from, to).then(
      (chunk: Uint8Array): void => {
        if (!cancelled) transport.onDataRange(from, chunk)
      },
      (error: unknown): void => {
        if (!cancelled) onError(error)
      }
    )
  }

  return { transport, cancel: stop }
}
