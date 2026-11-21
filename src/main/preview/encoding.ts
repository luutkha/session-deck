// Text decoding for the side-panel file viewer (D74). A viewed file is not always UTF-8: editors and shells on
// Windows write UTF-16 (PowerShell `>` writes UTF-16 LE with a BOM) and older tools write the local ANSI code
// page, so a plain `toString('utf8')` showed replacement characters or stray NULs.
//
// Order of decisions: a BOM wins; without one, a run of NUL bytes on one side of each pair means UTF-16 (that is
// what PowerShell and `Out-File` produce); otherwise strict UTF-8, and when the bytes are not valid UTF-8 the
// Windows code page (windows-1252) is the last resort. Pure: no IO, and never throws.

/** Bytes inspected for the UTF-16 heuristic; a long text is recognisable at its head. */
const SNIFF_MAX_BYTES = 4096
/** Share of NUL bytes that makes a text file UTF-16 rather than UTF-8 (UTF-8 text has none, UTF-16 has one per char). */
const NUL_SHARE = 0.3

type Utf16Order = 'le' | 'be'

interface Bom {
  readonly length: number
  /** null = a UTF-8 BOM. */
  readonly utf16: Utf16Order | null
}

function bomOf(bytes: Buffer): Bom | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { length: 3, utf16: null }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return { length: 2, utf16: 'le' }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { length: 2, utf16: 'be' }
  return null
}

/**
 * UTF-16 without a BOM: more than ~30% NUL bytes, and they sit on (mostly) odd offsets for LE (the ASCII/low byte
 * comes first) or even offsets for BE.
 */
function sniffUtf16(bytes: Buffer): Utf16Order | null {
  const window = bytes.subarray(0, SNIFF_MAX_BYTES)
  let nuls = 0
  let oddNuls = 0
  for (let index = 0; index < window.length; index += 1) {
    if (window[index] !== 0) continue
    nuls += 1
    if (index % 2 === 1) oddNuls += 1
  }
  if (nuls === 0 || nuls <= window.length * NUL_SHARE) return null
  return oddNuls * 2 >= nuls ? 'le' : 'be'
}

/** How many bytes a UTF-8 lead byte starts; an invalid lead counts as one so it is never cut by mistake. */
function utf8SequenceLength(lead: number): number {
  if (lead < 0x80) return 1
  if (lead >= 0xc0 && lead <= 0xdf) return 2
  if (lead >= 0xe0 && lead <= 0xef) return 3
  if (lead >= 0xf0 && lead <= 0xf7) return 4
  return 1
}

/**
 * The size cap can cut a multi-byte character in half, which strict UTF-8 would reject. Drop up to 3 trailing
 * bytes of an incomplete sequence; a complete one at the end is kept.
 */
function repairUtf8Tail(bytes: Buffer): Buffer {
  const limit = Math.min(bytes.length, 4)
  for (let back = 1; back <= limit; back += 1) {
    const index = bytes.length - back
    const byte = bytes[index]
    if ((byte & 0xc0) === 0x80) continue // continuation byte: the lead is earlier
    const needed = utf8SequenceLength(byte)
    return needed > 1 && back < needed ? bytes.subarray(0, index) : bytes
  }
  return bytes
}

/** UTF-16 reads whole code units; a cut file may end on a single byte. */
function evenLength(bytes: Buffer): Buffer {
  return bytes.length % 2 === 0 ? bytes : bytes.subarray(0, bytes.length - 1)
}

function decodeUtf16(bytes: Buffer, order: Utf16Order): string {
  if (order === 'le') return bytes.toString('utf16le')
  // No `utf-16be` decoder is guaranteed in every runtime; swapping into LE is exact and cheap.
  return Buffer.from(bytes).swap16().toString('utf16le')
}

/** windows-1252 (the Windows ANSI code page) for bytes that are not UTF-8; latin1 only when the runtime lacks it. */
function decodeLegacy(bytes: Buffer): string {
  try {
    return new TextDecoder('windows-1252').decode(bytes)
  } catch {
    try {
      return new TextDecoder('latin1').decode(bytes)
    } catch {
      return bytes.toString('latin1')
    }
  }
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return decodeLegacy(bytes)
  }
}

/**
 * Decodes the bytes of a viewed text/csv file to a string. `truncated` says the size cap cut the bytes, so a
 * trailing half character is dropped instead of becoming a replacement character.
 */
/** A UTF-16 text cut between the two halves of a surrogate pair would end on a lone high surrogate (shown as a broken glyph). */
function dropLoneTrailingSurrogate(text: string): string {
  if (text.length === 0) return text
  const last = text.charCodeAt(text.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text
}

export function decodeTextBytes(bytes: Buffer, opts?: { truncated?: boolean }): string {
  const truncated = opts?.truncated === true
  const bom = bomOf(bytes)
  if (bom !== null) {
    const body = bytes.subarray(bom.length)
    if (bom.utf16 !== null) {
      const text = decodeUtf16(truncated ? evenLength(body) : body, bom.utf16)
      return truncated ? dropLoneTrailingSurrogate(text) : text
    }
    return decodeUtf8(truncated ? repairUtf8Tail(body) : body)
  }
  const utf16 = sniffUtf16(bytes)
  if (utf16 !== null) {
    const text = decodeUtf16(truncated ? evenLength(bytes) : bytes, utf16)
    return truncated ? dropLoneTrailingSurrogate(text) : text
  }
  return decodeUtf8(truncated ? repairUtf8Tail(bytes) : bytes)
}
