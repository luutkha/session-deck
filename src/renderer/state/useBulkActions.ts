// W4 bulk actions over a multi-selection, shared by the sidebar and the Hub (D42). Items run one after another in the
// given (view) order; a failing item never stops the rest, its error is already in the store banner (lastError).
import { useCallback, useMemo, useState } from 'react'
import type { Id, RuntimeState, Session } from '../../shared/types'

/** The per-session operations a bulk action repeats. */
export interface BulkOps {
  readonly sleep: (id: Id) => Promise<unknown>
  /** Wake = open the session (there is no renderer wake call); it is never awaited. */
  readonly wake: (id: Id) => void
  readonly setStatus: (id: Id, statusId: Id | null) => Promise<unknown> | void
  readonly move: (id: Id, groupId: Id | null, index: number) => Promise<unknown>
}

export interface BulkActions {
  readonly busy: boolean
  /** Selected sessions that are running and awake (Sleep applies). */
  readonly sleepIds: readonly Id[]
  /** Selected sessions that are asleep (Wake applies). */
  readonly wakeIds: readonly Id[]
  readonly sleep: () => void
  readonly wake: () => void
  readonly setStatus: (statusId: Id | null) => void
  readonly moveToGroup: (groupId: Id | null) => void
}

/** Splits a selection into the sessions Sleep and Wake apply to; any other state (exited, unknown) is in neither. */
export function partitionSleepWake(
  ids: readonly Id[],
  runtime: ReadonlyMap<Id, RuntimeState>
): { readonly sleepIds: readonly Id[]; readonly wakeIds: readonly Id[] } {
  const sleepIds: Id[] = []
  const wakeIds: Id[] = []
  for (const id of ids) {
    const state = runtime.get(id)
    if (state?.sleeping === true) {
      wakeIds.push(id)
    } else if (state?.run === 'running') {
      sleepIds.push(id)
    }
  }
  return { sleepIds, wakeIds }
}

export function useBulkActions(
  selectedIds: readonly Id[],
  sessions: readonly Session[],
  runtime: ReadonlyMap<Id, RuntimeState>,
  ops: BulkOps
): BulkActions {
  const [busy, setBusy] = useState(false)
  const { sleepIds, wakeIds } = useMemo(() => partitionSleepWake(selectedIds, runtime), [selectedIds, runtime])

  const runBulk = useCallback(async (ids: readonly Id[], run: (id: Id) => Promise<unknown> | void): Promise<void> => {
    if (ids.length === 0) return
    setBusy(true)
    try {
      for (const id of ids) {
        try {
          await run(id)
        } catch {
          // Already reported by the store action wrapper; keep going with the remaining sessions.
        }
      }
    } finally {
      setBusy(false)
    }
  }, [])

  const { sleep: sleepOne, wake: wakeOne, setStatus: setStatusOne, move: moveOne } = ops

  const sleep = useCallback((): void => {
    void runBulk(sleepIds, sleepOne)
  }, [runBulk, sleepIds, sleepOne])

  const wake = useCallback((): void => {
    void runBulk(wakeIds, (id): void => wakeOne(id))
  }, [runBulk, wakeIds, wakeOne])

  const setStatus = useCallback((statusId: Id | null): void => {
    void runBulk(selectedIds, (id) => setStatusOne(id, statusId))
  }, [runBulk, selectedIds, setStatusOne])

  const moveToGroup = useCallback((groupId: Id | null): void => {
    // Append to the target group in view order. The index advances locally because `sessions` in this closure still
    // describes the state before the loop; sessions already in the group are skipped.
    let index = sessions.filter((session): boolean => session.groupId === groupId).length
    void runBulk(selectedIds, async (id): Promise<void> => {
      const session = sessions.find((candidate): boolean => candidate.id === id)
      if (session === undefined || session.groupId === groupId) return
      await moveOne(id, groupId, index)
      index += 1
    })
  }, [runBulk, selectedIds, sessions, moveOne])

  return { busy, sleepIds, wakeIds, sleep, wake, setStatus, moveToGroup }
}
