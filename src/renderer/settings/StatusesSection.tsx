import { useState, type ReactElement } from 'react'
import { ChevronDown, ChevronUp, Plus } from 'lucide-react'
import type { Id, StatusDef } from '../../shared/types'
import type { SessionActions } from '../state/useSessionStore'
import { Button } from '@/components/ui/button'
import { StatusRow } from '../Sidebar/StatusRow'
import { moveStatus, nextStatusName, type MoveDirection } from './statusOrder'
import { errorMessage } from '../../shared/guards'

const DEFAULT_STATUS_COLOR = '#9e9e9e'

export interface StatusesSectionProps {
  readonly statuses: readonly StatusDef[]
  readonly actions: Pick<SessionActions, 'upsertStatus' | 'removeStatus' | 'reorderStatuses'>
}

export function StatusesSection({ statuses, actions }: StatusesSectionProps): ReactElement {
  const [rowErrors, setRowErrors] = useState<ReadonlyMap<Id, string>>(() => new Map())
  const [pendingDelete, setPendingDelete] = useState<Id | null>(null)
  const [globalError, setGlobalError] = useState<string | null>(null)

  function setRowError(id: Id, message: string | null): void {
    setRowErrors((prev) => {
      const next = new Map(prev)
      if (message === null) {
        next.delete(id)
      } else {
        next.set(id, message)
      }
      return next
    })
  }

  async function commit(next: StatusDef): Promise<void> {
    try {
      await actions.upsertStatus(next)
      setRowError(next.id, null)
    } catch (error) {
      setRowError(next.id, errorMessage(error))
    }
  }

  function clearRowError(id: Id): void {
    setRowError(id, null)
  }

  function handleDeleteClick(id: Id): void {
    if (pendingDelete === id) {
      void performDelete(id)
    } else {
      setPendingDelete(id)
    }
  }

  async function performDelete(id: Id): Promise<void> {
    try {
      await actions.removeStatus(id)
      setPendingDelete(null)
      setRowError(id, null)
    } catch (error) {
      setRowError(id, errorMessage(error))
    }
  }

  async function handleMove(id: Id, direction: MoveDirection): Promise<void> {
    const order = moveStatus(statuses, id, direction)
    if (order === null) {
      return
    }
    setGlobalError(null)
    try {
      await actions.reorderStatuses(order)
    } catch (error) {
      setGlobalError(errorMessage(error))
    }
  }

  async function handleAdd(): Promise<void> {
    setGlobalError(null)
    const draft: StatusDef = {
      id: crypto.randomUUID(),
      name: nextStatusName(statuses),
      color: DEFAULT_STATUS_COLOR
    }
    try {
      await actions.upsertStatus(draft)
      setRowError(draft.id, null)
    } catch (error) {
      setGlobalError(errorMessage(error))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Statuses are the columns of the Hub and the groups of the sidebar. Their order here is the
        column order.
      </p>

      {globalError !== null ? (
        <p role="alert" className="text-xs text-destructive">
          {globalError}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        {statuses.map((status, index) => (
          <div key={status.id} className="flex items-start gap-1">
            <div className="flex shrink-0 flex-col gap-0.5 pt-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={index === 0}
                aria-label={`Move ${status.name} up`}
                onClick={(): void => void handleMove(status.id, 'up')}
                className="text-muted-foreground"
              >
                <ChevronUp className="size-4" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={index === statuses.length - 1}
                aria-label={`Move ${status.name} down`}
                onClick={(): void => void handleMove(status.id, 'down')}
                className="text-muted-foreground"
              >
                <ChevronDown className="size-4" aria-hidden="true" />
              </Button>
            </div>
            <div className="min-w-0 flex-1">
              <StatusRow
                status={status}
                error={rowErrors.get(status.id) ?? null}
                confirmingDelete={pendingDelete === status.id}
                onCommit={(next: StatusDef): void => {
                  void commit(next)
                }}
                onClearError={clearRowError}
                onDeleteClick={handleDeleteClick}
                onCancelDelete={(): void => setPendingDelete(null)}
              />
            </div>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit text-xs"
        onClick={(): void => void handleAdd()}
      >
        <Plus className="size-4" aria-hidden="true" />
        Add status
      </Button>
    </div>
  )
}