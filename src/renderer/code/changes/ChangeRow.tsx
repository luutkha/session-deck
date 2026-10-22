import type { KeyboardEvent, ReactElement } from 'react'
import type { ChangedFile } from '../../../shared/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip'
import { cn } from '../../lib/utils'
import {
  changeTooltip,
  fileCountsLabel,
  kindBadgeClass,
  kindLabel,
  kindLetter,
  splitPath
} from './changesFormat'

export interface ChangeRowProps {
  readonly file: ChangedFile
  readonly selected: boolean
  readonly onSelect: (path: string) => void
}

const SELECT_KEYS: readonly string[] = ['Enter', ' ']

/** One changed file in the list: kind badge, name (bold), folder (muted), line counts. */
export function ChangeRow({ file, selected, onSelect }: ChangeRowProps): ReactElement {
  const { dir, name } = splitPath(file.path)
  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>): void => {
    if (!SELECT_KEYS.includes(event.key)) return
    event.preventDefault()
    onSelect(file.path)
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <li
          role="option"
          aria-selected={selected}
          tabIndex={0}
          data-change-path={file.path}
          onClick={(): void => onSelect(file.path)}
          onKeyDown={onKeyDown}
          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-selected:bg-accent"
        >
          <span
            title={kindLabel(file.kind)}
            className={cn(
              'inline-flex size-4 shrink-0 items-center justify-center rounded text-[10px] font-semibold',
              kindBadgeClass(file.kind)
            )}
          >
            {kindLetter(file.kind)}
          </span>
          <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
            <span className="shrink-0 font-semibold text-foreground">{name}</span>
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">{dir}</span>
          </span>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
            {fileCountsLabel(file)}
          </span>
        </li>
      </TooltipTrigger>
      <TooltipContent side="left" sideOffset={6}>
        {changeTooltip(file)}
      </TooltipContent>
    </Tooltip>
  )
}
