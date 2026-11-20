import { describe, expect, it } from 'vitest'
import {
  FIND_HIGHLIGHT_MAX,
  countMatches,
  findTableMatches,
  matchCounter,
  nextMatchIndex,
  splitByMatches
} from './fileViewFind'

describe('splitByMatches', () => {
  it('keeps the text whole when there is no query', () => {
    expect(splitByMatches('hello', '')).toEqual([{ text: 'hello', match: false }])
    expect(splitByMatches('', 'x')).toEqual([])
  })

  it('splits case-insensitively and keeps the original casing', () => {
    expect(splitByMatches('Hello WORLD', 'o')).toEqual([
      { text: 'Hell', match: false },
      { text: 'o', match: true },
      { text: ' W', match: false },
      { text: 'O', match: true },
      { text: 'RLD', match: false }
    ])
  })

  it('handles a match at the start and at the end', () => {
    const segments = splitByMatches('abcabc', 'abc')
    expect(segments).toEqual([
      { text: 'abc', match: true },
      { text: 'abc', match: true }
    ])
  })

  it('does not overlap matches', () => {
    expect(splitByMatches('aaaa', 'aa')).toEqual([
      { text: 'aa', match: true },
      { text: 'aa', match: true }
    ])
  })

  it('caps the marks and keeps the rest as plain text', () => {
    const segments = splitByMatches('x'.repeat(30), 'x', 10)
    expect(segments.filter((segment) => segment.match)).toHaveLength(10)
    expect(segments[segments.length - 1]).toEqual({ text: 'x'.repeat(20), match: false })
  })

  it('caps at the default highlight limit', () => {
    const segments = splitByMatches('a'.repeat(FIND_HIGHLIGHT_MAX + 500), 'a')
    expect(segments.filter((segment) => segment.match)).toHaveLength(FIND_HIGHLIGHT_MAX)
  })

  it('treats a query longer than the text as no match', () => {
    expect(splitByMatches('short', 'much longer')).toEqual([{ text: 'short', match: false }])
  })
})

describe('countMatches', () => {
  it('counts matches without building segments', () => {
    expect(countMatches('one ONE one', 'one')).toBe(3)
    expect(countMatches('nothing', 'zzz')).toBe(0)
    expect(countMatches('anything', '')).toBe(0)
  })

  it('honours the cap', () => {
    expect(countMatches('a'.repeat(50), 'a', 7)).toBe(7)
  })
})

describe('nextMatchIndex', () => {
  it('moves forward and backward', () => {
    expect(nextMatchIndex(0, 5, 1)).toBe(1)
    expect(nextMatchIndex(3, 5, -1)).toBe(2)
  })

  it('wraps around both ends', () => {
    expect(nextMatchIndex(4, 5, 1)).toBe(0)
    expect(nextMatchIndex(0, 5, -1)).toBe(4)
  })

  it('clamps a stale current index and survives zero matches', () => {
    expect(nextMatchIndex(99, 5, 1)).toBe(0)
    expect(nextMatchIndex(0, 0, 1)).toBe(0)
    expect(nextMatchIndex(0, 0, -1)).toBe(0)
  })
})

describe('matchCounter', () => {
  it('shows the 1-based position', () => {
    expect(matchCounter('x', 2, 17)).toBe('3/17')
    expect(matchCounter('x', 0, 1)).toBe('1/1')
  })

  it('shows 0/0 for nothing to count', () => {
    expect(matchCounter('', 0, 0)).toBe('0/0')
    expect(matchCounter('x', 0, 0)).toBe('0/0')
  })
})

describe('findTableMatches', () => {
  const rows = [
    ['Name', 'Total'],
    ['apple', '10'],
    ['Apple pie', '9'],
    ['banana', 'apple 2']
  ]

  it('finds every row, not only the first page', () => {
    expect(findTableMatches(rows, 'apple')).toEqual([
      { row: 1, col: 0, inCell: 0 },
      { row: 2, col: 0, inCell: 0 },
      { row: 3, col: 1, inCell: 0 }
    ])
  })

  it('reports each occurrence inside one cell', () => {
    expect(findTableMatches([['aa aa']], 'aa')).toEqual([
      { row: 0, col: 0, inCell: 0 },
      { row: 0, col: 0, inCell: 1 }
    ])
  })

  it('gives no matches for an empty query', () => {
    expect(findTableMatches(rows, '')).toEqual([])
  })

  it('caps the matches', () => {
    expect(findTableMatches([['x', 'x', 'x']], 'x', 2)).toEqual([
      { row: 0, col: 0, inCell: 0 },
      { row: 0, col: 1, inCell: 0 }
    ])
  })
})
