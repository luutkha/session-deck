import { describe, it, expect } from 'vitest'
import { asNotes, asChecklist } from './ipcValidation'

describe('asNotes', () => {
  it('accepts strings up to 20000 characters', () => {
    expect(asNotes('')).toBe('')
    expect(asNotes('a'.repeat(20000))).toHaveLength(20000)
  })

  it('rejects non-strings with a clear message', () => {
    expect(() => asNotes(1)).toThrow('Invalid notes: must be a string')
    expect(() => asNotes(undefined)).toThrow('Invalid notes: must be a string')
    expect(() => asNotes(['x'])).toThrow('Invalid notes: must be a string')
  })

  it('rejects strings longer than 20000 characters', () => {
    expect(() => asNotes('a'.repeat(20001))).toThrow('Invalid notes: must be at most 20000 characters')
  })
})

describe('asChecklist', () => {
  it('accepts a valid list and returns normalized items', () => {
    expect(asChecklist([{ id: 'a', text: ' x ', done: true }])).toEqual([{ id: 'a', text: 'x', done: true }])
  })

  it('accepts an empty list', () => {
    expect(asChecklist([])).toEqual([])
  })

  it('rejects non-arrays', () => {
    expect(() => asChecklist('nope')).toThrow('Invalid checklist: must be an array of items')
    expect(() => asChecklist({ id: 'a' })).toThrow('Invalid checklist: must be an array of items')
  })

  it('rejects invalid items with the store reason', () => {
    expect(() => asChecklist([{ id: 'a', text: '', done: false }])).toThrow('Invalid checklist: item 0 text')
    expect(() => asChecklist([{ id: 'a', text: 'x', done: false }, { id: 'a', text: 'y', done: false }])).toThrow(
      'Invalid checklist: duplicate id "a"'
    )
  })
})
