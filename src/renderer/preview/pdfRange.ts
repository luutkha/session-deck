// Pure rules of the streamed PDF reader (D75): how a byte range splits into main's request cap, how
// much of the file the first request brings, and the toolbar note. No pdfjs and no DOM: vitest runs
// this file in Node.
import { formatBytes } from './fileViewLogic'

/** pdf.js parses the header and the first objects from these bytes before it asks for ranges. */
export const PDF_FIRST_CHUNK_BYTES = 64 * 1024
/** Main reads one range per call; two in flight keep a scroll responsive without flooding IPC. */
export const PDF_RANGE_CONCURRENCY = 2

/**
 * [begin, end) as ordered pieces of at most `maxLen` bytes, covering the range exactly. Empty for an
 * empty or reversed range; a broken maxLen falls back to one piece.
 */
export function splitRange(begin: number, end: number, maxLen: number): Array<[number, number]> {
  const from = Number.isFinite(begin) ? Math.floor(begin) : 0
  const to = Number.isFinite(end) ? Math.floor(end) : from
  if (to <= from) return []
  const limit = Number.isFinite(maxLen) && maxLen >= 1 ? Math.floor(maxLen) : to - from
  const pieces: Array<[number, number]> = []
  for (let start = from; start < to; start += limit) pieces.push([start, Math.min(to, start + limit)])
  return pieces
}

/** The first request of a streamed PDF: the header chunk, never more than the file itself. */
export function pdfFirstChunkSize(size: number): number {
  if (!Number.isFinite(size) || size <= 0) return 0
  return Math.min(PDF_FIRST_CHUNK_BYTES, Math.floor(size))
}

/** Toolbar note of a streamed PDF: the whole size, and that pages arrive on demand. */
export function streamedPdfNote(size: number): string {
  return `Large file (${formatBytes(size)}): pages load as you scroll`
}
