import { describe, expect, it } from 'vitest'
import {
  MAX_PREPENDED_WORDS,
  MAX_SPACED_GROUPS,
  detectSpacedPathGroups,
  hasSpacedPathHint
} from './spacedPaths'

function alternatives(line: string): string[] {
  const groups = detectSpacedPathGroups(line)
  return groups.length === 0 ? [] : groups[0].alternatives.map((candidate) => candidate.text)
}

describe('detectSpacedPathGroups: unquoted paths with spaces (D75)', () => {
  it('prepends previous words, longest first', () => {
    const found = alternatives('saved to C:\\Users\\Me\\Documents\\My Report.pdf done')
    expect(found[0]).toBe('saved to C:\\Users\\Me\\Documents\\My Report.pdf')
    expect(found).toContain('C:\\Users\\Me\\Documents\\My Report.pdf')
    expect(found).toContain('to C:\\Users\\Me\\Documents\\My Report.pdf')
    expect(found[found.length - 1]).toBe('Report.pdf')
  })

  it('handles Vietnamese names with spaces', () => {
    const found = alternatives('saved to C:\\Users\\Me\\Documents\\Báo cáo tháng 10.pdf done')
    expect(found).toContain('C:\\Users\\Me\\Documents\\Báo cáo tháng 10.pdf')
    expect(found[found.length - 1]).toBe('10.pdf')
  })

  it('handles a relative path with an accented folder', () => {
    expect(alternatives('See docs/Báo cáo.pdf for details')).toContain('docs/Báo cáo.pdf')
  })

  it('handles CJK names with spaces', () => {
    expect(alternatives('See C:\\Docs\\日本語 レポート.pdf now')).toContain(
      'C:\\Docs\\日本語 レポート.pdf'
    )
  })

  it('strips a Read( wrapper from the first word', () => {
    const line = 'Read(C:\\Users\\Me\\Documents\\Bản vẽ\\plan.pdf)'
    const groups = detectSpacedPathGroups(line)
    expect(groups).toHaveLength(1)
    expect(groups[0].alternatives[0].text).toBe('C:\\Users\\Me\\Documents\\Bản vẽ\\plan.pdf')
    expect(groups[0].alternatives[0]).toEqual({
      text: 'C:\\Users\\Me\\Documents\\Bản vẽ\\plan.pdf',
      start: 5,
      end: line.length - 1
    })
  })

  it('reports offsets that slice the line back to the text', () => {
    const line = 'open C:\\My Docs\\plan.pdf now'
    const candidate = detectSpacedPathGroups(line)[0].alternatives[0]
    expect(candidate.text).toBe('open C:\\My Docs\\plan.pdf')
    expect(line.slice(candidate.start, candidate.end)).toBe(candidate.text)
  })

  it('keeps a :12 position suffix', () => {
    expect(alternatives('at C:\\My Docs\\plan.pdf:12 now')[0]).toBe(
      'at C:\\My Docs\\plan.pdf:12'
    )
  })

  it('keeps a (12) position suffix', () => {
    expect(alternatives('at C:\\My Docs\\plan.pdf(12) now')[0]).toBe(
      'at C:\\My Docs\\plan.pdf(12)'
    )
  })

  it('drops trailing sentence punctuation and a closing wrapper', () => {
    expect(alternatives('see C:\\My Docs\\plan.pdf.')[0]).toBe('see C:\\My Docs\\plan.pdf')
    expect(alternatives('see <C:\\My Docs\\plan.pdf>')).toEqual([
      'see <C:\\My Docs\\plan.pdf',
      'C:\\My Docs\\plan.pdf',
      'Docs\\plan.pdf'
    ])
  })

  it('strips parentheses around a single-word path', () => {
    const line = '(C:\\Docs\\plan.pdf)'
    expect(detectSpacedPathGroups(line)[0].alternatives).toEqual([
      { text: 'C:\\Docs\\plan.pdf', start: 1, end: line.length - 1 }
    ])
  })

  it('returns a group whose single-word alternative equals a plain candidate', () => {
    expect(detectSpacedPathGroups('package.json')).toEqual([
      { alternatives: [{ text: 'package.json', start: 0, end: 12 }] }
    ])
  })
})

describe('detectSpacedPathGroups: word runs and caps', () => {
  it('returns no groups without an extension word', () => {
    expect(detectSpacedPathGroups('no files here at all')).toEqual([])
    expect(detectSpacedPathGroups('https://example.com/a/b')).toEqual([])
  })

  it('ends the run at two spaces or a tab', () => {
    expect(alternatives('a  C:\\My Docs\\plan.pdf')).toEqual([
      'C:\\My Docs\\plan.pdf',
      'Docs\\plan.pdf'
    ])
    expect(alternatives('a\tC:\\My Docs\\plan.pdf')).toEqual([
      'C:\\My Docs\\plan.pdf',
      'Docs\\plan.pdf'
    ])
  })

  it('prepends at most MAX_PREPENDED_WORDS words', () => {
    const found = alternatives('one two three four five six seven C:\\Docs\\plan.pdf')
    expect(found[0]).toBe('two three four five six seven C:\\Docs\\plan.pdf')
    expect(found[0].split(' ')).toHaveLength(MAX_PREPENDED_WORDS + 1)
  })

  it('returns at most MAX_SPACED_GROUPS groups', () => {
    const line = Array.from({ length: 50 }, (_, i) => `f${i}.txt`).join(' ')
    expect(detectSpacedPathGroups(line)).toHaveLength(MAX_SPACED_GROUPS)
  })
})

describe('hasSpacedPathHint', () => {
  it('needs both a space and a dot followed by a letter', () => {
    expect(hasSpacedPathHint('C:\\My Docs\\plan.pdf')).toBe(true)
    expect(hasSpacedPathHint('C:\\Docs\\plan.pdf')).toBe(false)
    expect(hasSpacedPathHint('two words')).toBe(false)
    expect(hasSpacedPathHint('')).toBe(false)
  })
})
