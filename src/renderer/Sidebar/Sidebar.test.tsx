import { describe, expect, it } from 'vitest'
import type { Id, RuntimeState } from '../../shared/types'
import { sortRuntimeFor } from './Sidebar'

const state: RuntimeState = { sessionId: 's1', run: 'running', exitCode: null, attention: null }
const before: ReadonlyMap<Id, RuntimeState> = new Map([['s1', state]])
// A runtime batch is a brand new Map (unchanged sessions keep their state objects).
const after: ReadonlyMap<Id, RuntimeState> = new Map([['s1', { ...state }]])

describe('sortRuntimeFor', () => {
  it('uses the live runtime only for the attention sort', (): void => {
    expect(sortRuntimeFor('attention', before)).toBe(before)
    expect(sortRuntimeFor('attention', after)).toBe(after)
  })

  it('keeps one stable empty map for every other sort, so runtime batches do not invalidate the filter memo', (): void => {
    expect(sortRuntimeFor('manual', before)).toBe(sortRuntimeFor('manual', after))
    for (const sort of ['recent', 'newest', 'name'] as const) {
      expect(sortRuntimeFor(sort, before)).toBe(sortRuntimeFor(sort, after))
      expect(sortRuntimeFor(sort, before).size).toBe(0)
    }
  })
})
