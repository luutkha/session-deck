import { useEffect, useState, type ReactElement } from 'react'
import { ArrowLeft, LoaderCircle, RefreshCw } from 'lucide-react'
import type { ChangedFile, Id, WorktreeChanges } from '../../../shared/types'
import { Button } from '../../components/ui/button'
import { ScrollArea } from '../../components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip'
import { cn } from '../../lib/utils'
import { ChangeRow } from './ChangeRow'
import { DiffView } from './DiffView'
import { countsLabel } from './changesFormat'
import { isStillChanged } from './changesState'
import { useWorktreeChanges, type WorktreeChangesResult } from './useWorktreeChanges'
import { useWorktreeFileDiff } from './useWorktreeFileDiff'

export interface ChangesPanelProps {
  readonly worktreeId: Id
  readonly className?: string
}

interface Selection {
  readonly worktreeId: Id
  readonly path: string
}

const TOOLTIP_DELAY_MS = 300
const HEADER_TITLE_IDLE = 'Changes'
const HEADER_TITLE_LOADING = 'Loading changes...'
const REFRESH_LABEL = 'Refresh changes'
const BACK_LABEL = 'All files'
const NO_CHANGES_YET = 'No changes yet.'

function PanelMessage({ text, failed }: { readonly text: string; readonly failed: boolean }): ReactElement {
  return (
    <p
      role={failed ? 'alert' : undefined}
      className={cn('px-3 py-3 text-xs', failed ? 'text-destructive' : 'text-muted-foreground')}
    >
      {text}
    </p>
  )
}

function RefreshButton({ loading, onRefresh }: { readonly loading: boolean; readonly onRefresh: () => void }): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={REFRESH_LABEL} onClick={onRefresh}>
          {loading ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        {REFRESH_LABEL}
      </TooltipContent>
    </Tooltip>
  )
}

interface PanelHeaderProps {
  readonly title: string
  readonly selectedPath: string | null
  readonly loading: boolean
  readonly onBack: () => void
  readonly onRefresh: () => void
}

function PanelHeader({ title, selectedPath, loading, onBack, onRefresh }: PanelHeaderProps): ReactElement {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
      {selectedPath === null ? (
        <span className="truncate px-1 text-xs text-muted-foreground">{title}</span>
      ) : (
        <div className="flex min-w-0 items-center gap-1">
          <Button type="button" variant="ghost" size="xs" onClick={onBack}>
            <ArrowLeft aria-hidden="true" />
            {BACK_LABEL}
          </Button>
          <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{selectedPath}</span>
        </div>
      )}
      <RefreshButton loading={loading} onRefresh={onRefresh} />
    </div>
  )
}

interface ChangesBodyProps {
  readonly list: WorktreeChangesResult
  readonly onSelect: (path: string) => void
}

function fileRows(
  changes: WorktreeChanges,
  onSelect: (path: string) => void
): ReactElement {
  return (
    <ul role="listbox" aria-label="Changed files" className="flex flex-col gap-0.5 p-1">
      {changes.files.map((file: ChangedFile): ReactElement => (
        <ChangeRow key={file.path} file={file} selected={false} onSelect={onSelect} />
      ))}
    </ul>
  )
}

function headerTitle(list: WorktreeChangesResult): string {
  if (list.changes !== null) return countsLabel(list.changes)
  return list.loading ? HEADER_TITLE_LOADING : HEADER_TITLE_IDLE
}

/** The file list, or the message that replaces it (IPC failure, git problem, no files). */
function ChangesBody({ list, onSelect }: ChangesBodyProps): ReactElement {
  const { changes } = list
  if (changes === null) {
    return list.error !== null ? (
      <PanelMessage text={list.error} failed />
    ) : (
      <PanelMessage text={HEADER_TITLE_LOADING} failed={false} />
    )
  }
  if (changes.error !== undefined) {
    return <PanelMessage text={changes.error} failed />
  }
  if (changes.files.length === 0) {
    return <PanelMessage text={NO_CHANGES_YET} failed={false} />
  }
  return (
    <ScrollArea className="min-h-0 flex-1">
      {list.error !== null ? <PanelMessage text={list.error} failed /> : null}
      {fileRows(changes, onSelect)}
    </ScrollArea>
  )
}

/** Changed files of one worktree; a click opens that file's read-only diff in place of the list. */
export function ChangesPanel({ worktreeId, className }: ChangesPanelProps): ReactElement {
  const list = useWorktreeChanges(worktreeId)
  const [selection, setSelection] = useState<Selection | null>(null)
  const storedPath = selection !== null && selection.worktreeId === worktreeId ? selection.path : null
  const selectedPath = isStillChanged(list.changes, storedPath) ? storedPath : null
  const diff = useWorktreeFileDiff(worktreeId, selectedPath, list.changes?.computedAt ?? null)

  useEffect((): void => {
    if (storedPath !== null && list.changes !== null && !isStillChanged(list.changes, storedPath)) {
      setSelection(null)
    }
  }, [storedPath, list.changes])

  return (
    <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>
      <section aria-label="Changes" className={cn('flex min-h-0 flex-col', className)}>
        <PanelHeader
          title={headerTitle(list)}
          selectedPath={selectedPath}
          loading={list.loading}
          onBack={(): void => setSelection(null)}
          onRefresh={list.refresh}
        />
        {selectedPath === null ? (
          <ChangesBody list={list} onSelect={(path: string): void => setSelection({ worktreeId, path })} />
        ) : (
          <DiffView diff={diff.diff} loading={diff.loading} error={diff.error} />
        )}
      </section>
    </TooltipProvider>
  )
}
