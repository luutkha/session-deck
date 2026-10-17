import type { KeyboardEvent, MouseEvent, ReactElement } from 'react'
import { AlertTriangle, Check, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { WorkerInfo, WorkerStatus } from '../../shared/types'
import { shortModel, statusText } from './workerLogic'

export interface WorkerTabsProps {
  readonly workers: readonly WorkerInfo[]
  readonly selectedId: string | null
  readonly onSelect: (id: string) => void
  readonly onDismiss: (id: string) => void
}

const ACTIVE_SURFACE = 'bg-[color-mix(in_srgb,var(--foreground)_6%,var(--card))] text-foreground'
const INACTIVE_SURFACE = 'bg-card text-muted-foreground hover:text-foreground'

export function WorkerStatusIcon({ status, className }: { readonly status: WorkerStatus; readonly className?: string }): ReactElement {
  if (status === 'running') return <Loader2 className={cn('size-3.5 animate-spin text-primary', className)} aria-hidden="true" />
  if (status === 'done') return <Check className={cn('size-3.5 text-status-success', className)} aria-hidden="true" />
  return <AlertTriangle className={cn('size-3.5 text-destructive', className)} aria-hidden="true" />
}

/** The OpenCode workers of the active session, shown after its tabs. Selecting one opens its read-only view. */
export function WorkerTabs({ workers, selectedId, onSelect, onDismiss }: WorkerTabsProps): ReactElement | null {
  if (workers.length === 0) return null
  return (
    <>
      <span
        aria-hidden="true"
        className="app-no-drag flex shrink-0 select-none items-center border-r border-border bg-card px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
      >
        OpenCode workers
      </span>
      {workers.map((worker: WorkerInfo): ReactElement => {
        const active = worker.id === selectedId
        const choose = (): void => onSelect(worker.id)
        const dismiss = (event: MouseEvent<HTMLButtonElement>): void => {
          event.stopPropagation()
          onDismiss(worker.id)
        }
        const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            choose()
          }
        }
        return (
          <Tooltip key={worker.id}>
            <TooltipTrigger asChild>
              <div
                role="tab"
                aria-selected={active}
                aria-label={`OpenCode worker ${worker.name}: ${statusText(worker)}`}
                tabIndex={active ? 0 : -1}
                data-worker-id={worker.id}
                data-worker-status={worker.status}
                data-active={active}
                onClick={choose}
                onKeyDown={onKeyDown}
                className={cn(
                  'app-no-drag group relative flex h-full w-[170px] min-w-[110px] max-w-[200px] shrink cursor-pointer select-none items-center gap-2 border-r border-border px-2.5 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50',
                  active ? ACTIVE_SURFACE : INACTIVE_SURFACE
                )}
              >
                {active ? <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[2px] bg-primary" /> : null}
                <WorkerStatusIcon status={worker.status} />
                <span className="min-w-0 flex-1 truncate">{worker.name}</span>
                <button
                  type="button"
                  aria-label="Hide worker tab"
                  className={cn(
                    'app-no-drag flex size-4 shrink-0 items-center justify-center rounded-sm focus-visible:bg-muted focus-visible:text-foreground',
                    active ? 'text-muted-foreground hover:bg-muted hover:text-foreground' : 'text-transparent group-hover:text-muted-foreground hover:!bg-muted hover:!text-foreground'
                  )}
                  onClick={dismiss}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {worker.name} · {shortModel(worker.model)} · {statusText(worker)}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </>
  )
}
