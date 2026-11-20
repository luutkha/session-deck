import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv'

describe('parseCsv', () => {
  it('splits comma rows and drops the trailing empty row of a final line break', () => {
    expect(parseCsv('a,b\n1,2\n', ',')).toEqual({ rows: [['a', 'b'], ['1', '2']], truncated: false })
  })

  it('keeps a quoted comma and an embedded newline in one cell', () => {
    const table = parseCsv('"a,b","line1\nline2"', ',')
    expect(table.rows).toEqual([['a,b', 'line1\nline2']])
    expect(table.truncated).toBe(false)
  })

  it('unescapes doubled quotes', () => {
    expect(parseCsv('"say ""hi""",plain', ',').rows).toEqual([['say "hi"', 'plain']])
  })

  it('handles CRLF line breaks', () => {
    expect(parseCsv('a,b\r\n1,2\r\n', ',')).toEqual({ rows: [['a', 'b'], ['1', '2']], truncated: false })
  })

  it('uses a tab delimiter for tsv and keeps a quoted tab in its cell', () => {
    expect(parseCsv('a\tb\n"x\ty"\t2', '\t').rows).toEqual([['a', 'b'], ['x\ty', '2']])
  })

  it('strips a leading BOM', () => {
    expect(parseCsv('\uFEFFa,b', ',').rows).toEqual([['a', 'b']])
  })

  it('treats a blank line as a row with one empty cell', () => {
    expect(parseCsv('a\n\nb', ',').rows).toEqual([['a'], [''], ['b']])
  })

  it('returns no rows for empty text', () => {
    expect(parseCsv('', ',')).toEqual({ rows: [], truncated: false })
  })

  it('cuts rows at the row cap and flags it', () => {
    const table = parseCsv('1\n2\n3\n', ',', 2, 50)
    expect(table.rows).toEqual([['1'], ['2']])
    expect(table.truncated).toBe(true)
  })

  it('does not flag truncation when the rows exactly fill the cap', () => {
    expect(parseCsv('1\n2\n', ',', 2, 50)).toEqual({ rows: [['1'], ['2']], truncated: false })
  })

  it('cuts columns at the column cap and flags it', () => {
    const table = parseCsv('a,b,c\nd,e,f\n', ',', 50, 2)
    expect(table.rows).toEqual([['a', 'b'], ['d', 'e']])
    expect(table.truncated).toBe(true)
  })

  it('keeps a quote inside an unquoted field as a literal character', () => {
    expect(parseCsv('say "hi",x', ',').rows).toEqual([['say "hi"', 'x']])
  })
})
