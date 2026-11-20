import { describe, expect, it } from 'vitest'
import {
  IMAGE_ZOOM_STEPS,
  TEXT_ZOOM_STEPS,
  clampImageZoom,
  clampTextZoom,
  formatZoom,
  nextZoomStep,
  parseTextZoom,
  serializeTextZoom
} from './fileViewZoom'

describe('clamping', () => {
  it('keeps image zoom between 10% and 800%', () => {
    expect(clampImageZoom(0)).toBe(10)
    expect(clampImageZoom(10)).toBe(10)
    expect(clampImageZoom(333)).toBe(333)
    expect(clampImageZoom(5000)).toBe(800)
    expect(clampImageZoom(Number.NaN)).toBe(100)
  })

  it('keeps text zoom between 70% and 200%', () => {
    expect(clampTextZoom(1)).toBe(70)
    expect(clampTextZoom(70)).toBe(70)
    expect(clampTextZoom(110)).toBe(110)
    expect(clampTextZoom(900)).toBe(200)
  })
})

describe('nextZoomStep', () => {
  it('walks the image ladder up and down', () => {
    expect(nextZoomStep(100, 1, IMAGE_ZOOM_STEPS)).toBe(150)
    expect(nextZoomStep(100, -1, IMAGE_ZOOM_STEPS)).toBe(75)
    expect(nextZoomStep(400, 1, IMAGE_ZOOM_STEPS)).toBe(800)
    expect(nextZoomStep(25, -1, IMAGE_ZOOM_STEPS)).toBe(10)
  })

  it('stops at the ends of the ladder', () => {
    expect(nextZoomStep(800, 1, IMAGE_ZOOM_STEPS)).toBe(800)
    expect(nextZoomStep(10, -1, IMAGE_ZOOM_STEPS)).toBe(10)
  })

  it('walks the text ladder and handles an off-ladder value', () => {
    expect(nextZoomStep(100, 1, TEXT_ZOOM_STEPS)).toBe(110)
    expect(nextZoomStep(125, 1, TEXT_ZOOM_STEPS)).toBe(150)
    expect(nextZoomStep(95, 1, TEXT_ZOOM_STEPS)).toBe(100)
    expect(nextZoomStep(95, -1, TEXT_ZOOM_STEPS)).toBe(90)
    expect(nextZoomStep(200, 1, TEXT_ZOOM_STEPS)).toBe(200)
    expect(nextZoomStep(70, -1, TEXT_ZOOM_STEPS)).toBe(70)
  })

  it('falls back to 100 for a broken value', () => {
    expect(nextZoomStep(Number.NaN, 1, TEXT_ZOOM_STEPS)).toBe(110)
  })
})

describe('parseTextZoom / serializeTextZoom', () => {
  it('round-trips a valid zoom', () => {
    expect(parseTextZoom(serializeTextZoom(125))).toBe(125)
  })

  it('clamps a stored value to the text range', () => {
    expect(parseTextZoom('5')).toBe(70)
    expect(parseTextZoom('999')).toBe(200)
  })

  it('falls back to 100 for missing, broken or non-positive values', () => {
    expect(parseTextZoom(null)).toBe(100)
    expect(parseTextZoom('')).toBe(100)
    expect(parseTextZoom('wide')).toBe(100)
    expect(parseTextZoom('0')).toBe(100)
    expect(parseTextZoom('-20')).toBe(100)
  })

  it('formats the percentage shown in the toolbar', () => {
    expect(formatZoom(100)).toBe('100%')
    expect(formatZoom(124.6)).toBe('125%')
  })
})
