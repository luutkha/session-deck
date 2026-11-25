import { useMemo, useState, type ReactElement } from 'react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '../components/ui/command'
import { filterPaletteItems, groupPaletteItems, type PaletteGroupBlock } from './paletteFilter'
import type { PaletteCommand, PaletteItem } from './paletteItems'

export interface CommandPaletteProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly items: readonly PaletteItem[]
  readonly onRun: (command: PaletteCommand) => void
}

const EMPTY_TEXT = 'No matches.'
const PLACEHOLDER = 'Search sessions and actions…'

/** Shared result for a closed palette: filtering/grouping it on every render would allocate for nothing. */
export const EMPTY_PALETTE_GROUPS: readonly PaletteGroupBlock[] = Object.freeze([])

/** Pure seam: group only while open. A reopen starts from an empty query and the items built at that moment. */
export function paletteGroupsFor(
  open: boolean,
  items: readonly PaletteItem[],
  query: string
): readonly PaletteGroupBlock[] {
  return open ? groupPaletteItems(filterPaletteItems(items, query)) : EMPTY_PALETTE_GROUPS
}

function PaletteRow({ item, onChoose }: { readonly item: PaletteItem; readonly onChoose: (item: PaletteItem) => void }): ReactElement {
  return (
    <CommandItem value={item.id} onSelect={(): void => onChoose(item)} className="gap-3">
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      <span className="shrink-0 truncate text-xs text-muted-foreground">{item.detail}</span>
    </CommandItem>
  )
}

/** The Orca-style command palette: type to filter, Up/Down and Enter (or click) to run. Filtering is ours, not cmdk's. */
export function CommandPalette({ open, onOpenChange, items, onRun }: CommandPaletteProps): ReactElement {
  const [query, setQuery] = useState('')

  // Every opening starts with an empty query: closing (Escape, click outside, or a chosen item) clears it.
  // Clearing on close, not in an effect on open, means a reopened palette never paints the old query.
  const setOpen = (next: boolean): void => {
    if (!next) {
      setQuery('')
    }
    onOpenChange(next)
  }

  const groups = useMemo(
    (): readonly PaletteGroupBlock[] => paletteGroupsFor(open, items, query),
    [open, items, query]
  )

  const choose = (item: PaletteItem): void => {
    onRun(item.run)
    setOpen(false)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      shouldFilter={false}
      title="Command palette"
      description="Jump to a session or run an action"
    >
      <CommandInput placeholder={PLACEHOLDER} value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>{EMPTY_TEXT}</CommandEmpty>
        {groups.map((block: PaletteGroupBlock) => (
          <CommandGroup key={block.group} heading={block.group}>
            {block.items.map((item: PaletteItem) => (
              <PaletteRow key={item.id} item={item} onChoose={choose} />
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  )
}
