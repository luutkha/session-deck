import { describe, expect, it } from 'vitest'
import { readLineText, type CellLike, type LineLike } from './lineCells'

/** A fake xterm line from [chars, width] pairs (width 0 = the second half of a wide character). */
function lineOf(cells: readonly (readonly [string, number])[], columns = cells.length): LineLike {
  return {
    length: columns,
    getCell: (x: number): CellLike | undefined => {
      const cell = cells[x]
      if (cell === undefined) return { getChars: () => '', getWidth: () => 1 }
      return { getChars: () => cell[0], getWidth: () => cell[1] }
    }
  }
}

const ascii = (text: string): (readonly [string, number])[] => [...text].map((ch): readonly [string, number] => [ch, 1])

describe('readLineText', () => {
  it('maps plain ASCII one to one (1-based columns)', () => {
    const read = readLineText(lineOf(ascii('see a.md')))
    expect(read.text).toBe('see a.md')
    expect(read.startCells).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(read.endCells).toEqual(read.startCells)
  })

  it('a wide character takes two columns and shifts everything after it', () => {
    // "日本 a.md": two wide characters (columns 1-2, 3-4), a space (5), then a.md (6-9)
    const cells: (readonly [string, number])[] = [['日', 2], ['', 0], ['本', 2], ['', 0], [' ', 1], ...ascii('a.md')]
    const read = readLineText(lineOf(cells))
    expect(read.text).toBe('日本 a.md')
    expect(read.startCells).toEqual([1, 3, 5, 6, 7, 8, 9])
    expect(read.endCells).toEqual([2, 4, 5, 6, 7, 8, 9])
  })

  it('a path with a CJK folder ends on its REAL last column (not 7 cells short)', () => {
    const path = 'C:\\Docs\\日本語\\a.pdf'
    const cells: (readonly [string, number])[] = []
    for (const ch of path) {
      const wide = /[\u3000-\u9fff]/.test(ch)
      cells.push([ch, wide ? 2 : 1])
      if (wide) cells.push(['', 0])
    }
    const read = readLineText(lineOf(cells))
    expect(read.text).toBe(path)
    const last = read.text.length - 1
    expect(read.endCells[last]).toBe(path.length + 3) // three wide characters add three extra columns
  })

  it('a combining mark lives in its base cell and adds no column', () => {
    // "é" as e + U+0301 in ONE cell, then "x"
    const read = readLineText(lineOf([['e\u0301', 1], ['x', 1]]))
    expect(read.text).toBe('e\u0301x')
    expect(read.startCells).toEqual([1, 1, 2])
    expect(read.endCells).toEqual([1, 1, 2])
  })

  it('an emoji (a surrogate pair, 2 wide) maps both units to its two columns', () => {
    const read = readLineText(lineOf([['\u{1F600}', 2], ['', 0], ['a', 1]]))
    expect(read.text).toBe('\u{1F600}a')
    expect(read.startCells).toEqual([1, 1, 3])
    expect(read.endCells).toEqual([2, 2, 3])
  })

  it('empty cells inside the line read as spaces, trailing blanks are dropped', () => {
    const read = readLineText(lineOf([['a', 1], ['', 1], ['b', 1], ['', 1], ['', 1]]))
    expect(read.text).toBe('a b')
    expect(read.startCells).toEqual([1, 2, 3])
  })

  it('an empty line gives empty text', () => {
    expect(readLineText(lineOf([], 0)).text).toBe('')
    expect(readLineText(lineOf([['', 1], ['', 1]])).text).toBe('')
  })

  it('stops at a missing cell instead of throwing', () => {
    const line: LineLike = { length: 5, getCell: (x) => (x < 2 ? { getChars: () => 'ab'[x] ?? '', getWidth: () => 1 } : undefined) }
    expect(readLineText(line).text).toBe('ab')
  })
})
