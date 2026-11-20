// Main-process reader of ONE local file for the side-panel file viewer (D73). The path is already absolute and
// resolved by the caller (a terminal link); the renderer never touches the disk. Every read is size-capped and
// errors come back as { ok: false }, never as a throw. D74: the view carries the file's mtime so the open preview
// can notice that the file changed on disk, and `statFileView` offers the same look without reading the bytes.
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
  type FileViewSheet,
  type FileViewStat
} from '../../shared/types'
import { parseCsv } from './csv'
import { readDocxHtml } from './docx'
import { decodeTextBytes } from './encoding'
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

interface DecodedText {
  readonly text: string
  readonly truncated: boolean
}

type PathCheck = { readonly ok: true; readonly kind: FileViewKind } | { readonly ok: false; readonly error: string }

function fail(error: string): FileViewResult {
  return { ok: false, error }
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/** The shared refusals of both entry points: same rules, same messages, no disk touched. */
function checkPath(absPath: string): PathCheck {
  if (typeof absPath !== 'string' || absPath.length === 0) return { ok: false, error: 'No file path' }
  if (!isAbsolute(absPath)) return { ok: false, error: 'Not an absolute path' }
  // UNC paths are network shares: never touched, not even a stat.
  if (absPath.startsWith('\\\\') || absPath.startsWith('//')) return { ok: false, error: 'Network paths are not supported' }
  const kind = fileViewKindFor(absPath)
  if (kind === null) return { ok: false, error: 'This file type cannot be shown' }
  return { ok: true, kind }
}

/**
 * Reads at most `cap` bytes from the start of the file. A single `read` may return fewer bytes than asked (short
 * read), which would cut text early or corrupt an image, so it loops until the wanted bytes or EOF. The line cut
 * of a truncated text file happens later, on the decoded text, because a byte 0x0a is not a line break in UTF-16.
 */
async function readCapped(target: string, size: number, cap: number): Promise<CappedRead> {
  const wanted = Math.min(size, cap)
  const handle = await open(target, 'r')
  try {
    const buffer = Buffer.alloc(wanted)
    let bytesRead = 0
    while (bytesRead < wanted) {
      const chunk = await handle.read(buffer, bytesRead, wanted - bytesRead, bytesRead)
      if (chunk.bytesRead === 0) break
      bytesRead += chunk.bytesRead
    }
    return { bytes: buffer.subarray(0, bytesRead), truncated: size > cap }
  } finally {
    await handle.close()
  }
}

/** Decodes the capped bytes and, when the cap cut the file, drops its partial last line (one line longer than the cap is kept as is). */
function readText(bytes: Buffer, truncated: boolean): DecodedText {
  const text = decodeTextBytes(bytes, { truncated })
  if (!truncated) return { text, truncated: false }
  const lastBreak = text.lastIndexOf('\n')
  return { text: lastBreak < 0 ? text : text.slice(0, lastBreak + 1), truncated: true }
}

function baseView(
  path: string,
  name: string,
  kind: FileViewKind,
  size: number,
  mtimeMs: number,
  mime: string
): FileView {
  return { path, name, kind, size, content: '', base64: '', mime, sheets: [], truncated: false, mtimeMs }
}

/** Reads one local file for the viewer. Never throws: a refusal is { ok: false, error }. */
export async function readFileView(absPath: string): Promise<FileViewResult> {
  try {
    const checked = checkPath(absPath)
    if (!checked.ok) return fail(checked.error)
    const kind = checked.kind

    let info: Stats
    try {
      info = await stat(absPath)
    } catch {
      return fail('File not found or not readable')
    }
    if (!info.isFile()) return fail('Not a file')
    const size = info.size
    const mtimeMs = info.mtimeMs
    // A cut image or document is useless, so those are refused instead of truncated.
    if (kind === 'image' && size > FILE_VIEW_IMAGE_MAX_BYTES) return fail('Image is too large to show')
    if ((kind === 'sheet' || kind === 'docx') && size > FILE_VIEW_DOC_MAX_BYTES) return fail('File is too large to show')

    const name = basename(absPath)
    const extension = extensionOf(name)

    if (kind === 'image') {
      const { bytes } = await readCapped(absPath, size, FILE_VIEW_IMAGE_MAX_BYTES)
      const view = baseView(absPath, name, kind, size, mtimeMs, IMAGE_MIME[extension] ?? 'application/octet-stream')
      return { ok: true, view: { ...view, base64: bytes.toString('base64') } }
    }

    if (kind === 'markdown' || kind === 'text') {
      const { bytes, truncated } = await readCapped(absPath, size, FILE_VIEW_TEXT_MAX_BYTES)
      const read = readText(bytes, truncated)
      const mime = kind === 'markdown' ? 'text/markdown' : 'text/plain'
      const view = baseView(absPath, name, kind, size, mtimeMs, mime)
      return { ok: true, view: { ...view, content: read.text, truncated: read.truncated } }
    }

    if (kind === 'csv') {
      const { bytes, truncated } = await readCapped(absPath, size, FILE_VIEW_TEXT_MAX_BYTES)
      const read = readText(bytes, truncated)
      const tsv = extension === 'tsv'
      const table = parseCsv(read.text, tsv ? '\t' : ',')
      const sheet: FileViewSheet = { name, rows: table.rows, truncated: table.truncated }
      const view = baseView(absPath, name, kind, size, mtimeMs, tsv ? 'text/tab-separated-values' : 'text/csv')
      return { ok: true, view: { ...view, sheets: [sheet], truncated: read.truncated || table.truncated } }
    }

    if (kind === 'sheet') {
      const { bytes, truncated } = await readCapped(absPath, size, FILE_VIEW_DOC_MAX_BYTES)
      if (truncated) return fail('File is too large to show')
      const read = await readSheets(bytes)
      const view = baseView(absPath, name, kind, size, mtimeMs, XLSX_MIME)
      return { ok: true, view: { ...view, sheets: read.sheets, truncated: read.truncated } }
    }

    const { bytes, truncated } = await readCapped(absPath, size, FILE_VIEW_DOC_MAX_BYTES)
    if (truncated) return fail('File is too large to show')
    const read = await readDocxHtml(bytes)
    const view = baseView(absPath, name, kind, size, mtimeMs, DOCX_MIME)
    return { ok: true, view: { ...view, content: read.html, truncated: read.truncated } }
  } catch (error) {
    return fail(`Could not read the file: ${errorMessage(error)}`)
  }
}

/**
 * D74: mtime + size of a viewed file, for the live reload (polled every ~2 s). Same refusals as `readFileView`
 * (so a file the viewer could not show never looks like it changed) but only a `stat`: no bytes are read.
 */
export async function statFileView(absPath: string): Promise<FileViewStat> {
  try {
    const checked = checkPath(absPath)
    if (!checked.ok) return { ok: false, error: checked.error }
    let info: Stats
    try {
      info = await stat(absPath)
    } catch {
      return { ok: false, error: 'File not found or not readable' }
    }
    if (!info.isFile()) return { ok: false, error: 'Not a file' }
    return { ok: true, mtimeMs: info.mtimeMs, size: info.size }
  } catch (error) {
    return { ok: false, error: `Could not read the file: ${errorMessage(error)}` }
  }
}
