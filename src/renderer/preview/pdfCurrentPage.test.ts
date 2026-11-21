import { describe, expect, it } from 'vitest'
import { pdfCurrentPage, type PdfPageBox } from './pdfLogic'

/** Twelve pages 200 px high with a 10 px gap: tops 0, 210, 420 ... content height 12 * 210 - 10. */
const boxes: PdfPageBox[] = Array.from({ length: 12 }, (_, i) => ({ index: i + 1, top: i * 210, width: 300, height: 200 }))
const CONTENT = 12 * 210 - 10

describe('pdfCurrentPage', () => {
  it('is the page at the top edge of the viewport', () => {
    expect(pdfCurrentPage(boxes, 0)).toBe(1)
    expect(pdfCurrentPage(boxes, 215)).toBe(2)
    expect(pdfCurrentPage(boxes, 1000)).toBe(5)
  })

  it('without viewport sizes it behaves exactly as before', () => {
    expect(pdfCurrentPage(boxes, CONTENT - 300)).toBe(pdfCurrentPage(boxes, CONTENT - 300, undefined, undefined))
  })

  it('counts the LAST page once scrolled all the way down, even with two pages on screen', () => {
    const viewport = 500
    const bottom = CONTENT - viewport
    expect(pdfCurrentPage(boxes, bottom)).toBe(10) // the top-edge rule alone never reaches 12
    expect(pdfCurrentPage(boxes, bottom, viewport, CONTENT)).toBe(12)
  })

  it('does not jump to the last page before the end, or for a document that fits the viewport', () => {
    expect(pdfCurrentPage(boxes, CONTENT - 500 - 40, 500, CONTENT)).toBe(10)
    const short = boxes.slice(0, 2)
    expect(pdfCurrentPage(short, 0, 800, 410)).toBe(1)
  })

  it('has no page for an empty document and ignores broken numbers', () => {
    expect(pdfCurrentPage([], 0, 500, 500)).toBe(0)
    expect(pdfCurrentPage(boxes, Number.NaN, 500, CONTENT)).toBe(1)
    expect(pdfCurrentPage(boxes, 100, Number.NaN, CONTENT)).toBe(1)
  })
})
