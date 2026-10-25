import { describe, expect, it } from 'vitest'
import {
  BASE_FONT_SIZE,
  DEFAULT_TERM_VIEW,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  SCROLLBACK_MAX,
  SCROLLBACK_MIN,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  clampScrollback,
  clampZoom,
  fontSizeFor,
  nextZoom,
  normalizeTermView,
  parseTermView,
  serializeTermView
} from './termView'

describe('defaults and clamps', () => {
  it('the default profile is 100% and 10k lines', () => {
    expect(DEFAULT_TERM_VIEW).toEqual({ zoomPercent: 100, scrollbackLines: 10_000 })
  })
  it('zoom clamps to 50..200 and rounds', () => {
    expect(clampZoom(10)).toBe(ZOOM_MIN)
    expect(clampZoom(500)).toBe(ZOOM_MAX)
    expect(clampZoom(109.6)).toBe(110)
    expect(clampZoom(Number.NaN)).toBe(ZOOM_MIN)
  })
  it('scrollback clamps to 1k..100k', () => {
    expect(clampScrollback(0)).toBe(SCROLLBACK_MIN)
    expect(clampScrollback(999_999)).toBe(SCROLLBACK_MAX)
    expect(clampScrollback(12_345.4)).toBe(12_345)
  })
})

describe('nextZoom', () => {
  it('steps by the zoom step and snaps at the bounds', () => {
    expect(nextZoom(100, ZOOM_STEP)).toBe(110)
    expect(nextZoom(100, -ZOOM_STEP)).toBe(90)
    expect(nextZoom(195, ZOOM_STEP)).toBe(ZOOM_MAX)
    expect(nextZoom(55, -ZOOM_STEP)).toBe(ZOOM_MIN)
  })
})

describe('fontSizeFor', () => {
  it('maps 50/100/200 percent to 7/14/28 px', () => {
    expect(fontSizeFor(50)).toBe(7)
    expect(fontSizeFor(100)).toBe(BASE_FONT_SIZE)
    expect(fontSizeFor(200)).toBe(28)
  })
  it('never leaves the sane font range', () => {
    expect(fontSizeFor(-100)).toBeGreaterThanOrEqual(MIN_FONT_SIZE)
    expect(fontSizeFor(10_000)).toBeLessThanOrEqual(MAX_FONT_SIZE)
  })
})

describe('parseTermView', () => {
  it('parses and normalizes a record', () => {
    expect(parseTermView('{"zoomPercent":130,"scrollbackLines":20000}')).toEqual({ zoomPercent: 130, scrollbackLines: 20_000 })
  })
  it('clamps out-of-range stored values', () => {
    expect(parseTermView('{"zoomPercent":10,"scrollbackLines":5}')).toEqual({ zoomPercent: ZOOM_MIN, scrollbackLines: SCROLLBACK_MIN })
  })
  it('garbage and wrong shapes → null', () => {
    expect(parseTermView(null)).toBeNull()
    expect(parseTermView('')).toBeNull()
    expect(parseTermView('not json')).toBeNull()
    expect(parseTermView('[1]')).toBeNull()
    expect(parseTermView('{"zoomPercent":"130","scrollbackLines":1}')).toBeNull()
    expect(parseTermView('{"zoomPercent":130}')).toBeNull()
  })
  it('roundtrips through serialize', () => {
    const view = normalizeTermView({ zoomPercent: 120, scrollbackLines: 5_000 })
    expect(parseTermView(serializeTermView(view))).toEqual(view)
  })
})
