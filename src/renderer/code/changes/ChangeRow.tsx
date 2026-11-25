import { memo, type KeyboardEvent, type ReactElement } from 'react'
import { Check, Eye, Undo2 } from 'lucide-react'
import type { ChangedFile } from '../../../shared/types'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
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
  /** D60: the commit tick of an uncommitted file; absent = no checkbox (committed already, or no commit box). */
  readonly ticked?: boolean
  readonly onToggleTick?: (path: string) => void
  /** D74: opens the file in the side-panel viewer; absent = no button (deleted file, unknown type, or no session). */
  readonly onOpenViewer?: (path: string) => void
  /** Tree view: nesting level (indents the row) and the folder is left out of the row (the tree shows it). */
  readonly depth?: number
  /** D86: the user marked this file as reviewed; absent = no viewed toggle. */
  readonly viewed?: boolean
  readonly onToggleViewed?: (file: ChangedFile) => void
  /** D86: asks to throw away this file's uncommitted changes; absent = no button (committed already, or not allowed). */
  readonly onDiscard?: (file: ChangedFile) => void
}

const SELECT_KEYS: readonly string[] = ['Enter', ' ']
const OPEN_VIEWER_LABEL = 'Open in viewer'
const TREE_BASE_PADDING_PX = 8
const TREE_INDENT_PX = 14

/** One changed file in the list: kind badge, name (bold), folder (muted), line counts.
 *  Memoized: typing in the commit box re-renders the panel, not the (up to 500) unchanged rows. */
export const ChangeRow = memo(function ChangeRow({ file, selected, onSelect, ticked, onToggleTick, onOpenViewer, depth, viewed, onToggleViewed, onDiscard }: ChangeRowProps): ReactElement {
  const checkable = file.uncommitted === true && onToggleTick !== undefined
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
          data-uncommitted={file.uncommitted === true ? 'true' : undefined}
          data-viewed={viewed === true ? 'true' : undefined}
          onClick={(): void => onSelect(file.path)}
          onKeyDown={onKeyDown}
          style={depth !== undefined ? { paddingLeft: `${String(TREE_BASE_PADDING_PX + depth * TREE_INDENT_PX)}px` } : undefined}
          className={cn('flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-selected:bg-accent', viewed === true && 'opacity-60')}
        >
          {checkable ? (
            <Checkbox
              aria-label={`Commit ${file.path}`}
              data-commit-tick={file.path}
              checked={ticked === true}
              onClick={(event): void => event.stopPropagation()}
              onKeyDown={(event): void => event.stopPropagation()}
              onCheckedChange={(): void => onToggleTick(file.path)}
              className="size-3.5"
            />
          ) : onToggleTick !== undefined ? (
            <span className="inline-block size-3.5 shrink-0" title="Committed (not in the base branch yet)" aria-hidden="true" />
          ) : null}
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
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">{depth === undefined ? dir : null}</span>
          </span>
          {onOpenViewer !== undefined ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`${OPEN_VIEWER_LABEL}: ${file.path}`}
              title={OPEN_VIEWER_LABEL}
              data-open-viewer={file.path}
              className="shrink-0 text-muted-foreground"
              onClick={(event): void => {
                event.stopPropagation()
                onOpenViewer(file.path)
              }}
              onKeyDown={(event): void => event.stopPropagation()}
            >
              <Eye aria-hidden="true" />
            </Button>
          ) : null}
          {onToggleViewed !== undefined ? (
            <Button
              type="button"
              variant={viewed === true ? 'secondary' : 'ghost'}
              size="icon-xs"
              aria-label={viewed === true ? `Mark ${file.path} as not viewed` : `Mark ${file.path} as viewed`}
              aria-pressed={viewed === true}
              title={viewed === true ? 'Viewed (click to unmark)' : 'Mark as viewed'}
              data-viewed-toggle={file.path}
              className="shrink-0 text-muted-foreground"
              onClick={(event): void => {
                event.stopPropagation()
                onToggleViewed(file)
              }}
              onKeyDown={(event): void => event.stopPropagation()}
            >
              <Check aria-hidden="true" />
            </Button>
          ) : null}
          {onDiscard !== undefined ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Discard changes: ${file.path}`}
              title="Discard changes"
              data-discard-file={file.path}
              className="shrink-0 text-muted-foreground hover:text-destructive"
              onClick={(event): void => {
                event.stopPropagation()
                onDiscard(file)
              }}
              onKeyDown={(event): void => event.stopPropagation()}
            >
              <Undo2 aria-hidden="true" />
            </Button>
          ) : null}
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
})
