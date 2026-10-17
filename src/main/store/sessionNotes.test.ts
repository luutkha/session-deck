import { describe, expect, it } from 'vitest'
import type { Session, StoreData } from '../../shared/types'
import { emptyStore } from './reducers'
import {
  setSessionChecklist,
  setSessionNotes,
  validateChecklist,
  validateNotes
} from './sessionNotes'

function session(id: string, extra: Partial<Session> = {}): Session {
  return {
    id,
    name: id,
    cwd: '/x',
    groupId: null,
    statusId: null,
    order: 0,
    createdAt: 1,
    claudeArgs: [],
    ...extra
  }
}

function storeWith(...sessions: Session[]): StoreData {
  return { ...emptyStore(), sessions }
}

describe('validateNotes', () => {
  it('accepts strings up to 20000 characters, including the empty string', () => {
    expect(validateNotes('')).toBe('')
    expect(validateNotes('a'.repeat(20000))).toHaveLength(20000)
  })

  it('rejects non-strings', () => {
    expect(() => validateNotes(42)).toThrow('Notes must be a string')
    expect(() => validateNotes(null)).toThrow('Notes must be a string')
  })

  it('rejects notes longer than 20000 characters', () => {
    expect(() => validateNotes('a'.repeat(20001))).toThrow('Notes too long')
  })
})

describe('validateChecklist', () => {
  it('normalizes items (trimmed text, only id/text/done kept)', () => {
    const result = validateChecklist([{ id: 'a', text: '  do it  ', done: false, extra: 1 }])
    expect(result).toEqual([{ id: 'a', text: 'do it', done: false }])
  })

  it('accepts an empty list', () => {
    expect(validateChecklist([])).toEqual([])
  })

  it('rejects a non-array', () => {
    expect(() => validateChecklist({})).toThrow('Invalid checklist: must be an array')
  })

  it('rejects more than 100 items', () => {
    const items = Array.from({ length: 101 }, (_, i) => ({ id: `i${i}`, text: 'x', done: false }))
    expect(() => validateChecklist(items)).toThrow('Invalid checklist: at most 100 items')
  })

  it('accepts exactly 100 items', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: `i${i}`, text: 'x', done: false }))
    expect(validateChecklist(items)).toHaveLength(100)
  })

  it('rejects non-object items', () => {
    expect(() => validateChecklist(['x'])).toThrow('Invalid checklist: item 0 must be an object')
    expect(() => validateChecklist([null])).toThrow('Invalid checklist: item 0 must be an object')
  })

  it('rejects empty or over-long ids', () => {
    expect(() => validateChecklist([{ id: '', text: 'x', done: false }])).toThrow('Invalid checklist: item 0 id')
    expect(() => validateChecklist([{ id: 'a'.repeat(65), text: 'x', done: false }])).toThrow('Invalid checklist: item 0 id')
    expect(validateChecklist([{ id: 'a'.repeat(64), text: 'x', done: false }])).toHaveLength(1)
  })

  it('rejects duplicate ids', () => {
    expect(() =>
      validateChecklist([
        { id: 'a', text: 'x', done: false },
        { id: 'a', text: 'y', done: true }
      ])
    ).toThrow('Invalid checklist: duplicate id "a"')
  })

  it('rejects text that is blank after trimming or longer than 300 characters', () => {
    expect(() => validateChecklist([{ id: 'a', text: '   ', done: false }])).toThrow('Invalid checklist: item 0 text')
    expect(() => validateChecklist([{ id: 'a', text: 'x'.repeat(301), done: false }])).toThrow('Invalid checklist: item 0 text')
    expect(validateChecklist([{ id: 'a', text: 'x'.repeat(300), done: false }])).toHaveLength(1)
  })

  it('rejects non-string text and non-boolean done', () => {
    expect(() => validateChecklist([{ id: 'a', text: 1, done: false }])).toThrow('Invalid checklist: item 0 text')
    expect(() => validateChecklist([{ id: 'a', text: 'x', done: 'no' }])).toThrow('Invalid checklist: item 0 done')
  })
})

describe('setSessionNotes', () => {
  it('sets notes immutably', () => {
    const before = storeWith(session('s1'))
    const after = setSessionNotes(before, 's1', 'hello')
    expect(after).not.toBe(before)
    expect(after.sessions[0].notes).toBe('hello')
    expect(before.sessions[0].notes).toBeUndefined()
  })

  it('replaces existing notes', () => {
    const data = storeWith(session('s1', { notes: 'old' }))
    expect(setSessionNotes(data, 's1', 'new').sessions[0].notes).toBe('new')
  })

  it('removes the field for an empty string', () => {
    const data = storeWith(session('s1', { notes: 'old' }))
    const after = setSessionNotes(data, 's1', '')
    expect(after.sessions[0]).not.toHaveProperty('notes')
  })

  it('throws for an unknown session without changing anything', () => {
    const data = storeWith(session('s1'))
    expect(() => setSessionNotes(data, 'nope', 'x')).toThrow('Unknown session: nope')
  })

  it('throws Notes too long for oversized notes', () => {
    const data = storeWith(session('s1'))
    expect(() => setSessionNotes(data, 's1', 'a'.repeat(20001))).toThrow('Notes too long')
  })

  it('leaves other sessions untouched (same references)', () => {
    const other = session('s2')
    const data = storeWith(session('s1'), other)
    const after = setSessionNotes(data, 's1', 'x')
    expect(after.sessions[1]).toBe(other)
  })
})

describe('setSessionChecklist', () => {
  const items = [{ id: 'a', text: 'write tests', done: false }]

  it('sets the checklist immutably', () => {
    const data = storeWith(session('s1'))
    const after = setSessionChecklist(data, 's1', items)
    expect(after.sessions[0].checklist).toEqual(items)
    expect(data.sessions[0].checklist).toBeUndefined()
  })

  it('removes the field for an empty list', () => {
    const data = storeWith(session('s1', { checklist: items }))
    const after = setSessionChecklist(data, 's1', [])
    expect(after.sessions[0]).not.toHaveProperty('checklist')
  })

  it('throws for an unknown session', () => {
    expect(() => setSessionChecklist(storeWith(), 'nope', items)).toThrow('Unknown session: nope')
  })

  it('throws Invalid checklist for bad items and keeps the old value', () => {
    const data = storeWith(session('s1', { checklist: items }))
    expect(() => setSessionChecklist(data, 's1', [{ id: 'a', text: '', done: false }])).toThrow('Invalid checklist')
    expect(data.sessions[0].checklist).toEqual(items)
  })
})
