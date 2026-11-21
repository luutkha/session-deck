import { describe, expect, it } from 'vitest'
import { decodeTextBytes } from './encoding'
import { cellToText } from './sheets'

describe('UTF-16 text cut by the size cap', () => {
  it('never ends on half of a surrogate pair (an emoji cut in two)', () => {
    // "aa" + U+1F600 as UTF-16LE is 61 00 61 00 3D D8 00 DE; cut after the high surrogate (6 bytes)
    const whole = Buffer.from('aa\u{1F600}', 'utf16le')
    const bom = Buffer.from([0xff, 0xfe])
    const cut = Buffer.concat([bom, whole.subarray(0, 6)])
    const text = decodeTextBytes(cut, { truncated: true })
    expect(text).toBe('aa')
    const last = text.charCodeAt(text.length - 1)
    expect(last >= 0xd800 && last <= 0xdfff).toBe(false)
  })

  it('keeps a complete emoji, and a cut that is not on a surrogate is untouched', () => {
    const bom = Buffer.from([0xff, 0xfe])
    expect(decodeTextBytes(Buffer.concat([bom, Buffer.from('aa\u{1F600}', 'utf16le')]), { truncated: true })).toBe('aa\u{1F600}')
    expect(decodeTextBytes(Buffer.concat([bom, Buffer.from('abc', 'utf16le')]), { truncated: true })).toBe('abc')
  })

  it('an untruncated file is never trimmed', () => {
    const bom = Buffer.from([0xff, 0xfe])
    expect(decodeTextBytes(Buffer.concat([bom, Buffer.from('hi', 'utf16le')]))).toBe('hi')
  })
})

describe('cellToText for time-only Excel cells', () => {
  it("shows the time, not Excel's day-zero date", () => {
    expect(cellToText(new Date(Date.UTC(1899, 11, 30, 12, 0, 0)))).toBe('12:00:00')
    expect(cellToText(new Date(Date.UTC(1899, 11, 30, 6, 30, 15)))).toBe('06:30:15')
  })

  it('real dates and date-times are unchanged', () => {
    expect(cellToText(new Date(Date.UTC(2024, 2, 15)))).toBe('2024-03-15')
    expect(cellToText(new Date(Date.UTC(2024, 2, 15, 9, 5, 0)))).toBe('2024-03-15 09:05:00')
  })
})
