import { describe, expect, it } from 'vitest'
import { detectDelimiter, parseCsv } from './csv'

function viewAsFile(text: string): readonly (readonly string[])[] {
  return parseCsv(text, detectDelimiter(text)).rows
}

describe('detectDelimiter with quoted decimal commas (European Excel exports)', () => {
  it('a headerless semicolon file whose cells hold quoted decimal commas is NOT read as comma separated', () => {
    const text = '1;"1,5"\n2;"2,5"\n'
    expect(detectDelimiter(text)).toBe(';')
    expect(viewAsFile(text)).toEqual([['1', '1,5'], ['2', '2,5']])
  })

  it('a header plus quoted comma cells', () => {
    const text = 'name;note;score\nalpha;"a, b";1\nbeta;"c, d";2\n'
    expect(detectDelimiter(text)).toBe(';')
    expect(viewAsFile(text)).toEqual([['name', 'note', 'score'], ['alpha', 'a, b', '1'], ['beta', 'c, d', '2']])
  })

  it('three columns, no header', () => {
    const text = '1;"a, b";x\n2;"c, d";y\n3;"e, f";z\n'
    expect(viewAsFile(text)).toEqual([['1', 'a, b', 'x'], ['2', 'c, d', 'y'], ['3', 'e, f', 'z']])
  })

  it('a quoted cell with a comma AND a line break', () => {
    const text = '1;"aaa, bbb\nccc";x\n2;"ddd, eee\nfff";y\n'
    expect(detectDelimiter(text)).toBe(';')
    expect(viewAsFile(text)).toEqual([['1', 'aaa, bbb\nccc', 'x'], ['2', 'ddd, eee\nfff', 'y']])
  })

  it('a header, then multi-line quoted cells', () => {
    const text = 'id;note\n1;"aaa, bbb\nccc"\n2;"ddd, eee\nfff"\n'
    expect(detectDelimiter(text)).toBe(';')
    expect(viewAsFile(text)).toEqual([['id', 'note'], ['1', 'aaa, bbb\nccc'], ['2', 'ddd, eee\nfff']])
  })
})

describe('detectDelimiter keeps working for ordinary files', () => {
  it('a comma file with quoted cells stays comma', () => {
    const text = 'a,b,c\n1,"x, y",3\n4,"z",6\n'
    expect(detectDelimiter(text)).toBe(',')
    expect(viewAsFile(text)).toEqual([['a', 'b', 'c'], ['1', 'x, y', '3'], ['4', 'z', '6']])
  })

  it('a comma file whose unquoted cells contain a quote still reads as comma separated', () => {
    const text = 'size,note\n5" pipe,ok\n6" pipe,fine\n'
    expect(detectDelimiter(text)).toBe(',')
  })

  it('a pipe file and a tab file are still detected', () => {
    expect(detectDelimiter('a|b|c\n1|2|3\n')).toBe('|')
    expect(detectDelimiter('a\tb\tc\n1\t2\t3\n')).toBe('\t')
  })
})
