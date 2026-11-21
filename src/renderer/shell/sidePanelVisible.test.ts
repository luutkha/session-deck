import { describe, expect, it } from 'vitest'
import {
  SIDE_PANEL_KEEP_FOR_MAIN,
  SIDE_PANEL_WIDTH_MIN,
  maxSidePanelWidth,
  visibleSidePanelWidth
} from './sidePanelWidth'

describe('maxSidePanelWidth', () => {
  it('is the window minus the sidebar minus the terminal room', () => {
    expect(maxSidePanelWidth(1600, 300)).toBe(1600 - 300 - SIDE_PANEL_KEEP_FOR_MAIN)
  })

  it('never goes below the panel minimum, even in a tiny window', () => {
    expect(maxSidePanelWidth(600, 300)).toBe(SIDE_PANEL_WIDTH_MIN)
    expect(maxSidePanelWidth(0, 0)).toBe(SIDE_PANEL_WIDTH_MIN)
  })

  it('a closed sidebar frees its space, a broken number does not throw', () => {
    expect(maxSidePanelWidth(1000, 0)).toBe(1000 - SIDE_PANEL_KEEP_FOR_MAIN)
    expect(maxSidePanelWidth(Number.NaN, 300)).toBeGreaterThanOrEqual(SIDE_PANEL_WIDTH_MIN)
  })
})

describe('visibleSidePanelWidth', () => {
  it('draws the stored width when it fits', () => {
    expect(visibleSidePanelWidth(520, 900)).toBe(520)
  })

  it('draws the LIMIT when the stored width is wider (the case that made drags do nothing)', () => {
    expect(visibleSidePanelWidth(1000, 480)).toBe(480)
  })

  it('a drag or key step starts from what is on screen, not from the stored number', () => {
    const shown = visibleSidePanelWidth(1000, 480)
    expect(shown + 16).toBeGreaterThan(shown) // a step changes the visible width at once
    expect(visibleSidePanelWidth(shown + 16, 480)).toBe(480) // and stays held by the limit
  })

  it('keeps the minimum, and clamps a broken stored value', () => {
    expect(visibleSidePanelWidth(100, 900)).toBe(SIDE_PANEL_WIDTH_MIN)
    expect(visibleSidePanelWidth(Number.NaN, 900)).toBeGreaterThanOrEqual(SIDE_PANEL_WIDTH_MIN)
    expect(visibleSidePanelWidth(500, 100)).toBe(SIDE_PANEL_WIDTH_MIN)
  })
})
