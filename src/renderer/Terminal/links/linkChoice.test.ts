import { describe, expect, it } from 'vitest'
import type { LinkCandidate } from './detectLinks'
import {
  MAX_RESOLVE_TEXTS,
  chooseLinks,
  collectResolveTexts,
  type LinkResolution
} from './linkChoice'
import type { SpacedGroup } from './spacedPaths'

function candidate(text: string, start: number): LinkCandidate {
  return { text, start, end: start + text.length }
}

function group(line: string, texts: readonly string[]): SpacedGroup {
  return { alternatives: texts.map((text) => candidate(text, line.indexOf(text))) }
}

function resolving(...texts: string[]): LinkResolution {
  const known = new Set(texts)
  return (text) => (known.has(text) ? { kind: 'file', target: text } : null)
}

function texts(candidates: readonly LinkCandidate[]): string[] {
  return candidates.map((candidate) => candidate.text)
}

const LINE = 'saved to C:\\My Docs\\report.pdf'
const PLAIN = [candidate('report.pdf', LINE.indexOf('report.pdf'))]
const GROUP = group(LINE, [
  'saved to C:\\My Docs\\report.pdf',
  'to C:\\My Docs\\report.pdf',
  'C:\\My Docs\\report.pdf',
  'report.pdf'
])

describe('chooseLinks', () => {
  it('takes the longest alternative that resolved', () => {
    const chosen = chooseLinks(
      PLAIN,
      [GROUP],
      resolving('saved to C:\\My Docs\\report.pdf', 'C:\\My Docs\\report.pdf')
    )
    expect(texts(chosen)).toEqual(['saved to C:\\My Docs\\report.pdf'])
  })

  it('falls back to the next alternative when the longest does not exist', () => {
    const chosen = chooseLinks(PLAIN, [GROUP], resolving('C:\\My Docs\\report.pdf'))
    expect(texts(chosen)).toEqual(['C:\\My Docs\\report.pdf'])
  })

  it('suppresses plain fragments that overlap the winner', () => {
    const line = 'See docs/Báo cáo.pdf for details'
    const plain = [candidate('cáo.pdf', line.indexOf('cáo.pdf'))]
    const groups = [group(line, ['See docs/Báo cáo.pdf', 'docs/Báo cáo.pdf', 'cáo.pdf'])]
    expect(texts(chooseLinks(plain, groups, resolving('docs/Báo cáo.pdf')))).toEqual([
      'docs/Báo cáo.pdf'
    ])
  })

  it('keeps the plain candidates when every alternative failed', () => {
    expect(chooseLinks(PLAIN, [GROUP], resolving())).toEqual(PLAIN)
  })

  it('keeps one link when the winner is the plain candidate itself', () => {
    const line = 'a package.json'
    const plain = [candidate('package.json', 2)]
    const groups = [group(line, ['a package.json', 'package.json'])]
    expect(texts(chooseLinks(plain, groups, resolving('package.json')))).toEqual(['package.json'])
  })

  it('handles two groups on one line', () => {
    const line = 'a b.pdf c d.txt'
    const plain = [candidate('b.pdf', 2), candidate('d.txt', 10)]
    const groups = [group(line, ['a b.pdf', 'b.pdf']), group(line, ['c d.txt', 'd.txt'])]
    expect(texts(chooseLinks(plain, groups, resolving('b.pdf', 'd.txt')))).toEqual([
      'b.pdf',
      'd.txt'
    ])
  })

  it('never lets the winners of two groups overlap', () => {
    const line = 'a b.pdf c d.txt'
    const groups = [
      group(line, ['a b.pdf', 'b.pdf']),
      group(line, ['b.pdf c d.txt', 'c d.txt', 'd.txt'])
    ]
    const chosen = chooseLinks([], groups, resolving('b.pdf', 'b.pdf c d.txt', 'd.txt'))
    expect(texts(chosen)).toEqual(['b.pdf', 'd.txt'])
    expect(chosen[0].end).toBeLessThanOrEqual(chosen[1].start)
  })
})

describe('collectResolveTexts', () => {
  it('puts plain candidates first, then alternatives longest first, deduplicated', () => {
    const line = 'a b.pdf c d.txt'
    const plain = [candidate('b.pdf', 2)]
    const groups = [
      group(line, ['a b.pdf', 'b.pdf']),
      group(line, ['c d.txt', 'b.pdf c d.txt', 'd.txt'])
    ]
    expect(collectResolveTexts(plain, groups, 4)).toEqual([
      'b.pdf',
      'a b.pdf',
      'c d.txt',
      'b.pdf c d.txt'
    ])
  })

  it('caps the batch at MAX_RESOLVE_TEXTS', () => {
    const groups = Array.from({ length: 40 }, (_, g) => ({
      alternatives: Array.from({ length: 7 }, (_, i) => candidate(`g${g}w${i}.txt`, 0))
    }))
    expect(collectResolveTexts([], groups)).toHaveLength(MAX_RESOLVE_TEXTS)
  })
})
