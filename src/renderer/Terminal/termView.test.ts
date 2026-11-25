import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BASE_FONT_SIZE,
  DEFAULT_TERM_VIEW,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  REDUCED_SCROLLBACK_LINES,
  SCROLLBACK_MAX,
  SCROLLBACK_MIN,
  TERM_VIEW_STORAGE_KEY,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  clampScrollback,
  clampZoom,
  effectiveScrollback,
  fontSizeFor,
  hasStoredTermView,
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

describe('effectiveScrollback', () => {
  it('lowers only the default when reduced effects are on (all four combinations)', () => {
    const saved = { zoomPercent: 120, scrollbackLines: 50_000 }
    // reduced + no saved profile → the smaller construction default.
    expect(effectiveScrollback({ reducedEffects: true, view: DEFAULT_TERM_VIEW, explicit: false }))
      .toBe(REDUCED_SCROLLBACK_LINES)
    // reduced + saved profile → the user's scrollback is kept.
    expect(effectiveScrollback({ reducedEffects: true, view: saved, explicit: true })).toBe(50_000)
    // normal + no saved profile → the normal default is unchanged.
    expect(effectiveScrollback({ reducedEffects: false, view: DEFAULT_TERM_VIEW, explicit: false })).toBe(10_000)
    // normal + saved profile → the user's scrollback is kept.
    expect(effectiveScrollback({ reducedEffects: false, view: saved, explicit: true })).toBe(50_000)
  })

  it('never grows a profile already below the reduced cap', () => {
    const view = { zoomPercent: 100, scrollbackLines: 1_000 }
    expect(effectiveScrollback({ reducedEffects: true, view, explicit: false })).toBe(1_000)
  })
})

describe('hasStoredTermView', () => {
  afterEach((): void => { vi.unstubAllGlobals() })

  function stubStorage(entries: ReadonlyMap<string, string>): void {
    vi.stubGlobal('localStorage', {
      getItem: (key: string): string | null => entries.get(key) ?? null
    })
  }

  it('a missing key means no explicit profile', () => {
    stubStorage(new Map())
    expect(hasStoredTermView()).toBe(false)
  })

  it('a valid saved key means an explicit profile; garbage does not', () => {
    stubStorage(new Map([[TERM_VIEW_STORAGE_KEY, serializeTermView(DEFAULT_TERM_VIEW)]]))
    expect(hasStoredTermView()).toBe(true)
    stubStorage(new Map([[TERM_VIEW_STORAGE_KEY, 'not json']]))
    expect(hasStoredTermView()).toBe(false)
  })
})
