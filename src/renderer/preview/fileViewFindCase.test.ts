import { describe, expect, it } from 'vitest'
import { countMatches, findTableMatches, foldCase, isBlankQuery, matchCounter, splitByMatches } from './fileViewFind'

describe('foldCase', () => {
  it('lower-cases without ever changing the length', () => {
    expect(foldCase('ABC xyz')).toBe('abc xyz')
    expect(foldCase('İa').length).toBe(2) // "İa": İ.toLowerCase() would make 3 units
    expect(foldCase('İa')).toBe('İa')
  })

  it('keeps surrogate pairs whole', () => {
    expect(foldCase('\u{1F600}A')).toBe('\u{1F600}a')
    expect(foldCase('\u{1F600}A').length).toBe(3)
  })

  it('folds ordinary accented and Vietnamese letters', () => {
    expect(foldCase('BáO CÁO')).toBe('báo cáo')
  })
})

describe('find with a character whose lower case is longer (the Turkish dotted I)', () => {
  it('highlights the RIGHT character after it', () => {
    expect(splitByMatches('İabc', 'a')).toEqual([
      { text: 'İ', match: false },
      { text: 'a', match: true },
      { text: 'bc', match: false }
    ])
  })

  it('never produces an empty mark, and the counter agrees with the highlights', () => {
    const segments = splitByMatches('İa', 'a')
    expect(segments.filter((s) => s.match).every((s) => s.text !== '')).toBe(true)
    expect(countMatches('İa', 'a')).toBe(1)
    expect(segments.filter((s) => s.match)).toHaveLength(1)
  })

  it('table matches line up with the text of the cell', () => {
    const matches = findTableMatches([['İa']], 'a')
    expect(matches).toEqual([{ row: 0, col: 0, inCell: 0 }])
  })
})

describe('a query of only blanks is no query, everywhere', () => {
  it('is blank for spaces and tabs, not for text', () => {
    expect(isBlankQuery('   ')).toBe(true)
    expect(isBlankQuery('\t ')).toBe(true)
    expect(isBlankQuery('')).toBe(true)
    expect(isBlankQuery(' a ')).toBe(false)
  })

  it('finds nothing and counts nothing in text, tables and the counter', () => {
    expect(splitByMatches('a b c', ' ')).toEqual([{ text: 'a b c', match: false }])
    expect(countMatches('a b c', ' ')).toBe(0)
    expect(findTableMatches([['a b', 'c d']], ' ')).toEqual([])
    expect(matchCounter(' ', 0, 5)).toBe('0/0')
  })
})
