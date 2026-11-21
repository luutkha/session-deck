// Decompression-bomb guard for the zip-based formats the viewer parses in the MAIN process (xlsx/xlsm, docx/docm/dotx).
// A 48 KB zip can inflate to gigabytes: JSZip/mammoth/read-excel-file would allocate all of it, run the main process out
// of memory (the whole app dies) or stall it for seconds (every session's terminal output goes through main).
// This reads only the zip's own table of contents (the central directory: a few bytes per entry), never inflates
// anything, and says no BEFORE a parser sees the file.

/** The viewer shows at most the first rows of a sheet, so a workbook that expands past this is not previewed. */
export const ZIP_MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
/** A real office document has tens to a few hundred parts. */
export const ZIP_MAX_ENTRIES = 5000

export type ZipCheck =
  | { readonly ok: true; readonly entries: number; readonly uncompressedBytes: number }
  | { readonly ok: false; readonly error: string }

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const EOCD_MIN_LENGTH = 22
const CENTRAL_HEADER_LENGTH = 46
/** The end-of-central-directory record is within its 22 bytes plus a comment of at most 65535 bytes of the end. */
const EOCD_SEARCH_BYTES = EOCD_MIN_LENGTH + 0xffff
const SIZE_NEEDS_ZIP64 = 0xffffffff
const ENTRIES_NEED_ZIP64 = 0xffff

function megabytes(bytes: number): string {
  return `${String(Math.round(bytes / (1024 * 1024)))} MB`
}

function findEndRecord(bytes: Buffer): number {
  const lowest = Math.max(0, bytes.length - EOCD_SEARCH_BYTES)
  for (let at = bytes.length - EOCD_MIN_LENGTH; at >= lowest; at -= 1) {
    if (bytes.readUInt32LE(at) === EOCD_SIGNATURE) return at
  }
  return -1
}

/** Reads the central directory of an in-memory zip and refuses one that would inflate too far or has too many parts. */
export function checkZip(bytes: Buffer): ZipCheck {
  if (bytes.length < EOCD_MIN_LENGTH) return { ok: false, error: 'Not a valid zip-based file' }
  const end = findEndRecord(bytes)
  if (end < 0) return { ok: false, error: 'Not a valid zip-based file (no zip directory found)' }
  const entryCount = bytes.readUInt16LE(end + 10)
  const directorySize = bytes.readUInt32LE(end + 12)
  const directoryOffset = bytes.readUInt32LE(end + 16)
  // zip64 archives (more than 65535 entries or 4 GB) are far outside what a preview handles.
  if (entryCount === ENTRIES_NEED_ZIP64 || directorySize === SIZE_NEEDS_ZIP64 || directoryOffset === SIZE_NEEDS_ZIP64) {
    return { ok: false, error: 'This file is too large or complex to preview here. Open it in the default app.' }
  }
  if (entryCount > ZIP_MAX_ENTRIES) {
    return { ok: false, error: `This file has ${String(entryCount)} parts (limit ${String(ZIP_MAX_ENTRIES)}) and is not previewed here. Open it in the default app.` }
  }
  if (directoryOffset + directorySize > bytes.length) return { ok: false, error: 'Not a valid zip-based file (damaged zip directory)' }

  let at = directoryOffset
  let total = 0
  for (let index = 0; index < entryCount; index += 1) {
    if (at + CENTRAL_HEADER_LENGTH > bytes.length || bytes.readUInt32LE(at) !== CENTRAL_SIGNATURE) {
      return { ok: false, error: 'Not a valid zip-based file (damaged zip directory)' }
    }
    const uncompressed = bytes.readUInt32LE(at + 24)
    if (uncompressed === SIZE_NEEDS_ZIP64) {
      return { ok: false, error: 'This file is too large or complex to preview here. Open it in the default app.' }
    }
    total += uncompressed
    if (total > ZIP_MAX_UNCOMPRESSED_BYTES) {
      return {
        ok: false,
        error: `This file expands to more than ${megabytes(ZIP_MAX_UNCOMPRESSED_BYTES)} (a very large document, or a decompression bomb) and is not previewed here. Open it in the default app.`
      }
    }
    const nameLength = bytes.readUInt16LE(at + 28)
    const extraLength = bytes.readUInt16LE(at + 30)
    const commentLength = bytes.readUInt16LE(at + 32)
    at += CENTRAL_HEADER_LENGTH + nameLength + extraLength + commentLength
  }
  return { ok: true, entries: entryCount, uncompressedBytes: total }
}
