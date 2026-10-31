// The "Presets" menu of the New Session dialog (D49): pick one to fill the form, or delete one.
import { Bookmark, ChevronDown, Trash2 } from 'lucide-react'
import type { ReactElement } from 'react'
import type { SessionPreset } from '../../shared/types'
import { Button } from '../components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '../components/ui/dropdown-menu'
import { presetDetail } from './presetLogic'

export interface PresetMenuProps {
  readonly presets: readonly SessionPreset[]
  readonly disabled: boolean
  readonly onApply: (preset: SessionPreset) => void
  readonly onRemove: (preset: SessionPreset) => void
}

export function PresetMenu({ presets, disabled, onApply, onRemove }: PresetMenuProps): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="xs" disabled={disabled || presets.length === 0} className="text-xs" data-preset-menu="">
          <Bookmark className="size-3.5" aria-hidden="true" />
          {presets.length === 0 ? 'No presets yet' : 'Presets'}
          <ChevronDown className="size-3" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[14rem]">
        <DropdownMenuLabel className="text-[11px] text-muted-foreground">Fill the form from</DropdownMenuLabel>
        {presets.map((preset) => (
          <DropdownMenuItem key={preset.id} data-preset-item={preset.name} onSelect={(): void => onApply(preset)}>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-xs">{preset.name}</span>
              <span className="truncate text-[11px] text-muted-foreground">{presetDetail(preset)}</span>
            </div>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-xs">
            <Trash2 className="size-3.5" aria-hidden="true" />
            Delete a preset
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {presets.map((preset) => (
              <DropdownMenuItem key={preset.id} data-preset-delete={preset.name} className="text-xs" onSelect={(): void => onRemove(preset)}>
                {preset.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
