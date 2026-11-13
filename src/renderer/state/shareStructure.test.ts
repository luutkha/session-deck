import { describe, expect, it } from 'vitest'
import { shareStructure } from './shareStructure'

interface Session {
  readonly id: string
  readonly name: string
  readonly notes: string
}

interface Settings {
  readonly theme: string
  readonly sound: boolean
}

interface Store {
  readonly sessions: readonly Session[]
  readonly settings: Settings
}

function makeSession(index: number): Session {
  return { id: `s${index}`, name: `Session ${index}`, notes: `notes ${index}` }
}

function makeStore(): Store {
  return {
    sessions: [makeSession(1), makeSession(2), makeSession(3)],
    settings: { theme: 'dark', sound: true }
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

describe('shareStructure', () => {
  it('returns the previous value when the new value is deeply equal', () => {
    const previous = makeStore()
    const next = makeStore()

    expect(shareStructure(previous, next)).toBe(previous)
  })

  it('keeps unchanged sessions and settings by reference when one session changed', () => {
    const previous = makeStore()
    const next: Store = {
      sessions: [makeSession(1), { ...makeSession(2), name: 'Renamed' }, makeSession(3)],
      settings: { theme: 'dark', sound: true }
    }

    const shared = shareStructure(previous, next)

    expect(shared).not.toBe(previous)
    expect(shared.sessions).not.toBe(previous.sessions)
    expect(shared.sessions[0]).toBe(previous.sessions[0])
    expect(shared.sessions[1]).not.toBe(previous.sessions[1])
    expect(shared.sessions[1].name).toBe('Renamed')
    expect(shared.sessions[2]).toBe(previous.sessions[2])
    expect(shared.settings).toBe(previous.settings)
  })

  it('handles an added key', () => {
    const previous = { a: 1, nested: { x: 1 } }
    const next = { a: 1, nested: { x: 1 }, b: 2 }

    const shared = shareStructure(previous, next)

    expect(shared).not.toBe(previous)
    expect(shared).toEqual(next)
    expect(shared.nested).toBe(previous.nested)
  })

  it('handles a removed key', () => {
    const previous = { a: 1, b: 2, nested: { x: 1 } }
    const next = { a: 1, nested: { x: 1 } }

    const shared = shareStructure(previous, next)

    expect(shared).not.toBe(previous)
    expect(shared).toEqual(next)
    expect('b' in shared).toBe(false)
    expect(shared.nested).toBe(previous.nested)
  })

  it('treats an explicit undefined value like a missing key', () => {
    const previous: { readonly a: number; readonly b?: number } = { a: 1 }

    expect(shareStructure(previous, { a: 1, b: undefined })).toBe(previous)
    expect(shareStructure(previous, { a: 1, b: 2 })).toEqual({ a: 1, b: 2 })
  })

  it('keeps existing elements when the array grows', () => {
    const previous = [{ id: 1 }, { id: 2 }]
    const next = [{ id: 1 }, { id: 2 }, { id: 3 }]

    const shared = shareStructure(previous, next)

    expect(shared).not.toBe(previous)
    expect(shared).toHaveLength(3)
    expect(shared[0]).toBe(previous[0])
    expect(shared[1]).toBe(previous[1])
    expect(shared[2]).toEqual({ id: 3 })
  })

  it('keeps existing elements when the array shrinks', () => {
    const previous = [{ id: 1 }, { id: 2 }, { id: 3 }]
    const next = [{ id: 1 }, { id: 2 }]

    const shared = shareStructure(previous, next)

    expect(shared).not.toBe(previous)
    expect(shared).toHaveLength(2)
    expect(shared[0]).toBe(previous[0])
    expect(shared[1]).toBe(previous[1])
  })

  it('returns the previous array when every element is deeply equal', () => {
    const previous = [[1, 2], { a: { b: 1 } }]
    const next = [[1, 2], { a: { b: 1 } }]

    const shared = shareStructure(previous, next)

    expect(shared).toBe(previous)
    expect(shared[0]).toBe(previous[0])
    expect(shared[1]).toBe(previous[1])
  })

  it('handles null and primitive roots', () => {
    expect(shareStructure(null, null)).toBeNull()
    expect(shareStructure(5, 5)).toBe(5)
    expect(shareStructure(5, 6)).toBe(6)
    expect(shareStructure('a', 'b')).toBe('b')
    expect(shareStructure(true, false)).toBe(false)
    expect(shareStructure(null, { a: 1 })).toEqual({ a: 1 })
    expect(shareStructure({ a: 1 }, null)).toBeNull()
    expect(shareStructure({ a: 1 }, [1])).toEqual([1])
  })

  it('never mutates its inputs', () => {
    const previous = deepFreeze(makeStore())
    const next = deepFreeze<Store>({
      sessions: [makeSession(1), makeSession(2), { ...makeSession(3), notes: 'changed' }],
      settings: { theme: 'light', sound: true }
    })

    const shared = shareStructure(previous, next)

    expect(shared.sessions[2].notes).toBe('changed')
    expect(shared.sessions[0]).toBe(previous.sessions[0])
    expect(previous).toEqual(makeStore())
  })

  it('stays fast on a large input', () => {
    const sessions = Array.from({ length: 2000 }, (_, index) => makeSession(index))
    const previous: Store = { sessions, settings: { theme: 'dark', sound: true } }
    const next: Store = {
      sessions: sessions.map((session, index) => (index === 1234 ? { ...session, name: 'Renamed' } : { ...session })),
      settings: { theme: 'dark', sound: true }
    }

    const started = performance.now()
    const shared = shareStructure(previous, next)
    const elapsed = performance.now() - started

    expect(shared.sessions).toHaveLength(2000)
    expect(shared.sessions[0]).toBe(previous.sessions[0])
    expect(shared.sessions[1234]).not.toBe(previous.sessions[1234])
    expect(shared.sessions[1234].name).toBe('Renamed')
    expect(shared.sessions[1999]).toBe(previous.sessions[1999])
    expect(shared.settings).toBe(previous.settings)
    expect(elapsed).toBeLessThan(250)
  })
})
