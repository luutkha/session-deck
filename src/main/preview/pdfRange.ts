// D75: one byte range of a big PDF for pdf.js's range transport. A PDF over FILE_VIEW_PDF_MAX_BYTES is never
// loaded whole by the main process: the renderer asks for the ranges it needs and gets them base64-encoded here.
// Same path safety as readFileView, one range per request, and never a throw (a refusal is { ok: false, error }).
import { open, stat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { errorMessage } from '../../shared/guards'
import {
  FILE_VIEW_PDF_RANGE_MAX_BYTES,
  FILE_VIEW_PDF_STREAM_MAX_BYTES,
  type FileViewRangeResult
} from '../../shared/types'
import { checkPath } from './readFileView'

function fail(error: string): FileViewRangeResult {
  return { ok: false, error }
}

/**
 * Reads `[start, end)` of a PDF, clamped to the file size. `start` echoes the request so the renderer can feed
 * pdf.js. The file is re-statted: one that shrank to nothing or grew past the stream cap is refused, so a range
 * never belongs to a file the viewer would not show.
 */
export async function readPdfRange(absPath: string, start: number, end: number): Promise<FileViewRangeResult> {
  try {
    const checked = checkPath(absPath)
    if (!checked.ok) return fail(checked.error)
    if (checked.kind !== 'pdf') return fail('Not a PDF file')
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end) return fail('Invalid range')

    let info: Stats
    try {
      info = await stat(absPath)
    } catch {
      return fail('File not found or not readable')
    }
    if (!info.isFile()) return fail('Not a file')
    const size = info.size
    if (size < 1 || size > FILE_VIEW_PDF_STREAM_MAX_BYTES) {
      return fail(size < 1 ? 'Range outside the file' : 'PDF is too large to show (over 1 GB)')
    }
    if (start >= size) return fail('Range outside the file')
    const stop = Math.min(end, size)
    if (stop - start > FILE_VIEW_PDF_RANGE_MAX_BYTES) return fail('Range too large')

    const wanted = stop - start
    const handle = await open(absPath, 'r')
    try {
      const buffer = Buffer.alloc(wanted)
      let bytesRead = 0
      // A single read may return fewer bytes than asked; loop until the range is read or the file ends.
      while (bytesRead < wanted) {
        const chunk = await handle.read(buffer, bytesRead, wanted - bytesRead, start + bytesRead)
        if (chunk.bytesRead === 0) break
        bytesRead += chunk.bytesRead
      }
      return { ok: true, start, base64: buffer.subarray(0, bytesRead).toString('base64') }
    } finally {
      await handle.close()
    }
  } catch (error) {
    return fail(`Could not read the file: ${errorMessage(error)}`)
  }
}
