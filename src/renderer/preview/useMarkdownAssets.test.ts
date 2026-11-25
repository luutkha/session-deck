// W4-E: the markdown image cache keeps its count limit and adds a total byte budget with LRU eviction.
import { describe, expect, it } from 'vitest'
import { cachedAsset, storeAsset } from './useMarkdownAssets'

describe('cachedAsset', () => {
  it('returns the data URL and makes the entry the most recently used one', () => {
    const entries = new Map([
      ['a.png', 'A'],
      ['b.png', 'B']
    ])
    expect(cachedAsset(entries, 'a.png')).toBe('A')
    expect([...entries.keys()]).toEqual(['b.png', 'a.png'])
    expect(cachedAsset(entries, 'missing.png')).toBeUndefined()
  })
})

describe('storeAsset', () => {
  it('keeps the count limit with injected limits', () => {
    const entries = new Map<string, string>()
    const limits = { maxImages: 2, maxBytes: 1000 }
    storeAsset(entries, 'a.png', 'AAAA', limits)
    storeAsset(entries, 'b.png', 'BBBB', limits)
    storeAsset(entries, 'c.png', 'CCCC', limits)
    expect([...entries.keys()]).toEqual(['b.png', 'c.png'])
    expect([...entries.values()].reduce((sum, value) => sum + value.length, 0)).toBe(8)
  })

  it('evicts least-recently-used images until the total string length fits the budget', () => {
    const entries = new Map<string, string>()
    const limits = { maxImages: 10, maxBytes: 10 }
    storeAsset(entries, 'a.png', 'AAAA', limits)
    storeAsset(entries, 'b.png', 'BBBB', limits)
    storeAsset(entries, 'c.png', 'CCCC', limits)
    expect([...entries.keys()]).toEqual(['b.png', 'c.png'])
    // A hit refreshes recency, so the next eviction drops the other old entry.
    expect(cachedAsset(entries, 'b.png')).toBe('BBBB')
    storeAsset(entries, 'd.png', 'DDDD', limits)
    expect([...entries.keys()]).toEqual(['b.png', 'd.png'])
    expect([...entries.values()].reduce((sum, value) => sum + value.length, 0)).toBe(8)
  })

  it('replacing one image does not evict a neighbour that still fits', () => {
    const entries = new Map([
      ['a.png', 'A'],
      ['b.png', 'B']
    ])
    storeAsset(entries, 'a.png', 'AAA', { maxImages: 2, maxBytes: 4 })
    expect([...entries.entries()]).toEqual([
      ['b.png', 'B'],
      ['a.png', 'AAA']
    ])
  })

  it('never caches a single data URL bigger than the budget, but keeps smaller entries', () => {
    const entries = new Map<string, string>()
    const limits = { maxImages: 4, maxBytes: 6 }
    storeAsset(entries, 'a.png', 'AAAA', limits)
    storeAsset(entries, 'huge.png', 'HHHHHHHHHH', limits)
    expect([...entries.entries()]).toEqual([['a.png', 'AAAA']])
  })

  it('handles a zero budget and an evicted image reloading on the next store', () => {
    const entries = new Map<string, string>()
    storeAsset(entries, 'a.png', 'AAAA', { maxImages: 4, maxBytes: 0 })
    expect(entries.size).toBe(0)
    storeAsset(entries, 'a.png', 'AAAA', { maxImages: 4, maxBytes: 4 })
    expect(entries.get('a.png')).toBe('AAAA')
  })
})
