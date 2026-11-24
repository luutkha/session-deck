import { describe, expect, it } from 'vitest'
import { pairLines } from './sideBySide'
import type { DiffLine } from './parseUnifiedDiff'

function context(text: string, oldNo: number, newNo: number): DiffLine {
  return { kind: 'context', text, oldNo, newNo }
}

function del(text: string, oldNo: number): DiffLine {
  return { kind: 'del', text, oldNo, newNo: null }
}

function add(text: string, newNo: number): DiffLine {
  return { kind: 'add', text, oldNo: null, newNo }
}

function hunk(text: string): DiffLine {
  return { kind: 'hunk', text, oldNo: null, newNo: null }
}

describe('pairLines', () => {
  it('returns no rows for an empty diff', () => {
    expect(pairLines([])).toEqual([])
  })

  it('puts a context line on both sides', () => {
    const line = context('keep', 3, 3)
    expect(pairLines([line])).toEqual([{ kind: 'pair', left: line, right: line }])
  })

  it('pairs equal deletion and addition runs index by index', () => {
    const oldA = del('old a', 4)
    const oldB = del('old b', 5)
    const newA = add('new a', 4)
    const newB = add('new b', 5)
    expect(pairLines([oldA, oldB, newA, newB])).toEqual([
      { kind: 'pair', left: oldA, right: newA },
      { kind: 'pair', left: oldB, right: newB }
    ])
  })

  it('leaves the right side empty when there are more deletions than additions', () => {
    const oldA = del('old a', 4)
    const oldB = del('old b', 5)
    const newA = add('new a', 4)
    expect(pairLines([oldA, oldB, newA])).toEqual([
      { kind: 'pair', left: oldA, right: newA },
      { kind: 'pair', left: oldB, right: null }
    ])
  })

  it('leaves the left side empty when there are more additions than deletions', () => {
    const oldA = del('old a', 4)
    const newA = add('new a', 4)
    const newB = add('new b', 5)
    expect(pairLines([oldA, newA, newB])).toEqual([
      { kind: 'pair', left: oldA, right: newA },
      { kind: 'pair', left: null, right: newB }
    ])
  })

  it('shows a lone addition on the right only', () => {
    const newA = add('new a', 7)
    expect(pairLines([newA])).toEqual([{ kind: 'pair', left: null, right: newA }])
  })

  it('shows a lone deletion on the left only', () => {
    const oldA = del('old a', 7)
    expect(pairLines([oldA])).toEqual([{ kind: 'pair', left: oldA, right: null }])
  })

  it('spans a hunk header across both columns', () => {
    const header = hunk('@@ -1,2 +1,2 @@')
    expect(pairLines([header])).toEqual([{ kind: 'full', line: header }])
  })

  it('does not pair a deletion run with additions after a context line', () => {
    const oldA = del('old a', 4)
    const kept = context('keep', 5, 4)
    const newA = add('new a', 5)
    expect(pairLines([oldA, kept, newA])).toEqual([
      { kind: 'pair', left: oldA, right: null },
      { kind: 'pair', left: kept, right: kept },
      { kind: 'pair', left: null, right: newA }
    ])
  })
})
