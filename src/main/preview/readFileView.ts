// Main-process reader of ONE local file for the side-panel file viewer (D73). The path is already absolute and
// resolved by the caller (a terminal link); the renderer never touches the disk. Every read is size-capped and
// errors come back as { ok: false }, never as a throw. D74: the view carries the file's mtime so the open preview
// can notice that the file changed on disk, and `statFileView` offers the same look without reading the bytes.
import { checkZip } from './zipGuard'
import { open, stat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { basename, isAbsolute } from 'node:path'
import { fileViewKindFor } from '../../shared/fileViewKind'
import { errorMessage } from '../../shared/guards'
import {
  FILE_VIEW_DOC_MAX_BYTES,
  FILE_VIEW_IMAGE_MAX_BYTES,
  FILE_VIEW_PDF_MAX_BYTES,
  FILE_VIEW_TEXT_MAX_BYTES,
  type FileView,
  type FileViewKind,
  type FileViewResult,
  type FileViewSheet,
  type FileViewStat
} from '../../shared/types'
import { detectDelimiter, parseCsv } from './csv'
import { decodeTextBytes } from './encoding'
import { pdfDeliveryFor } from './pdfDelivery'
import { OfficeLimitError, runOffice } from './officeRunner'

const IMAGE_MIME: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  // D75: the renderer shows every image as <img src="data:<mime>;base64,...">, so an SVG stays inert.
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif'
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const PDF_MIME = 'application/pdf'

/**
 * W4-E: a whole-file base64 string makes main block while serialising it and the renderer block while copying it
 * byte by byte. From 8 MB on, PDFs use the existing range path instead (8 MB is main's per-range cap; the first
 * request is only 64 KB). Local, so the shared IPC contract stays untouched.
 */
const PDF_WHOLE_MAX_BYTES = 8 * 1024 * 1024

/** D75: pdf.js needs the header, and a renamed file must not reach it. Every real PDF starts with `%PDF-` near the start (some writers prepend junk). */
const PDF_MAGIC = '%PDF-'
const PDF_MAGIC_SEARCH_BYTES = 1024

/** D75: an SVG must show its root or its XML prolog in the first 2 KB, after a BOM and whitespace; a renamed file is refused. */
const SVG_SNIFF_BYTES = 2048

interface CappedRead {
  readonly bytes: Buffer
  readonly truncated: boolean
}

interface DecodedText {
  readonly text: string
  readonly truncated: boolean
}

export type PathCheck = { readonly ok: true; readonly kind: FileViewKind } | { readonly ok: false; readonly error: string }

function fail(error: string): FileViewResult {
  return { ok: false, error }
}

/** W4-E: the PDF delivery decision used by both the refusal check and the read below. */
export function pdfViewDelivery(size: number): 'whole' | 'streamed' | 'refused' {
  if (pdfDeliveryFor(size) === 'refused') return 'refused'
  return size <= PDF_WHOLE_MAX_BYTES ? 'whole' : 'streamed'
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/** The shared refusals of both entry points: same rules, same messages, no disk touched. */
export function checkPath(absPath: string): PathCheck {
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

/** D75: true when the header is in the first 1024 bytes (some writers put junk before it). A renamed non-PDF has none. */
function hasPdfMagic(bytes: Buffer): boolean {
  return bytes.subarray(0, PDF_MAGIC_SEARCH_BYTES).includes(PDF_MAGIC)
}

/**
 * D75: a renamed non-SVG must not reach the renderer, so the head of the file has to look like SVG: a BOM and
 * leading whitespace are allowed, then either the XML prolog or the root element must appear in the first 2 KB.
 */
function looksLikeSvg(bytes: Buffer): boolean {
  let head = bytes.subarray(0, SVG_SNIFF_BYTES).toString('utf8')
  if (head.charCodeAt(0) === 0xfeff) head = head.slice(1)
  head = head.trimStart()
  return head.includes('<svg') || head.includes('<?xml')
}

/**
 * The message for a read that threw. A parser's own text can be long and technical ("Can't find end of central directory :
 * is this a zip file ? If it is, see https://..."): the user gets one plain sentence per kind, plus a short detail without links.
 */
export function readErrorMessage(kind: FileViewKind | null, error: unknown): string {
  const detail = errorMessage(error).replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
  const suffix = detail === '' ? '' : ` (${detail})`
  if (kind === 'sheet') return `Could not read this spreadsheet: it is empty, damaged or not a real .xlsx file${suffix}`
  if (kind === 'docx') return `Could not read this Word document: it is damaged or not a real .docx file${suffix}`
  return detail === '' ? 'Could not read the file' : `Could not read the file: ${detail}`
}

/** Reads one local file for the viewer. Never throws: a refusal is { ok: false, error }. */
export async function readFileView(absPath: string): Promise<FileViewResult> {
  let kindForError: FileViewKind | null = null
  try {
    const checked = checkPath(absPath)
    if (!checked.ok) return fail(checked.error)
    const kind = checked.kind
    kindForError = kind

    let info: Stats
    try {
      info = await stat(absPath)
    } catch {
      return fail('File not found or not readable')
    }
    if (!info.isFile()) return fail('Not a file')
    const size = info.size
    const mtimeMs = info.mtimeMs
    // A cut image, document or PDF is useless, so those are refused instead of truncated.
    if (kind === 'image' && size > FILE_VIEW_IMAGE_MAX_BYTES) return fail('Image is too large to show')
    if ((kind === 'sheet' || kind === 'docx') && size > FILE_VIEW_DOC_MAX_BYTES) return fail('File is too large to show')
    // D75: a PDF over the whole-file cap is streamed in ranges; only one beyond the stream cap is refused.
    if (kind === 'pdf' && pdfViewDelivery(size) === 'refused') return fail('PDF is too large to show (over 1 GB)')

    const name = basename(absPath)
    const extension = extensionOf(name)

    if (kind === 'image') {
      const { bytes } = await readCapped(absPath, size, FILE_VIEW_IMAGE_MAX_BYTES)
      if (extension === 'svg' && !looksLikeSvg(bytes)) return fail('Not a valid SVG file')
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
      // D75: a .csv may be written with ; | or tab (Excel exports use the locale's list separator); .tsv is always tab.
      const delimiter = tsv ? '\t' : detectDelimiter(read.text)
      const table = parseCsv(read.text, delimiter)
      const sheet: FileViewSheet = { name, rows: table.rows, truncated: table.truncated }
      const view = baseView(absPath, name, kind, size, mtimeMs, tsv ? 'text/tab-separated-values' : 'text/csv')
      return { ok: true, view: { ...view, sheets: [sheet], truncated: read.truncated || table.truncated } }
    }

    if (kind === 'sheet') {
      const { bytes, truncated } = await readCapped(absPath, size, FILE_VIEW_DOC_MAX_BYTES)
      if (truncated) return fail('File is too large to show')
      // D75: a zip bomb (tiny file, gigabytes inflated) must never reach the parser: it runs in the MAIN process.
      const zip = checkZip(bytes)
      if (!zip.ok) return fail(zip.error)
      // Parsed in a worker thread under a memory and time limit (officeRunner.ts): the parser itself cannot be trusted with a hostile file.
      const read = await runOffice('sheet', bytes)
      const view = baseView(absPath, name, kind, size, mtimeMs, XLSX_MIME)
      return { ok: true, view: { ...view, sheets: read.sheets, truncated: read.truncated } }
    }

    if (kind === 'pdf') {
      if (pdfViewDelivery(size) === 'streamed') {
        // D75: a big PDF is never loaded whole. Only the head is read, to refuse a renamed file before the
        // renderer starts asking pdf.js to fetch byte ranges of it.
        const { bytes } = await readCapped(absPath, size, PDF_MAGIC_SEARCH_BYTES)
        if (!hasPdfMagic(bytes)) return fail('Not a valid PDF file')
        const view = baseView(absPath, name, kind, size, mtimeMs, PDF_MIME)
        return { ok: true, view: { ...view, streamed: true } }
      }
      const { bytes, truncated } = await readCapped(absPath, size, FILE_VIEW_PDF_MAX_BYTES)
      // The file grew between stat and read: refuse rather than hand pdf.js a cut file.
      if (truncated) return fail('PDF is too large to show')
      if (!hasPdfMagic(bytes)) return fail('Not a valid PDF file')
      const view = baseView(absPath, name, kind, size, mtimeMs, PDF_MIME)
      return { ok: true, view: { ...view, base64: bytes.toString('base64') } }
    }

    const { bytes, truncated } = await readCapped(absPath, size, FILE_VIEW_DOC_MAX_BYTES)
    if (truncated) return fail('File is too large to show')
    const zip = checkZip(bytes)
    if (!zip.ok) return fail(zip.error)
    const read = await runOffice('docx', bytes)
    const view = baseView(absPath, name, kind, size, mtimeMs, DOCX_MIME)
    return { ok: true, view: { ...view, content: read.html, truncated: read.truncated } }
  } catch (error) {
    if (error instanceof OfficeLimitError) return fail(error.message)
    return fail(readErrorMessage(kindForError, error))
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
    } catch (error) {
      // Only a file that is really GONE (ENOENT/ENOTDIR) is reported as gone. A lock (EBUSY), a permission blip (EPERM) or a
      // network hiccup is "not readable right now": the live reload must not claim the file no longer exists.
      const code = (error as NodeJS.ErrnoException | null)?.code
      if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: false, error: 'File not found', gone: true }
      return { ok: false, error: 'File is not readable right now' }
    }
    if (!info.isFile()) return { ok: false, error: 'Not a file', gone: true }
    return { ok: true, mtimeMs: info.mtimeMs, size: info.size }
  } catch (error) {
    return { ok: false, error: `Could not read the file: ${errorMessage(error)}` }
  }
}
