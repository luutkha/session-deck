import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('joins class names and drops falsy values', () => {
    expect(cn('px-2', false, undefined, null, 'text-sm')).toBe('px-2 text-sm')
  })

  it('resolves conflicting Tailwind utilities, keeping the last one', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4')
    expect(cn('bg-primary', 'bg-destructive')).toBe('bg-destructive')
  })

  it('accepts conditional object syntax', () => {
    expect(cn({ 'font-medium': true, italic: false })).toBe('font-medium')
  })
})
