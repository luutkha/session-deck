import { describe, expect, it } from 'vitest'
import type { StoreData } from '../../shared/types'
import { emptyStore } from './reducers'
import { parseStoreData } from './persistence'

const BASE_SESSION = {
  id: 's1',
  name: 'A',
  cwd: '/x',
  groupId: null,
  statusId: null,
  order: 0,
  createdAt: 1,
  claudeArgs: []
}

function fileWith(extra: Record<string, unknown>): unknown {
  return {
    version: 1,
    sessions: [{ ...BASE_SESSION, ...extra }],
    groups: [],
    statuses: [],
    groupOrder: []
  }
}

describe('persistence: notes and checklist', () => {
  it('round trips notes and checklist', () => {
    const data: StoreData = {
      ...emptyStore(),
      sessions: [
        {
          ...BASE_SESSION,
          notes: 'line one\nline two',
          checklist: [
            { id: 'a', text: 'first', done: true },
            { id: 'b', text: 'second', done: false }
          ]
        }
      ]
    }
    const parsed = parseStoreData(JSON.parse(JSON.stringify(data)))
    expect(parsed).toEqual(data)
  })

  it('loads old files without notes or checklist', () => {
    const parsed = parseStoreData(fileWith({}))
    expect(parsed.sessions[0]).not.toHaveProperty('notes')
    expect(parsed.sessions[0]).not.toHaveProperty('checklist')
  })

  it('drops an empty notes string and an empty checklist', () => {
    const parsed = parseStoreData(fileWith({ notes: '', checklist: [] }))
    expect(parsed.sessions[0]).not.toHaveProperty('notes')
    expect(parsed.sessions[0]).not.toHaveProperty('checklist')
  })

  it('drops notes that are not strings, keeping the rest of the file', () => {
    const parsed = parseStoreData(fileWith({ notes: 42, name: 'Kept' }))
    expect(parsed.sessions[0]).not.toHaveProperty('notes')
    expect(parsed.sessions[0].name).toBe('Kept')
    expect(parsed.groups).toEqual([])
  })

  it('drops notes longer than 20000 characters', () => {
    const parsed = parseStoreData(fileWith({ notes: 'a'.repeat(20001) }))
    expect(parsed.sessions[0]).not.toHaveProperty('notes')
  })

  it('keeps notes of exactly 20000 characters', () => {
    const parsed = parseStoreData(fileWith({ notes: 'a'.repeat(20000) }))
    expect(parsed.sessions[0].notes).toHaveLength(20000)
  })

  it('drops a checklist with an invalid item but keeps the session', () => {
    const parsed = parseStoreData(
      fileWith({ checklist: [{ id: 'a', text: 'ok', done: false }, { id: 'b', text: '', done: false }] })
    )
    expect(parsed.sessions[0]).not.toHaveProperty('checklist')
    expect(parsed.sessions[0].id).toBe('s1')
  })

  it('drops a checklist with duplicate ids', () => {
    const parsed = parseStoreData(
      fileWith({ checklist: [{ id: 'a', text: 'x', done: false }, { id: 'a', text: 'y', done: true }] })
    )
    expect(parsed.sessions[0]).not.toHaveProperty('checklist')
  })

  it('drops a checklist that is not an array', () => {
    const parsed = parseStoreData(fileWith({ checklist: 'nope' }))
    expect(parsed.sessions[0]).not.toHaveProperty('checklist')
  })

  it('drops a checklist with more than 100 items', () => {
    const items = Array.from({ length: 101 }, (_, i) => ({ id: `i${i}`, text: 'x', done: false }))
    const parsed = parseStoreData(fileWith({ checklist: items }))
    expect(parsed.sessions[0]).not.toHaveProperty('checklist')
  })

  it('trims checklist text on load', () => {
    const parsed = parseStoreData(fileWith({ checklist: [{ id: 'a', text: '  hi  ', done: true }] }))
    expect(parsed.sessions[0].checklist).toEqual([{ id: 'a', text: 'hi', done: true }])
  })
})
