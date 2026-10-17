import { describe, expect, it } from 'vitest'
import type { StatusDef } from '../../shared/types'
import { evaluateStatusDraft } from './statusDraft'

const CURRENT: StatusDef = { id: 's1', name: 'Todo', color: '#9e9e9e' }

describe('evaluateStatusDraft', () => {
  it('commits a trimmed rename', () => {
    expect(evaluateStatusDraft(CURRENT, '  Working  ', '#9e9e9e')).toEqual({
      next: { id: 's1', name: 'Working', color: '#9e9e9e' },
      error: null
    })
  })

  it('commits a color change', () => {
    expect(evaluateStatusDraft(CURRENT, 'Todo', '#42a5f5')).toEqual({
      next: { id: 's1', name: 'Todo', color: '#42a5f5' },
      error: null
    })
  })

  it('commits a name and color change together', () => {
    expect(evaluateStatusDraft(CURRENT, 'Done', '#66bb6a')).toEqual({
      next: { id: 's1', name: 'Done', color: '#66bb6a' },
      error: null
    })
  })

  it('keeps the current id in the committed draft', () => {
    expect(evaluateStatusDraft(CURRENT, 'Done', '#66bb6a').next?.id).toBe('s1')
  })

  it('is a no-op for an unchanged draft', () => {
    expect(evaluateStatusDraft(CURRENT, 'Todo', '#9e9e9e')).toEqual({ next: null, error: null })
  })

  it('is a no-op when only surrounding whitespace changed', () => {
    expect(evaluateStatusDraft(CURRENT, '  Todo  ', '#9e9e9e')).toEqual({ next: null, error: null })
  })

  it('returns an inline error for an empty name', () => {
    expect(evaluateStatusDraft(CURRENT, '   ', '#9e9e9e')).toEqual({
      next: null,
      error: 'Name required'
    })
  })

  it('returns an inline error for a too-long name', () => {
    expect(evaluateStatusDraft(CURRENT, 'a'.repeat(101), '#9e9e9e')).toEqual({
      next: null,
      error: 'Name too long'
    })
  })

  it('returns an inline error for an invalid color', () => {
    expect(evaluateStatusDraft(CURRENT, 'Todo', 'blue')).toEqual({
      next: null,
      error: 'Invalid color: blue (expected #rrggbb)'
    })
  })

  it('reports the name error before the color error', () => {
    expect(evaluateStatusDraft(CURRENT, '', 'blue')).toEqual({ next: null, error: 'Name required' })
  })
})