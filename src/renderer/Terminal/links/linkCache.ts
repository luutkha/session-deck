import type { ResolvedLink } from '../../../shared/types'

/**
 * Small time-bounded cache of link-resolution results, keyed by candidate
 * text. It distinguishes "cached as not a link" (`get` returns `null`) from
 * "not cached at all" (`get` returns `undefined`), so a negative answer is
 * memoized just like a positive one.
 */
export interface LinkCache {
  /** The cached value, `null` for a known non-link, or `undefined` when absent/expired. */
  get(text: string): ResolvedLink | null | undefined
  set(text: string, value: ResolvedLink | null): void
  has(text: string): boolean
}

interface Entry {
  readonly value: ResolvedLink | null
  readonly at: number
}

export function createLinkCache(
  ttlMs = 5000,
  maxEntries = 500,
  now: () => number = Date.now
): LinkCache {
  const entries = new Map<string, Entry>()

  function isFresh(entry: Entry, time: number): boolean {
    return time - entry.at < ttlMs
  }

  return {
    has(text: string): boolean {
      const entry = entries.get(text)
      if (entry === undefined) return false
      if (!isFresh(entry, now())) {
        entries.delete(text)
        return false
      }
      return true
    },
    get(text: string): ResolvedLink | null | undefined {
      const entry = entries.get(text)
      if (entry === undefined) return undefined
      if (!isFresh(entry, now())) {
        entries.delete(text)
        return undefined
      }
      return entry.value
    },
    set(text: string, value: ResolvedLink | null): void {
      if (maxEntries < 1) return
      // Re-insert so the refreshed entry counts as the most recent.
      entries.delete(text)
      entries.set(text, { value, at: now() })
      for (const key of entries.keys()) {
        if (entries.size <= maxEntries) break
        entries.delete(key)
      }
    }
  }
}
