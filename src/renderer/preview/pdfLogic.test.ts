import { describe, expect, it } from 'vitest'
import {
  PDF_MAX_CANVAS_PIXELS,
  PDF_PAGE_GAP,
  PDF_VIEW_PADDING,
  clampPdfZoom,
  fitPdfScale,
  isPasswordError,
  isRenderCancelled,
  pdfCanvasSize,
  pdfCurrentPage,
  pdfPageBoxes,
  pdfPageLabel,
  pdfPercentLabel,
  pdfVisibleRange,
  stepPdfZoom
} from './pdfLogic'

describe('clampPdfZoom', () => {
  it('keeps the PDF zoom on the 50..300 ladder range', () => {
    expect(clampPdfZoom(0)).toBe(50)
    expect(clampPdfZoom(50)).toBe(50)
    expect(clampPdfZoom(124.6)).toBe(125)
    expect(clampPdfZoom(5000)).toBe(300)
    expect(clampPdfZoom(Number.NaN)).toBe(100)
  })
})

describe('stepPdfZoom', () => {
  it('walks the 50..300 ladder', () => {
    expect(stepPdfZoom(100, 1)).toBe(125)
    expect(stepPdfZoom(100, -1)).toBe(75)
    expect(stepPdfZoom(300, 1)).toBe(300)
    expect(stepPdfZoom(50, -1)).toBe(50)
  })

  it('turns an off-ladder fit percentage into the next step', () => {
    expect(stepPdfZoom(63, 1)).toBe(75)
    expect(stepPdfZoom(63, -1)).toBe(50)
  })
})

describe('fitPdfScale', () => {
  it('fits the page into the container minus the padding', () => {
    expect(fitPdfScale(832, 800, 32)).toBe(1)
    expect(fitPdfScale(432, 800, 32)).toBe(0.5)
    expect(fitPdfScale(832, 400, 32)).toBe(2)
  })

  it('falls back to 1 when there is no usable size yet', () => {
    expect(fitPdfScale(0, 800)).toBe(1)
    expect(fitPdfScale(20, 800, 32)).toBe(1)
    expect(fitPdfScale(500, 0)).toBe(1)
    expect(fitPdfScale(Number.NaN, 800)).toBe(1)
  })

  it('never returns a zero or absurd scale', () => {
    expect(fitPdfScale(24, 800, 32)).toBe(1)
    expect(fitPdfScale(33, 800, 32)).toBe(0.05)
    expect(fitPdfScale(100000, 10, 32)).toBe(4)
  })
})

describe('pdfPageBoxes / pdfCurrentPage', () => {
  const pages = [
    { width: 100, height: 200 },
    { width: 100, height: 100 }
  ]

  it('stacks pages after the top padding with the gap between them', () => {
    const boxes = pdfPageBoxes(pages, 1)
    expect(boxes.map((box) => box.top)).toEqual([PDF_VIEW_PADDING, PDF_VIEW_PADDING + 200 + PDF_PAGE_GAP])
    expect(boxes.map((box) => box.height)).toEqual([200, 100])
  })

  it('scales sizes with the zoom', () => {
    const boxes = pdfPageBoxes(pages, 0.5)
    expect(boxes[0]?.width).toBe(50)
    expect(boxes[0]?.height).toBe(100)
    expect(boxes[1]?.top).toBe(PDF_VIEW_PADDING + 100 + PDF_PAGE_GAP)
  })

  it('has no boxes for an empty document or a broken scale', () => {
    expect(pdfPageBoxes([], 1)).toEqual([])
    expect(pdfPageBoxes(pages, Number.NaN)[0]?.height).toBe(200)
  })

  it('reports the page at the top edge, and the page above a gap', () => {
    const boxes = pdfPageBoxes(pages, 1)
    expect(pdfCurrentPage(boxes, 0)).toBe(0)
    expect(pdfCurrentPage(boxes, PDF_VIEW_PADDING + 199)).toBe(0)
    expect(pdfCurrentPage(boxes, PDF_VIEW_PADDING + 200 + PDF_PAGE_GAP)).toBe(1)
    expect(pdfCurrentPage(boxes, 100000)).toBe(1)
    expect(pdfCurrentPage([], 50)).toBe(0)
  })
})

describe('pdfVisibleRange', () => {
  const boxes = pdfPageBoxes(
    [
      { width: 100, height: 100 },
      { width: 100, height: 100 },
      { width: 100, height: 100 }
    ],
    1
  )

  it('includes the pages one viewport above and below', () => {
    expect(pdfVisibleRange(boxes, 0, 100, 0)).toEqual({ start: 0, end: 0 })
    expect(pdfVisibleRange(boxes, 0, 100)).toEqual({ start: 0, end: 1 })
  })

  it('moves the window with the scroll offset', () => {
    expect(pdfVisibleRange(boxes, 150, 100, 0)).toEqual({ start: 1, end: 2 })
  })

  it('is empty when there are no pages', () => {
    expect(pdfVisibleRange([], 0, 500)).toEqual({ start: 0, end: -1 })
  })
})

describe('pdfCanvasSize', () => {
  it('uses the device pixel ratio for sharpness', () => {
    expect(pdfCanvasSize(100, 200, 1, 2)).toEqual({ width: 200, height: 400 })
    expect(pdfCanvasSize(100, 200, 0.5, 1)).toEqual({ width: 50, height: 100 })
  })

  it('caps the canvas at the pixel budget', () => {
    const size = pdfCanvasSize(4000, 4000, 1, 2)
    expect(size.width * size.height).toBeLessThanOrEqual(PDF_MAX_CANVAS_PIXELS)
    expect(size.width).toBeGreaterThan(0)
    expect(size.height).toBeGreaterThan(0)
  })

  it('never produces a zero canvas', () => {
    expect(pdfCanvasSize(0, 0, 1, 1)).toEqual({ width: 1, height: 1 })
    expect(pdfCanvasSize(10, 10, Number.NaN, 1)).toEqual({ width: 10, height: 10 })
  })
})

describe('labels', () => {
  it('formats the zoom percentage', () => {
    expect(pdfPercentLabel(1)).toBe('100%')
    expect(pdfPercentLabel(0.634)).toBe('63%')
    expect(pdfPercentLabel(Number.NaN)).toBe('100%')
  })

  it('formats the current page out of the total', () => {
    expect(pdfPageLabel(0, 12)).toBe('Page 1 / 12')
    expect(pdfPageLabel(2, 12)).toBe('Page 3 / 12')
    expect(pdfPageLabel(99, 12)).toBe('Page 12 / 12')
    expect(pdfPageLabel(-1, 12)).toBe('Page 1 / 12')
    expect(pdfPageLabel(0, 0)).toBe('No pages')
  })
})

describe('error classification', () => {
  it('recognises a password-protected document', () => {
    expect(isPasswordError({ name: 'PasswordException' })).toBe(true)
    expect(isPasswordError(new Error('nope'))).toBe(false)
    expect(isPasswordError(null)).toBe(false)
    expect(isPasswordError('PasswordException')).toBe(false)
  })

  it('recognises a cancelled render', () => {
    expect(isRenderCancelled({ name: 'RenderingCancelledException' })).toBe(true)
    expect(isRenderCancelled({ name: 'InvalidPDFException' })).toBe(false)
  })
})
