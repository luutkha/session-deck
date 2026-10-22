// Pure search over palette items. Every token must match; matches are ranked by how the label matches the query.
import type { PaletteGroup, PaletteItem } from './paletteItems'

export const PALETTE_MAX_RESULTS = 50

/** The order the groups are shown in. */
export const PALETTE_GROUP_ORDER: readonly PaletteGroup[] = ['Sessions', 'This session', 'Actions']

export interface PaletteGroupBlock {
  readonly group: PaletteGroup
  readonly items: readonly PaletteItem[]
}

const RANK_LABEL_PREFIX = 0
const RANK_LABEL_CONTAINS = 1
const RANK_OTHER = 2

function tokensOf(query: string): readonly string[] {
  return query.split(/\s+/).filter((token: string): boolean => token !== '')
}

function haystackOf(item: PaletteItem): string {
  return `${item.label} ${item.detail} ${item.keywords}`.toLowerCase()
}

function rankOf(item: PaletteItem, phrase: string): number {
  const label = item.label.toLowerCase()
  if (label.startsWith(phrase)) {
    return RANK_LABEL_PREFIX
  }
  return label.includes(phrase) ? RANK_LABEL_CONTAINS : RANK_OTHER
}

/**
 * Filters and ranks palette items. An empty query returns the items in builder order.
 * Otherwise an item matches when every token is a substring of its label, detail and keywords;
 * a label starting with the whole trimmed query ranks first, then a label containing it, then the rest.
 * Ties keep builder order. The result is capped at `limit`. The input array is never changed.
 */
export function filterPaletteItems(
  items: readonly PaletteItem[],
  query: string,
  limit: number = PALETTE_MAX_RESULTS
): readonly PaletteItem[] {
  const phrase = query.trim().toLowerCase()
  const tokens = tokensOf(phrase)
  if (tokens.length === 0) {
    return items.slice(0, limit)
  }
  const matches = items.filter((item: PaletteItem): boolean => {
    const haystack = haystackOf(item)
    return tokens.every((token: string): boolean => haystack.includes(token))
  })
  return [...matches]
    .sort((a: PaletteItem, b: PaletteItem): number => rankOf(a, phrase) - rankOf(b, phrase))
    .slice(0, limit)
}

/** Splits filtered items into display blocks, in PALETTE_GROUP_ORDER; empty groups are left out. */
export function groupPaletteItems(items: readonly PaletteItem[]): readonly PaletteGroupBlock[] {
  return PALETTE_GROUP_ORDER.map(
    (group: PaletteGroup): PaletteGroupBlock => ({
      group,
      items: items.filter((item: PaletteItem): boolean => item.group === group)
    })
  ).filter((block: PaletteGroupBlock): boolean => block.items.length > 0)
}
