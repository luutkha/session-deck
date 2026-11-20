import { describe, expect, it } from 'vitest'
import { detectDelimiter, parseCsv } from './csv'

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

describe('detectDelimiter', () => {
  it('keeps a comma file on commas', () => {
    expect(detectDelimiter('name,score\nalpha,1\nbeta,2\n')).toBe(',')
  })

  it('picks the semicolon of a European export and does not split decimal commas', () => {
    const text = 'name;price;note\nalpha;1,5;ok\nbeta;2,5;ok\n'
    expect(detectDelimiter(text)).toBe(';')
    expect(parseCsv(text, ';').rows[1]).toEqual(['alpha', '1,5', 'ok'])
  })

  it('picks a pipe', () => {
    expect(detectDelimiter('name|score\nalpha|1\nbeta|2\n')).toBe('|')
  })

  it('picks a tab', () => {
    expect(detectDelimiter('name\tscore\nalpha\t1\nbeta\t2\n')).toBe('\t')
  })

  it('ignores delimiters inside quoted cells', () => {
    // A comma inside a quoted cell of a semicolon file must not become a separator...
    expect(detectDelimiter('"a,b";c\n"d,e";f\n')).toBe(';')
    // ...and a semicolon inside a quoted cell of a comma file must not either.
    expect(detectDelimiter('"a;b",c\n"d;e",f\n')).toBe(',')
  })

  it('ignores a comma inside a quoted field of a single-column file', () => {
    expect(detectDelimiter('"a,b"\n"c,d"\n')).toBe(',')
  })

  it('falls back to a comma for a single-column file', () => {
    expect(detectDelimiter('alpha\nbeta\ngamma\n')).toBe(',')
  })

  it('falls back to a comma for empty text', () => {
    expect(detectDelimiter('')).toBe(',')
  })

  it('looks past a title row that has fewer fields', () => {
    // The title row alone would look single-column for the semicolon; the rows below decide.
    const text = 'Quarterly report\nname;price\nA;1\nB;2\n'
    expect(detectDelimiter(text)).toBe(';')
  })

  it('skips blank lines and stops after 20 non-empty ones', () => {
    const rows = Array.from({ length: 30 }, (_, index) => `a${index};b${index}`).join('\r\n')
    expect(detectDelimiter(`\r\n\r\n${rows}\r\n\r\n`)).toBe(';')
  })

  it('prefers a comma over a semicolon when both fit the same number of lines', () => {
    // Ambiguous by design: 'a,b;c' gives 2 fields on one line for either delimiter.
    expect(detectDelimiter('a,b;c\nd,e;f\n')).toBe(',')
  })
})
