import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EFFECTS_PREF,
  DEFAULT_RENDERER_PREF,
  parseEffectsPref,
  parseRendererPref,
  resolveReducedEffects,
  resolveRenderer
} from './terminalRenderer'

describe('resolveRenderer (no-GPU support)', () => {
  it('lets an explicit preference win over the measured GPU', () => {
    expect(resolveRenderer('webgl', 'software')).toBe('webgl')
    expect(resolveRenderer('canvas', 'hardware')).toBe('canvas')
    expect(resolveRenderer('dom', 'hardware')).toBe('dom')
  })

  it('auto: a real GPU keeps WebGL, a software renderer gets Canvas', () => {
    expect(resolveRenderer('auto', 'hardware')).toBe('webgl')
    expect(resolveRenderer('auto', 'software')).toBe('canvas')
  })

  it('auto: an undetected GPU keeps WebGL (today\'s behaviour)', () => {
    expect(resolveRenderer('auto', 'unknown')).toBe('webgl')
  })

  it('auto: no GPU info yet means no GPU addon (DOM)', () => {
    expect(resolveRenderer('auto', null)).toBe('dom')
  })
})

describe('resolveReducedEffects', () => {
  it('reduced when the user asked for it, whatever the GPU', () => {
    expect(resolveReducedEffects('reduced', null)).toBe(true)
    expect(resolveReducedEffects('reduced', 'hardware')).toBe(true)
  })

  it('full never reduces, even on a software renderer', () => {
    expect(resolveReducedEffects('full', 'software')).toBe(false)
  })

  it('auto reduces only on a software renderer', () => {
    expect(resolveReducedEffects('auto', 'software')).toBe(true)
    expect(resolveReducedEffects('auto', 'hardware')).toBe(false)
    expect(resolveReducedEffects('auto', 'unknown')).toBe(false)
    expect(resolveReducedEffects('auto', null)).toBe(false)
  })
})

describe('stored preference parsers', () => {
  it('accepts every valid value', () => {
    expect(parseRendererPref('auto')).toBe('auto')
    expect(parseRendererPref('webgl')).toBe('webgl')
    expect(parseRendererPref('canvas')).toBe('canvas')
    expect(parseRendererPref('dom')).toBe('dom')
    expect(parseEffectsPref('auto')).toBe('auto')
    expect(parseEffectsPref('full')).toBe('full')
    expect(parseEffectsPref('reduced')).toBe('reduced')
  })

  it('drops invalid, missing or differently-cased values to auto', () => {
    for (const raw of [null, '', 'gpu', 'WEBGL', 'Canvas', '  webgl', '{"renderer":"webgl"}']) {
      expect(parseRendererPref(raw)).toBe(DEFAULT_RENDERER_PREF)
    }
    for (const raw of [null, '', 'off', 'Reduced', 'true']) {
      expect(parseEffectsPref(raw)).toBe(DEFAULT_EFFECTS_PREF)
    }
  })
})
