import { describe, expect, it } from 'vitest'
import { parseNameStatusZ, parseNumstatZ, parseUntrackedZ } from './worktreeParse'

describe('parseNumstatZ', () => {
  it('reads plain entries as path -> counts', () => {
    const map = parseNumstatZ('3\t1\tsrc/a.ts\0' + '9\t0\tREADME.md\0')
    expect(map.get('src/a.ts')).toEqual({ additions: 3, deletions: 1 })
    expect(map.get('README.md')).toEqual({ additions: 9, deletions: 0 })
  })

  it('reads a rename as an empty path field followed by old and new paths', () => {
    const map = parseNumstatZ('0\t0\t\0old name.txt\0new name.txt\0')
    expect(map.get('new name.txt')).toEqual({ additions: 0, deletions: 0 })
    expect(map.has('old name.txt')).toBe(false)
  })

  it('reads binary entries as null counts', () => {
    const map = parseNumstatZ('-\t-\timage.png\0-\t-\t\0a.bin\0b.bin\0')
    expect(map.get('image.png')).toEqual({ additions: null, deletions: null })
    expect(map.get('b.bin')).toEqual({ additions: null, deletions: null })
  })

  it('returns an empty map for empty output', () => {
    expect(parseNumstatZ('').size).toBe(0)
  })

  it('throws on output it cannot read', () => {
    expect(() => parseNumstatZ('garbage\0')).toThrow('Unexpected git output: numstat')
  })
})

describe('parseNameStatusZ', () => {
  it('maps status letters to change kinds', () => {
    const entries = parseNameStatusZ('A\0added.txt\0M\0modified.txt\0T\0type.txt\0D\0deleted.txt\0C050\0from.txt\0copy.txt\0')
    expect(entries.map((e) => [e.kind, e.path])).toEqual([
      ['added', 'added.txt'],
      ['modified', 'modified.txt'],
      ['modified', 'type.txt'],
      ['deleted', 'deleted.txt'],
      ['added', 'copy.txt']
    ])
  })

  it('reads a rename with its old path', () => {
    const [entry] = parseNameStatusZ('R100\0old.txt\0new.txt\0')
    expect(entry).toEqual({ kind: 'renamed', path: 'new.txt', oldPath: 'old.txt' })
  })

  it('returns an empty list for empty output', () => {
    expect(parseNameStatusZ('')).toEqual([])
  })

  it('throws when a record is cut short', () => {
    expect(() => parseNameStatusZ('R100\0old.txt\0')).toThrow('Unexpected git output: name-status')
  })
})

describe('parseUntrackedZ', () => {
  it('splits NUL separated paths and keeps spaces inside names', () => {
    expect(parseUntrackedZ('a.txt\0my notes.txt\0')).toEqual(['a.txt', 'my notes.txt'])
  })

  it('returns an empty list for empty output', () => {
    expect(parseUntrackedZ('')).toEqual([])
  })
})
