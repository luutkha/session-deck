import { describe, expect, it } from 'vitest'
import type { ResolvedLink } from '../../../shared/types'
import { createLinkCache } from './linkCache'

const link: ResolvedLink = { kind: 'file', target: 'C:\\a\\b.txt' }

describe('createLinkCache: get / set / has', () => {
  it('round-trips a resolved link', () => {
    const cache = createLinkCache()
    cache.set('a.txt', link)
    expect(cache.has('a.txt')).toBe(true)
    expect(cache.get('a.txt')).toBe(link)
  })

  it('distinguishes a cached null from an absent entry', () => {
    const cache = createLinkCache()
    cache.set('nope', null)
    expect(cache.has('nope')).toBe(true)
    expect(cache.get('nope')).toBeNull()
    expect(cache.has('other')).toBe(false)
    expect(cache.get('other')).toBeUndefined()
  })

  it('overwrites an existing entry', () => {
    const cache = createLinkCache()
    cache.set('a.txt', null)
    cache.set('a.txt', link)
    expect(cache.get('a.txt')).toBe(link)
  })
})

describe('createLinkCache: TTL', () => {
  it('expires entries once the TTL has elapsed', () => {
    let time = 0
    const cache = createLinkCache(1000, 500, () => time)
    cache.set('a.txt', link)
    time = 999
    expect(cache.get('a.txt')).toBe(link)
    time = 1000
    expect(cache.has('a.txt')).toBe(false)
    expect(cache.get('a.txt')).toBeUndefined()
  })

  it('expires negative entries too', () => {
    let time = 0
    const cache = createLinkCache(1000, 500, () => time)
    cache.set('nope', null)
    time = 1000
    expect(cache.has('nope')).toBe(false)
    expect(cache.get('nope')).toBeUndefined()
  })
})

describe('createLinkCache: maxEntries', () => {
  it('evicts the oldest entry when full', () => {
    const cache = createLinkCache(10_000, 2)
    cache.set('a', link)
    cache.set('b', null)
    cache.set('c', link)
    expect(cache.has('a')).toBe(false)
    expect(cache.has('b')).toBe(true)
    expect(cache.has('c')).toBe(true)
  })

  it('refreshes recency when an entry is overwritten', () => {
    const cache = createLinkCache(10_000, 2)
    cache.set('a', link)
    cache.set('b', link)
    cache.set('a', link)
    cache.set('c', link)
    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
    expect(cache.has('c')).toBe(true)
  })
})
