import type { Id, SessionActivity, StoreData } from '../../shared/types'
import { resolveSettings } from '../../shared/types'
import { decideAutoStatus } from './autoStatus'

/** The subset of SessionStore the applier needs. */
export interface AutoStatusStore {
  get(): StoreData
  setSessionStatus(id: Id, statusId: Id | null): void
}

export interface AutoStatusApplierDeps {
  readonly store: AutoStatusStore
  /** Records a failure. The applier never throws into the hook path. */
  readonly onError: (where: string, error: unknown) => void
}

/**
 * Returns the function called when a session's activity changes. It reads the CURRENT store state, decides with
 * decideAutoStatus and applies the new status when one comes back.
 */
export function createAutoStatusApplier(deps: AutoStatusApplierDeps): (sessionId: Id, activity: SessionActivity) => void {
  const { store, onError } = deps

  return (sessionId: Id, activity: SessionActivity): void => {
    try {
      const data = store.get()
      const session = data.sessions.find((s) => s.id === sessionId)
      if (!session) return

      const target = decideAutoStatus({
        settings: resolveSettings(data.settings),
        statuses: data.statuses,
        session,
        activity
      })
      if (typeof target === 'string') {
        store.setSessionStatus(sessionId, target)
      }
    } catch (error) {
      onError(`auto status for session ${sessionId}`, error)
    }
  }
}
