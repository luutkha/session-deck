import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EFFECTS_PREF,
  DEFAULT_RENDERER_PREF,
  mergeGpuMode,
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

  it('auto: a real GPU keeps WebGL, a software renderer gets the DOM renderer', () => {
    expect(resolveRenderer('auto', 'hardware')).toBe('webgl')
    expect(resolveRenderer('auto', 'software')).toBe('dom')
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

describe('mergeGpuMode', () => {
  it('keeps the main-process answer when the probe is missing or looks like a real GPU', () => {
    expect(mergeGpuMode('hardware', null)).toBe('hardware')
    expect(mergeGpuMode('unknown', { available: true, renderer: 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11)' })).toBe('unknown')
    expect(mergeGpuMode('hardware', { available: true, renderer: '' })).toBe('hardware')
  })

  it('software evidence from the window wins, whatever main said', () => {
    expect(mergeGpuMode('hardware', { available: false, renderer: '' })).toBe('software')
    expect(mergeGpuMode('hardware', { available: true, renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)' })).toBe('software')
    expect(mergeGpuMode('unknown', { available: true, renderer: 'llvmpipe (LLVM 15.0.7, 256 bits)' })).toBe('software')
    expect(mergeGpuMode('hardware', { available: true, renderer: 'Microsoft Basic Render Driver' })).toBe('software')
  })

  it('stays software when main already said software', () => {
    expect(mergeGpuMode('software', { available: true, renderer: 'NVIDIA GeForce' })).toBe('software')
  })
})
