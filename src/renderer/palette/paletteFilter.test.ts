import { describe, expect, it } from 'vitest'
import {
  filterPaletteItems,
  groupPaletteItems,
  PALETTE_MAX_RESULTS,
  type PaletteGroupBlock
} from './paletteFilter'
import type { PaletteCommand, PaletteItem } from './paletteItems'

const NEW_SESSION: PaletteCommand = { kind: 'new-session' }

function item(id: string, label: string, detail = '', keywords = ''): PaletteItem {
  return { id, group: 'Actions', label, detail, keywords, run: NEW_SESSION }
}

function ids(items: readonly PaletteItem[]): string[] {
  return items.map((entry: PaletteItem): string => entry.id)
}

const SAMPLE: readonly PaletteItem[] = [
  item('1', 'Build pipeline', 'app · Working', 'ci deploy'),
  item('2', 'Docs site', 'web · Done', 'readme'),
  item('3', 'Fix build error', 'app · Needs you', 'bug'),
  item('4', 'Settings', 'Sound', 'preferences')
]

describe('filterPaletteItems: empty query', () => {
  it('returns every item in builder order when the query is empty', () => {
    expect(ids(filterPaletteItems(SAMPLE, ''))).toEqual(['1', '2', '3', '4'])
  })

  it('treats a query of only spaces as empty', () => {
    expect(ids(filterPaletteItems(SAMPLE, '   \t '))).toEqual(['1', '2', '3', '4'])
  })

  it('returns nothing for an empty item list', () => {
    expect(filterPaletteItems([], 'anything')).toEqual([])
  })
})

describe('filterPaletteItems: matching', () => {
  it('matches case-insensitively', () => {
    expect(ids(filterPaletteItems(SAMPLE, 'DOCS'))).toEqual(['2'])
  })

  it('requires every whitespace-separated token to match somewhere in label, detail or keywords', () => {
    expect(ids(filterPaletteItems(SAMPLE, 'app needs'))).toEqual(['3'])
  })

  it('matches text in the detail', () => {
    expect(ids(filterPaletteItems(SAMPLE, 'done'))).toEqual(['2'])
  })

  it('matches text in the keywords', () => {
    expect(ids(filterPaletteItems(SAMPLE, 'preferences'))).toEqual(['4'])
  })

  it('matches a token that is a substring of a word', () => {
    expect(ids(filterPaletteItems(SAMPLE, 'pipe'))).toEqual(['1'])
  })

  it('returns nothing when one token has no match', () => {
    expect(filterPaletteItems(SAMPLE, 'docs zzz')).toEqual([])
  })

  it('ignores extra spaces between tokens and around the query', () => {
    expect(ids(filterPaletteItems(SAMPLE, '  fix    build  '))).toEqual(['3'])
  })
})

describe('filterPaletteItems: ranking', () => {
  it('ranks a label that starts with the whole query first, then a label that contains it, then the rest', () => {
    const items = [
      item('rest', 'Other', 'build here'),
      item('contains', 'Fix build error'),
      item('starts', 'Build pipeline')
    ]
    expect(ids(filterPaletteItems(items, 'build'))).toEqual(['starts', 'contains', 'rest'])
  })

  it('keeps builder order inside one rank', () => {
    const items = [item('a', 'Alpha beta'), item('b', 'Alpha gamma'), item('c', 'Alpha delta')]
    expect(ids(filterPaletteItems(items, 'alpha'))).toEqual(['a', 'b', 'c'])
  })

  it('uses the trimmed whole query for the label-prefix rank', () => {
    const items = [item('loose', 'Open the hub'), item('prefix', 'Open Hub')]
    expect(ids(filterPaletteItems(items, '  open hub '))).toEqual(['prefix', 'loose'])
  })
})

describe('filterPaletteItems: limit', () => {
  it('caps the result at PALETTE_MAX_RESULTS by default', () => {
    const many = Array.from({ length: PALETTE_MAX_RESULTS + 10 }, (_unused, index: number): PaletteItem =>
      item(`n${index}`, `Session ${index}`)
    )
    expect(filterPaletteItems(many, '')).toHaveLength(PALETTE_MAX_RESULTS)
    expect(filterPaletteItems(many, 'session')).toHaveLength(PALETTE_MAX_RESULTS)
  })

  it('caps at an explicit limit', () => {
    expect(ids(filterPaletteItems(SAMPLE, '', 2))).toEqual(['1', '2'])
  })

  it('keeps the highest ranked items when capping', () => {
    const items = [item('rest', 'Other', 'build'), item('starts', 'Build now')]
    expect(ids(filterPaletteItems(items, 'build', 1))).toEqual(['starts'])
  })

  it('uses 50 as the default cap', () => {
    expect(PALETTE_MAX_RESULTS).toBe(50)
  })
})

describe('groupPaletteItems', () => {
  it('orders the groups Sessions, This session, Actions and keeps the item order inside each', () => {
    const items: PaletteItem[] = [
      { ...item('a1', 'Action one'), group: 'Actions' },
      { ...item('s1', 'Session one'), group: 'Sessions' },
      { ...item('t1', 'This one'), group: 'This session' },
      { ...item('s2', 'Session two'), group: 'Sessions' }
    ]
    const groups = groupPaletteItems(items)
    expect(groups.map((group: PaletteGroupBlock): string => group.group)).toEqual([
      'Sessions',
      'This session',
      'Actions'
    ])
    expect(ids(groups[0]?.items ?? [])).toEqual(['s1', 's2'])
  })

  it('leaves out groups with no items', () => {
    const groups = groupPaletteItems([item('a1', 'Action one')])
    expect(groups.map((group: PaletteGroupBlock): string => group.group)).toEqual(['Actions'])
  })

  it('returns no groups for no items', () => {
    expect(groupPaletteItems([])).toEqual([])
  })
})

describe('filterPaletteItems: immutability', () => {
  it('does not change the input array', () => {
    const copy = [...SAMPLE]
    filterPaletteItems(SAMPLE, 'build')
    expect(SAMPLE).toEqual(copy)
  })
})
