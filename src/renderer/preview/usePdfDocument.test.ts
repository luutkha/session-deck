// W4-E: pure rules behind lazy PDF page measurement. No React render and no pdf.js here.
import { describe, expect, it } from 'vitest'
import { PDF_VIEW_PADDING } from './pdfLogic'
import { pdfAnchorScrollDelta, pdfEstimatedPages } from './usePdfDocument'

describe('pdfEstimatedPages', () => {
  it('uses page 1 for every placeholder without calling getPage for them', () => {
    const first = { width: 612, height: 792 }
    const pages = pdfEstimatedPages(first, 5000)
    expect(pages).toHaveLength(5000)
    expect(pages[0]).toEqual(first)
    for (const page of pages) expect(page).toEqual(first)
  })

  it('returns nothing for an empty or broken page count and sanitises a broken size', () => {
    expect(pdfEstimatedPages({ width: 10, height: 20 }, 0)).toEqual([])
    expect(pdfEstimatedPages({ width: 10, height: 20 }, Number.NaN)).toEqual([])
    expect(pdfEstimatedPages({ width: 0, height: -5 }, 2)).toEqual([
      { width: 1, height: 1 },
      { width: 1, height: 1 }
    ])
  })
})

describe('pdfAnchorScrollDelta', () => {
  const estimated = [
    { width: 100, height: 200 },
    { width: 100, height: 200 },
    { width: 100, height: 200 }
  ]

  it('keeps the reader in place when a page above the viewport grew', () => {
    // At scale 1 page 0 ends at 16+200=216 and page 1 at 428; a scrollTop of 500 is past both.
    const measured = [estimated[0], { width: 100, height: 260 }, estimated[2]]
    expect(pdfAnchorScrollDelta(estimated, measured as typeof estimated, 500, 1)).toBe(60)
  })

  it('scales the delta with the zoom', () => {
    const measured = [{ width: 100, height: 240 }, estimated[1], estimated[2]]
    expect(pdfAnchorScrollDelta(estimated, measured as typeof estimated, 400, 1.5)).toBe(60)
  })

  it('does not shift the viewport for a page below it or at the top', () => {
    const measured = [estimated[0], estimated[1], { width: 100, height: 400 }]
    expect(pdfAnchorScrollDelta(estimated, measured as typeof estimated, 500, 1)).toBe(0)
    expect(pdfAnchorScrollDelta(estimated, measured as typeof estimated, 0, 1)).toBe(0)
  })

  it('uses the layout padding when deciding which pages are above the viewport', () => {
    const bottomOfFirst = PDF_VIEW_PADDING + 200
    const measured = [{ width: 100, height: 220 }, estimated[1], estimated[2]]
    // A page whose bottom is still below the viewport top is not anchored.
    expect(pdfAnchorScrollDelta(estimated, measured as typeof estimated, bottomOfFirst - 1, 1)).toBe(0)
    expect(pdfAnchorScrollDelta(estimated, measured as typeof estimated, bottomOfFirst, 1)).toBe(20)
  })

  it('ignores a different document or a mismatched page count', () => {
    expect(pdfAnchorScrollDelta(estimated, estimated.slice(0, 2), 500, 1)).toBe(0)
    expect(pdfAnchorScrollDelta(estimated, estimated, Number.NaN, 1)).toBe(0)
  })
})
