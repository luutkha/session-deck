// React state for the open tabs. The logic lives in openTabsLogic.ts; this hook wires it to
// the store (closing and reopening sessions) and to the main process (active session, attention).
import { useCallback, useEffect, useReducer } from 'react'
import type { Id, Session } from '../../shared/types'
import type { SessionActions } from '../state/useSessionStore'
import {
  OPEN_TABS_STORAGE_KEY,
  activateTab,
  cycleTab,
  openTab,
  parseOpenTabs,
  pruneOpenTabs,
  removeTabs,
  serializeOpenTabs,
  type OpenTabsState
} from './openTabsLogic'
import { readStorageItem, writeStorageItem } from './shellPrefs'

export type TabActions = Pick<SessionActions, 'closeSession' | 'reopenSession'>

type TabsAction =
  | { readonly type: 'open'; readonly id: Id }
  | { readonly type: 'activate'; readonly id: Id }
  | { readonly type: 'remove'; readonly ids: readonly Id[] }
  | { readonly type: 'prune'; readonly sessions: readonly Session[] }
  | { readonly type: 'cycle'; readonly delta: 1 | -1 }

function tabsReducer(state: OpenTabsState, action: TabsAction): OpenTabsState {
  switch (action.type) {
    case 'open':
      return openTab(state, action.id)
    case 'activate':
      return activateTab(state, action.id)
    case 'remove':
      return removeTabs(state, action.ids).state
    case 'prune':
      return pruneOpenTabs(state, action.sessions)
    case 'cycle':
      return cycleTab(state, action.delta)
  }
}

function loadInitialTabs(): OpenTabsState {
  return parseOpenTabs(readStorageItem(OPEN_TABS_STORAGE_KEY))
}

/** A rejected store action has already recorded its message in lastError (shown by the sidebar banner). */
export function ignoreRejection(promise: Promise<unknown>): void {
  promise.catch((): undefined => undefined)
}

export interface OpenTabsApi {
  readonly ids: readonly Id[]
  readonly activeId: Id | null
  /** The user picked a session in the sidebar: open its tab and activate it. */
  readonly select: (id: Id) => void
  /** A session was created: open and activate its tab. */
  readonly open: (id: Id) => void
  /** The user resumed a closed session: reopen it in the store, then open its tab. */
  readonly reopen: (id: Id) => void
  /** Closes the session (stops its process); its tab disappears only if the close succeeded. */
  readonly close: (id: Id) => void
  /** Closes every open session except the given one. */
  readonly closeOthers: (keepId: Id) => void
  readonly closeAll: () => void
  readonly activate: (id: Id) => void
  readonly cycle: (delta: 1 | -1) => void
  readonly closeActive: () => void
}

export function useOpenTabs(sessions: readonly Session[] | null, actions: TabActions): OpenTabsApi {
  const [state, dispatch] = useReducer(tabsReducer, undefined, loadInitialTabs)
  const loaded = sessions !== null
  const { activeId, ids } = state

  // Persist the ordered ids and the active id on every change.
  useEffect((): void => {
    writeStorageItem(OPEN_TABS_STORAGE_KEY, serializeOpenTabs(state))
  }, [state])

  // Restored tabs are checked against the loaded store: closed or removed sessions lose their tab.
  useEffect((): void => {
    if (sessions !== null) {
      dispatch({ type: 'prune', sessions })
    }
  }, [sessions])

  // The main process needs to know which session is on screen (attention is suppressed for it).
  useEffect((): void => {
    if (loaded) {
      window.api.setActiveSession(activeId)
    }
  }, [activeId, loaded])

  const isOpenable = useCallback(
    (id: Id): boolean =>
      sessions?.some(
        (session: Session): boolean => session.id === id && session.closedAt === undefined
      ) ?? false,
    [sessions]
  )

  const select = useCallback(
    (id: Id): void => {
      if (!isOpenable(id)) {
        return
      }
      window.api.clearAttention(id)
      dispatch({ type: 'open', id })
    },
    [isOpenable]
  )

  const open = useCallback((id: Id): void => {
    dispatch({ type: 'open', id })
  }, [])

  const reopen = useCallback(
    (id: Id): void => {
      ignoreRejection(
        actions.reopenSession(id).then((): void => {
          dispatch({ type: 'open', id })
        })
      )
    },
    [actions]
  )

  const closeMany = useCallback(
    async (targets: readonly Id[]): Promise<void> => {
      const results = await Promise.allSettled(
        targets.map((id: Id): Promise<void> => actions.closeSession(id))
      )
      // Failed closes keep their tab open; the store has already shown the error.
      const closed = targets.filter(
        (_: Id, index: number): boolean => results[index]?.status === 'fulfilled'
      )
      if (closed.length > 0) {
        dispatch({ type: 'remove', ids: closed })
      }
    },
    [actions]
  )

  const close = useCallback(
    (id: Id): void => {
      ignoreRejection(closeMany([id]))
    },
    [closeMany]
  )

  const closeOthers = useCallback(
    (keepId: Id): void => {
      ignoreRejection(closeMany(ids.filter((id: Id): boolean => id !== keepId)))
    },
    [closeMany, ids]
  )

  const closeAll = useCallback((): void => {
    ignoreRejection(closeMany(ids))
  }, [closeMany, ids])

  const activate = useCallback((id: Id): void => {
    dispatch({ type: 'activate', id })
  }, [])

  const cycle = useCallback((delta: 1 | -1): void => {
    dispatch({ type: 'cycle', delta })
  }, [])

  const closeActive = useCallback((): void => {
    if (activeId !== null) {
      close(activeId)
    }
  }, [activeId, close])

  return {
    ids,
    activeId,
    select,
    open,
    reopen,
    close,
    closeOthers,
    closeAll,
    activate,
    cycle,
    closeActive
  }
}
