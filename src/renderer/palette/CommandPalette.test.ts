import { describe, expect, it } from 'vitest'
import { EMPTY_PALETTE_GROUPS, paletteGroupsFor } from './CommandPalette'
import { buildPaletteItems, type PaletteInput, type PaletteItem } from './paletteItems'
import { filterPaletteItems, groupPaletteItems } from './paletteFilter'

const input: PaletteInput = {
  sessions: [],
  statuses: [],
  runtime: new Map(),
  activeId: null,
  view: 'terminal',
  mode: 'ops',
  windowRole: 'main',
  codePoppedOut: false
}

const items: readonly PaletteItem[] = buildPaletteItems(input)

describe('paletteGroupsFor', () => {
  it('does no filtering or grouping while closed and reuses one empty list', () => {
    const first = paletteGroupsFor(false, items, 'settings')
    const second = paletteGroupsFor(false, items, 'anything')
    expect(first).toBe(EMPTY_PALETTE_GROUPS)
    expect(second).toBe(first)
    expect(first).toEqual([])
  })

  it('produces the same groups as the old always-on path while open', () => {
    expect(paletteGroupsFor(true, items, '')).toEqual(groupPaletteItems(filterPaletteItems(items, '')))
    expect(paletteGroupsFor(true, items, 'settings')).toEqual(groupPaletteItems(filterPaletteItems(items, 'settings')))
  })

  it('keeps the group order and shows fresh items when reopened', () => {
    const groups = paletteGroupsFor(true, items, '')
    expect(groups.map((block): string => block.group)).toEqual(['Actions'])
    expect(groups[0].items.map((item): string => item.label)).toEqual(items.map((item): string => item.label))

    const changed = items.filter((item: PaletteItem): boolean => item.id !== 'action:new-session')
    expect(paletteGroupsFor(true, changed, '')).not.toEqual(groups)
  })
})
