import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChangedFile } from '../../../shared/types'
import {
  VIEWED_MAX_ENTRIES,
  fileSignature,
  isViewed,
  markAllViewed,
  markViewed,
  pruneViewed,
  readViewed,
  subscribeViewed,
  unmarkViewed,
  unviewedCount,
  unviewedFiles,
  viewedStorageKey,
  writeViewed
} from './viewedMarks'

function file(overrides: Partial<ChangedFile> = {}): ChangedFile {
  return {
    path: 'src/app.ts',
    kind: 'modified',
    additions: 3,
    deletions: 1,
    ...overrides
  }
}

describe('fileSignature', () => {
  it('is made of kind, old path and both counts', () => {
    expect(fileSignature(file())).toBe('modified||3|1')
    expect(fileSignature(file({ kind: 'renamed', oldPath: 'src/old.ts' }))).toBe('renamed|src/old.ts|3|1')
  })
  it('uses stable placeholders for a missing old path and null counts', () => {
    expect(fileSignature(file({ kind: 'added', additions: null, deletions: null }))).toBe('added||n|n')
  })
  it('changes when any part of the file state changes', () => {
    const base = fileSignature(file())
    expect(fileSignature(file({ kind: 'deleted' }))).not.toBe(base)
    expect(fileSignature(file({ additions: 4 }))).not.toBe(base)
    expect(fileSignature(file({ deletions: 2 }))).not.toBe(base)
  })
})

describe('viewed marks', () => {
  const a = file({ path: 'a.ts' })
  const b = file({ path: 'b.ts', kind: 'added', additions: 10, deletions: null })

  it('isViewed needs the path and the exact signature', () => {
    const map = markViewed({}, a)
    expect(isViewed(map, a)).toBe(true)
    expect(isViewed(map, b)).toBe(false)
    expect(isViewed({}, a)).toBe(false)
  })
  it('a signature change un-views the file', () => {
    const map = markViewed({}, a)
    const changed = file({ path: 'a.ts', additions: 4 })
    expect(isViewed(map, changed)).toBe(false)
    expect(fileSignature(changed)).not.toBe(fileSignature(a))
  })
  it('markViewed and unmarkViewed do not mutate the input', () => {
    const map: Readonly<Record<string, string>> = { 'b.ts': fileSignature(b) }
    const marked = markViewed(map, a)
    expect(marked).not.toBe(map)
    expect(map['a.ts']).toBeUndefined()
    const unmarked = unmarkViewed(marked, 'a.ts')
    expect(isViewed(unmarked, a)).toBe(false)
    expect(isViewed(unmarked, b)).toBe(true)
    expect(isViewed(marked, a)).toBe(true)
    expect(unmarkViewed(unmarked, 'ghost')).toEqual(unmarked)
  })
  it('markAllViewed marks every current file', () => {
    const map = markAllViewed({}, [a, b])
    expect(unviewedCount([a, b], map)).toBe(0)
    expect(isViewed(map, a)).toBe(true)
    expect(isViewed(map, b)).toBe(true)
  })
  it('pruneViewed drops gone files and changed signatures', () => {
    const stale = markAllViewed({}, [a, b])
    const changed = file({ path: 'b.ts', kind: 'added', additions: 11, deletions: null })
    const pruned = pruneViewed(stale, [a, changed])
    expect(Object.keys(pruned)).toEqual(['a.ts'])
    expect(isViewed(pruned, changed)).toBe(false)
    expect(pruneViewed(pruned, [])).toEqual({})
  })
  it('unviewedFiles keeps order and only the unreviewed files', () => {
    const map = markViewed({}, a)
    expect(unviewedFiles([a, b], map)).toEqual([b])
    expect(unviewedFiles([a, b], markAllViewed({}, [a, b]))).toEqual([])
    expect(unviewedFiles([], map)).toEqual([])
  })
  it('unviewedCount counts the unreviewed files', () => {
    const map = markViewed({}, a)
    expect(unviewedCount([a, b], map)).toBe(1)
    expect(unviewedCount([a, b], {})).toBe(2)
  })
})

describe('localStorage and pub/sub helpers', () => {
  const storage = new Map<string, string>()

  afterEach(() => {
    vi.unstubAllGlobals()
    storage.clear()
  })

  function installStorage(): void {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value)
    })
  }

  it('the key is namespaced per worktree', () => {
    expect(viewedStorageKey('wt1')).toBe('sessiondeck.changes.viewed.wt1')
  })
  it('writeViewed stores a map that readViewed reads back', () => {
    installStorage()
    const map = { 'a.ts': 'modified||3|1' }
    writeViewed('wt1', map)
    expect(readViewed('wt1')).toEqual(map)
    expect(readViewed('wt2')).toEqual({})
  })
  it('corrupt or absent storage degrades to {}', () => {
    installStorage()
    storage.set(viewedStorageKey('wt1'), 'not json')
    expect(readViewed('wt1')).toEqual({})
    storage.set(viewedStorageKey('wt1'), '[1,2]')
    expect(readViewed('wt1')).toEqual({})
    expect(readViewed('wt-missing')).toEqual({})
  })
  it('readViewed keeps only string values', () => {
    installStorage()
    storage.set(viewedStorageKey('wt1'), JSON.stringify({ good: 'sig', bad: 42, nil: null, obj: {} }))
    expect(readViewed('wt1')).toEqual({ good: 'sig' })
  })
  it('readViewed caps at VIEWED_MAX_ENTRIES', () => {
    installStorage()
    const raw: Record<string, string> = {}
    for (let i = 0; i < VIEWED_MAX_ENTRIES + 5; i++) raw[`f${String(i)}`] = 'sig'
    storage.set(viewedStorageKey('wt1'), JSON.stringify(raw))
    expect(Object.keys(readViewed('wt1'))).toHaveLength(VIEWED_MAX_ENTRIES)
  })
  it('writeViewed caps the stored map', () => {
    installStorage()
    const raw: Record<string, string> = {}
    for (let i = 0; i < VIEWED_MAX_ENTRIES + 5; i++) raw[`f${String(i)}`] = 'sig'
    writeViewed('wt1', raw)
    const stored: unknown = JSON.parse(storage.get(viewedStorageKey('wt1')) ?? '{}')
    expect(Object.keys(stored as Record<string, unknown>)).toHaveLength(VIEWED_MAX_ENTRIES)
  })
  it('no localStorage (node tests) and throwing storage never throw', () => {
    expect(readViewed('wt1')).toEqual({})
    expect(() => writeViewed('wt1', {})).not.toThrow()
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('quota') }
    })
    expect(readViewed('wt1')).toEqual({})
    expect(() => writeViewed('wt1', {})).not.toThrow()
  })
  it('notifies subscribers on write, and unsubscribe stops them', () => {
    installStorage()
    const seen: string[] = []
    const off = subscribeViewed((id) => void seen.push(id))
    writeViewed('wt1', {})
    expect(seen).toEqual(['wt1'])
    off()
    writeViewed('wt2', {})
    expect(seen).toEqual(['wt1'])
  })
  it('subscribers are notified even when storage is unavailable', () => {
    const seen: string[] = []
    const off = subscribeViewed((id) => void seen.push(id))
    try {
      writeViewed('wt3', {})
      expect(seen).toEqual(['wt3'])
    } finally {
      off()
    }
  })
})
