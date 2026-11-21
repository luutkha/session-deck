import { describe, expect, it } from 'vitest'
import { stepPdfZoom } from './pdfLogic'

describe('stepPdfZoom', () => {
  it('walks the ladder from an on-ladder value', () => {
    expect(stepPdfZoom(100, 1)).toBe(125)
    expect(stepPdfZoom(100, -1)).toBe(75)
    expect(stepPdfZoom(50, 1)).toBe(75)
    expect(stepPdfZoom(300, -1)).toBe(200)
  })

  it('moves an off-ladder Fit value to the next step past it, in the direction asked', () => {
    expect(stepPdfZoom(110, 1)).toBe(125)
    expect(stepPdfZoom(110, -1)).toBe(100)
    expect(stepPdfZoom(48, 1)).toBe(50)
  })

  it('Zoom OUT from a Fit below the smallest step never zooms in', () => {
    expect(stepPdfZoom(48, -1)).toBe(48)
    expect(stepPdfZoom(12, -1)).toBe(12)
  })

  it('Zoom IN from a Fit above the largest step never zooms out', () => {
    expect(stepPdfZoom(400, 1)).toBe(400)
    expect(stepPdfZoom(310, 1)).toBe(310)
  })

  it('still zooms the other way from those same values', () => {
    expect(stepPdfZoom(400, -1)).toBe(300)
    expect(stepPdfZoom(48, 1)).toBe(50)
  })

  it('the ends of the ladder stay put', () => {
    expect(stepPdfZoom(50, -1)).toBe(50)
    expect(stepPdfZoom(300, 1)).toBe(300)
  })

  it('a broken value falls back to 100 first', () => {
    expect(stepPdfZoom(Number.NaN, 1)).toBe(125)
  })
})
