// Main-process reader of ONE local file for the side-panel file viewer (D73). The path is already absolute and
// resolved by the caller (a terminal link); the renderer never touches the disk. Every read is size-capped and
// errors come back as { ok: false }, never as a throw.
import { open, stat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { basename, isAbsolute } from 'node:path'
import { fileViewKindFor } from '../../shared/fileViewKind'
import { errorMessage } from '../../shared/guards'
import {
  FILE_VIEW_DOC_MAX_BYTES,
  FILE_VIEW_IMAGE_MAX_BYTES,
  FILE_VIEW_TEXT_MAX_BYTES,
  type FileView,
  type FileViewKind,
  type FileViewResult,
  type FileViewSheet
} from '../../shared/types'
import { parseCsv } from './csv'
import { readDocxHtml } from './docx'
import { readSheets } from './sheets'

const IMAGE_MIME: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp'
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

interface CappedRead {
  readonly bytes: Buffer
  readonly truncated: boolean
}

function fail(error: string): FileViewResult {
  return { ok: false, error }
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/** utf8 text without a leading BOM (Windows editors write one; it would show as a stray character). */
function decodeText(bytes: Buffer): string {
  const text = bytes.toString('utf8')
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * Reads at most `cap` bytes from the start of the file. For text, `cutAtLineBreak` drops the partial last
 * line of a cut file instead of ending the viewer on half a line.
 */
async function readCapped(target: string, size: number, cap: number, cutAtLineBreak: boolean): Promise<CappedRead> {
  const wanted = Math.min(size, cap)
  const handle = await open(target, 'r')
  try {
    const bytes = Buffer.alloc(wanted)
    const { bytesRead } = await handle.read(bytes, 0, wanted, 0)
    const head = bytes.subarray(0, bytesRead)
    if (size <= cap) return { bytes: head, truncated: false }
    if (!cutAtLineBreak) return { bytes: head, truncated: true }
    const lastBreak = head.lastIndexOf(0x0a)
    // One line longer than the cap: keep the cap, a cut mid-line still shows more than nothing.
    return { bytes: lastBreak < 0 ? head : head.subarray(0, lastBreak + 1), truncated: true }
  } finally {
    await handle.close()
  }
}

function baseView(path: string, name: string, kind: FileViewKind, size: number, mime: string): FileView {
  return { path, name, kind, size, content: '', base64: '', mime, sheets: [], truncated: false }
}

/** Reads one local file for the viewer. Never throws: a refusal is { ok: false, error }. */
export async function readFileView(absPath: string): Promise<FileViewResult> {
  try {
    if (typeof absPath !== 'string' || absPath.length === 0) return fail('No file path')
    if (!isAbsolute(absPath)) return fail('Not an absolute path')
    // UNC paths are network shares: never touched, not even a stat.
    if (absPath.startsWith('\\\\') || absPath.startsWith('//')) return fail('Network paths are not supported')
    const kind = fileViewKindFor(absPath)
    if (kind === null) return fail('This file type cannot be shown')

    let info: Stats
    try {
      info = await stat(absPath)
    } catch {
      return fail('File not found or not readable')
    }
    if (!info.isFile()) return fail('Not a file')
    const size = info.size
    // A cut image or document is useless, so those are refused instead of truncated.
    if (kind === 'image' && size > FILE_VIEW_IMAGE_MAX_BYTES) return fail('Image is too large to show')
    if ((kind === 'sheet' || kind === 'docx') && size > FILE_VIEW_DOC_MAX_BYTES) return fail('File is too large to show')

    const name = basename(absPath)
    const extension = extensionOf(name)

    if (kind === 'image') {
      const { bytes } = await readCapped(absPath, size, FILE_VIEW_IMAGE_MAX_BYTES, false)
      const view = baseView(absPath, name, kind, size, IMAGE_MIME[extension] ?? 'application/octet-stream')
      return { ok: true, view: { ...view, base64: bytes.toString('base64') } }
    }

    if (kind === 'markdown' || kind === 'text') {
      const { bytes, truncated } = await readCapped(absPath, size, FILE_VIEW_TEXT_MAX_BYTES, true)
      const mime = kind === 'markdown' ? 'text/markdown' : 'text/plain'
      return { ok: true, view: { ...baseView(absPath, name, kind, size, mime), content: decodeText(bytes), truncated } }
    }

    if (kind === 'csv') {
      const { bytes, truncated } = await readCapped(absPath, size, FILE_VIEW_TEXT_MAX_BYTES, true)
      const tsv = extension === 'tsv'
      const table = parseCsv(decodeText(bytes), tsv ? '\t' : ',')
      const sheet: FileViewSheet = { name, rows: table.rows, truncated: table.truncated }
      const view = baseView(absPath, name, kind, size, tsv ? 'text/tab-separated-values' : 'text/csv')
      return { ok: true, view: { ...view, sheets: [sheet], truncated: truncated || table.truncated } }
    }

    if (kind === 'sheet') {
      const { bytes, truncated } = await readCapped(absPath, size, FILE_VIEW_DOC_MAX_BYTES, false)
      if (truncated) return fail('File is too large to show')
      const read = await readSheets(bytes)
      const view = baseView(absPath, name, kind, size, XLSX_MIME)
      return { ok: true, view: { ...view, sheets: read.sheets, truncated: read.truncated } }
    }

    const { bytes, truncated } = await readCapped(absPath, size, FILE_VIEW_DOC_MAX_BYTES, false)
    if (truncated) return fail('File is too large to show')
    const read = await readDocxHtml(bytes)
    const view = baseView(absPath, name, kind, size, DOCX_MIME)
    return { ok: true, view: { ...view, content: read.html, truncated: read.truncated } }
  } catch (error) {
    return fail(`Could not read the file: ${errorMessage(error)}`)
  }
}
