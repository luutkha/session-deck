import { describe, expect, it } from 'vitest'
import { decodeTextBytes } from './encoding'

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])
const UTF16LE_BOM = Buffer.from([0xff, 0xfe])
const UTF16BE_BOM = Buffer.from([0xfe, 0xff])

function utf16le(text: string): Buffer {
  return Buffer.from(text, 'utf16le')
}

/** Big-endian UTF-16 (what a BOM FE FF file holds) built from the LE writer. */
function utf16be(text: string): Buffer {
  return Buffer.from(text, 'utf16le').swap16()
}

describe('decodeTextBytes BOM', () => {
  it('strips a UTF-8 BOM', () => {
    const bytes = Buffer.concat([UTF8_BOM, Buffer.from('héllo\n', 'utf8')])
    expect(decodeTextBytes(bytes)).toBe('héllo\n')
  })

  it('decodes UTF-16 LE with a BOM', () => {
    const bytes = Buffer.concat([UTF16LE_BOM, utf16le('one\r\ntwo\r\n')])
    expect(decodeTextBytes(bytes)).toBe('one\r\ntwo\r\n')
  })

  it('decodes UTF-16 BE with a BOM', () => {
    const bytes = Buffer.concat([UTF16BE_BOM, utf16be('one\r\ntwo\r\n')])
    expect(decodeTextBytes(bytes)).toBe('one\r\ntwo\r\n')
  })

  it('decodes an empty file with a BOM as empty text', () => {
    expect(decodeTextBytes(UTF16LE_BOM)).toBe('')
    expect(decodeTextBytes(Buffer.alloc(0))).toBe('')
  })
})

describe('decodeTextBytes without a BOM', () => {
  it('detects UTF-16 LE from NULs on odd offsets (PowerShell `>`)', () => {
    expect(decodeTextBytes(utf16le('alpha\r\nbeta\r\n'))).toBe('alpha\r\nbeta\r\n')
  })

  it('detects UTF-16 BE from NULs on even offsets', () => {
    expect(decodeTextBytes(utf16be('alpha\r\nbeta\r\n'))).toBe('alpha\r\nbeta\r\n')
  })

  it('reads valid UTF-8 with accents as UTF-8, not as a legacy code page', () => {
    const bytes = Buffer.from('café crème\n', 'utf8')
    expect(decodeTextBytes(bytes)).toBe('café crème\n')
  })

  it('falls back to windows-1252 for bytes that are not valid UTF-8', () => {
    // 0xE9 is "é" in windows-1252 and an invalid single byte in UTF-8.
    expect(decodeTextBytes(Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toBe('café')
  })
})

describe('decodeTextBytes truncated input', () => {
  it('drops a multi-byte UTF-8 character cut by the cap', () => {
    const full = Buffer.from('abcé\n', 'utf8')
    expect(decodeTextBytes(full, { truncated: true })).toBe('abcé\n')
    // The cap landed after the lead byte of "é" (c3 a9).
    expect(decodeTextBytes(full.subarray(0, full.length - 2), { truncated: true })).toBe('abc')
  })

  it('drops a four-byte character cut by the cap', () => {
    const full = Buffer.from('a😀', 'utf8')
    expect(decodeTextBytes(full.subarray(0, full.length - 1), { truncated: true })).toBe('a')
    expect(decodeTextBytes(full.subarray(0, full.length - 2), { truncated: true })).toBe('a')
  })

  it('keeps a complete character that ends exactly at the cap', () => {
    const full = Buffer.from('abcé', 'utf8')
    expect(decodeTextBytes(full, { truncated: true })).toBe('abcé')
  })

  it('makes a cut UTF-16 input an even number of bytes', () => {
    const full = utf16le('abc')
    expect(decodeTextBytes(full, { truncated: true })).toBe('abc')
    expect(decodeTextBytes(full.subarray(0, full.length - 1), { truncated: true })).toBe('ab')
  })

  it('does the same behind a UTF-16 BOM', () => {
    const full = Buffer.concat([UTF16LE_BOM, utf16le('abc')])
    expect(decodeTextBytes(full.subarray(0, full.length - 1), { truncated: true })).toBe('ab')
  })

  it('leaves an untruncated odd UTF-16 file to the decoder instead of cutting it', () => {
    // Not a real truncation: no cap was hit, Node's utf16le drops the lone last byte itself.
    expect(decodeTextBytes(utf16le('abc').subarray(0, 5))).toBe('ab')
  })
})
