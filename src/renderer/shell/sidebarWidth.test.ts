import { describe, expect, it } from 'vitest'
import {
  clampSidebarWidth,
  parseSidebarWidth,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_KEY_STEP,
  SIDEBAR_WIDTH_KEY_STEP_BIG,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  widthForDrag,
  widthForKey
} from './sidebarWidth'

describe('clampSidebarWidth', () => {
  it('keeps a width inside the limits and rounds it', () => {
    expect(clampSidebarWidth(320)).toBe(320)
    expect(clampSidebarWidth(320.6)).toBe(321)
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_WIDTH_MIN)
    expect(clampSidebarWidth(5000)).toBe(SIDEBAR_WIDTH_MAX)
  })

  it('turns anything that is not a number into the default', () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(SIDEBAR_WIDTH_DEFAULT)
  })
})

describe('parseSidebarWidth', () => {
  it('reads a stored number and clamps an out-of-range one', () => {
    expect(parseSidebarWidth('360')).toBe(360)
    expect(parseSidebarWidth('50')).toBe(SIDEBAR_WIDTH_MIN)
    expect(parseSidebarWidth('99999')).toBe(SIDEBAR_WIDTH_MAX)
  })

  it('falls back to the default for missing or broken values', () => {
    for (const raw of [null, '', '  ', 'wide', 'NaN', '12px', '{}']) {
      expect(parseSidebarWidth(raw)).toBe(SIDEBAR_WIDTH_DEFAULT)
    }
  })

  it('the default sits inside the limits', () => {
    expect(SIDEBAR_WIDTH_DEFAULT).toBeGreaterThanOrEqual(SIDEBAR_WIDTH_MIN)
    expect(SIDEBAR_WIDTH_DEFAULT).toBeLessThanOrEqual(SIDEBAR_WIDTH_MAX)
  })
})

describe('widthForKey', () => {
  it('arrows move by one step, Shift by a bigger one, never past the limits', () => {
    expect(widthForKey(300, 'ArrowRight', false)).toBe(300 + SIDEBAR_WIDTH_KEY_STEP)
    expect(widthForKey(300, 'ArrowLeft', false)).toBe(300 - SIDEBAR_WIDTH_KEY_STEP)
    expect(widthForKey(300, 'ArrowRight', true)).toBe(300 + SIDEBAR_WIDTH_KEY_STEP_BIG)
    expect(widthForKey(SIDEBAR_WIDTH_MIN, 'ArrowLeft', false)).toBe(SIDEBAR_WIDTH_MIN)
    expect(widthForKey(SIDEBAR_WIDTH_MAX, 'ArrowRight', true)).toBe(SIDEBAR_WIDTH_MAX)
  })

  it('Home and End jump to the limits and other keys do nothing', () => {
    expect(widthForKey(300, 'Home', false)).toBe(SIDEBAR_WIDTH_MIN)
    expect(widthForKey(300, 'End', false)).toBe(SIDEBAR_WIDTH_MAX)
    expect(widthForKey(300, 'Enter', false)).toBeNull()
    expect(widthForKey(300, 'a', false)).toBeNull()
  })
})

describe('widthForDrag', () => {
  it('follows the pointer from where the drag started', () => {
    expect(widthForDrag(300, 300, 380)).toBe(380)
    expect(widthForDrag(300, 300, 250)).toBe(250)
  })

  it('stops at the limits', () => {
    expect(widthForDrag(300, 300, 5)).toBe(SIDEBAR_WIDTH_MIN)
    expect(widthForDrag(300, 300, 3000)).toBe(SIDEBAR_WIDTH_MAX)
  })
})
