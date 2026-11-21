import { describe, expect, it } from 'vitest'
import { PDF_FIRST_CHUNK_BYTES, pdfFirstChunkSize, splitRange, streamedPdfNote } from './pdfRange'

const MB = 1024 * 1024

describe('splitRange', () => {
  it('covers the range exactly, in order, with pieces no bigger than the cap', () => {
    const pieces = splitRange(0, 20 * MB, 8 * MB)
    expect(pieces).toEqual([
      [0, 8 * MB],
      [8 * MB, 16 * MB],
      [16 * MB, 20 * MB]
    ])
  })

  it('keeps a small range in one piece and honours a non-zero start', () => {
    expect(splitRange(100, 200, 8 * MB)).toEqual([[100, 200]])
    expect(splitRange(5, 25, 10)).toEqual([
      [5, 15],
      [15, 25]
    ])
  })

  it('has nothing to read for an empty or reversed range', () => {
    expect(splitRange(10, 10, 4)).toEqual([])
    expect(splitRange(20, 10, 4)).toEqual([])
  })

  it('never loses a byte whatever the sizes (pieces add up to the range)', () => {
    for (const [begin, end, cap] of [[0, 1, 1], [3, 1000, 7], [0, 8 * MB + 1, 8 * MB], [123, 456789, 1000]] as const) {
      const pieces = splitRange(begin, end, cap)
      expect(pieces.reduce((sum, [a, b]) => sum + (b - a), 0)).toBe(end - begin)
      expect(pieces[0]?.[0]).toBe(begin)
      expect(pieces[pieces.length - 1]?.[1]).toBe(end)
      for (const [a, b] of pieces) expect(b - a).toBeLessThanOrEqual(cap)
    }
  })

  it('falls back to one piece when the cap is broken, and ignores non-finite bounds', () => {
    expect(splitRange(0, 100, 0)).toEqual([[0, 100]])
    expect(splitRange(0, 100, Number.NaN)).toEqual([[0, 100]])
    expect(splitRange(Number.NaN, 50, 25)).toEqual([
      [0, 25],
      [25, 50]
    ])
    expect(splitRange(0, Number.POSITIVE_INFINITY, 10)).toEqual([])
  })
})

describe('pdfFirstChunkSize', () => {
  it('asks for the header chunk, but never more than the file', () => {
    expect(pdfFirstChunkSize(500 * MB)).toBe(PDF_FIRST_CHUNK_BYTES)
    expect(pdfFirstChunkSize(1000)).toBe(1000)
    expect(pdfFirstChunkSize(0)).toBe(0)
    expect(pdfFirstChunkSize(Number.NaN)).toBe(0)
    expect(pdfFirstChunkSize(-5)).toBe(0)
  })
})

describe('streamedPdfNote', () => {
  it('names the whole size and says pages arrive on demand', () => {
    const note = streamedPdfNote(120 * MB)
    expect(note).toContain('120')
    expect(note).toContain('MB')
    expect(note.toLowerCase()).toContain('scroll')
  })
})
