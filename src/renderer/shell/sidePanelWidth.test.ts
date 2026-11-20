import { describe, expect, it } from 'vitest'
import {
  clampSidePanelWidth,
  parseSidePanelWidth,
  SIDE_PANEL_WIDTH_DEFAULT,
  SIDE_PANEL_WIDTH_KEY_STEP,
  SIDE_PANEL_WIDTH_KEY_STEP_BIG,
  SIDE_PANEL_WIDTH_MAX,
  SIDE_PANEL_WIDTH_MIN,
  SIDE_PANEL_WIDTH_PREVIEW,
  sidePanelWidthForDrag,
  sidePanelWidthForKey
} from './sidePanelWidth'

describe('clampSidePanelWidth', () => {
  it('keeps a width inside the limits and rounds it', () => {
    expect(clampSidePanelWidth(320)).toBe(320)
    expect(clampSidePanelWidth(320.6)).toBe(321)
    expect(clampSidePanelWidth(10)).toBe(SIDE_PANEL_WIDTH_MIN)
    expect(clampSidePanelWidth(5000)).toBe(SIDE_PANEL_WIDTH_MAX)
  })

  it('turns anything that is not a number into the default', () => {
    expect(clampSidePanelWidth(Number.NaN)).toBe(SIDE_PANEL_WIDTH_DEFAULT)
    expect(clampSidePanelWidth(Number.POSITIVE_INFINITY)).toBe(SIDE_PANEL_WIDTH_DEFAULT)
  })
})

describe('parseSidePanelWidth', () => {
  it('reads a stored number and clamps an out-of-range one', () => {
    expect(parseSidePanelWidth('360')).toBe(360)
    expect(parseSidePanelWidth('50')).toBe(SIDE_PANEL_WIDTH_MIN)
    expect(parseSidePanelWidth('99999')).toBe(SIDE_PANEL_WIDTH_MAX)
  })

  it('falls back to the default for missing or broken values', () => {
    for (const raw of [null, '', '  ', 'wide', 'NaN', '12px', '{}']) {
      expect(parseSidePanelWidth(raw)).toBe(SIDE_PANEL_WIDTH_DEFAULT)
    }
  })

  it('the default and the preview width sit inside the limits', () => {
    for (const width of [SIDE_PANEL_WIDTH_DEFAULT, SIDE_PANEL_WIDTH_PREVIEW]) {
      expect(width).toBeGreaterThanOrEqual(SIDE_PANEL_WIDTH_MIN)
      expect(width).toBeLessThanOrEqual(SIDE_PANEL_WIDTH_MAX)
    }
  })
})

describe('sidePanelWidthForKey', () => {
  it('arrows move by one step, Shift by a bigger one, never past the limits', () => {
    expect(sidePanelWidthForKey(300, 'ArrowLeft', false)).toBe(300 + SIDE_PANEL_WIDTH_KEY_STEP)
    expect(sidePanelWidthForKey(300, 'ArrowRight', false)).toBe(300 - SIDE_PANEL_WIDTH_KEY_STEP)
    expect(sidePanelWidthForKey(300, 'ArrowLeft', true)).toBe(300 + SIDE_PANEL_WIDTH_KEY_STEP_BIG)
    expect(sidePanelWidthForKey(SIDE_PANEL_WIDTH_MAX, 'ArrowLeft', true)).toBe(SIDE_PANEL_WIDTH_MAX)
    expect(sidePanelWidthForKey(SIDE_PANEL_WIDTH_MIN, 'ArrowRight', false)).toBe(SIDE_PANEL_WIDTH_MIN)
  })

  it('Home and End jump to the limits and other keys do nothing', () => {
    expect(sidePanelWidthForKey(300, 'Home', false)).toBe(SIDE_PANEL_WIDTH_MIN)
    expect(sidePanelWidthForKey(300, 'End', false)).toBe(SIDE_PANEL_WIDTH_MAX)
    expect(sidePanelWidthForKey(300, 'Enter', false)).toBeNull()
    expect(sidePanelWidthForKey(300, 'a', false)).toBeNull()
  })
})

describe('sidePanelWidthForDrag', () => {
  it('follows the pointer from where the drag started, inverted for a left-edge handle', () => {
    expect(sidePanelWidthForDrag(300, 500, 420)).toBe(380)
    expect(sidePanelWidthForDrag(400, 500, 560)).toBe(340)
  })

  it('stops at the limits', () => {
    expect(sidePanelWidthForDrag(300, 500, 2000)).toBe(SIDE_PANEL_WIDTH_MIN)
    expect(sidePanelWidthForDrag(900, 500, 0)).toBe(SIDE_PANEL_WIDTH_MAX)
  })
})
