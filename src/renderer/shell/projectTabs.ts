import type { Id, RuntimeState, Session } from '../../shared/types'

const BACKSLASH = String.fromCharCode(92)

/** Folder identity for grouping: slash style, trailing slash and (Windows) case don't matter. */
export function folderKey(cwd: string): string {
  return cwd.split(BACKSLASH).join('/').replace(/\/+$/, '').toLowerCase()
}

/** D55: a session earns a tab on the bar only while its process runs and it is awake. */
export function isActiveSession(state: RuntimeState | undefined): boolean {
  return state !== undefined && state.run === 'running' && state.sleeping !== true
}

/**
 * The tabs worth showing next to the active one: open sessions that share its folder (D18) and are
 * running and awake (D55). The session on screen always keeps its tab, even asleep or exited.
 * A session alone in its folder gets a bar of one tab. With no active session, every active tab shows.
 */
export function projectTabIds(
  ids: readonly Id[],
  sessions: readonly Session[],
  activeId: Id | null,
  runtime: ReadonlyMap<Id, RuntimeState>
): readonly Id[] {
  const live = (id: Id): boolean => id === activeId || isActiveSession(runtime.get(id))
  const active = sessions.find((s: Session): boolean => s.id === activeId)
  if (active === undefined) return ids.filter(live)
  const key = folderKey(active.cwd)
  const sameFolder = new Set(
    sessions.filter((s: Session): boolean => folderKey(s.cwd) === key).map((s: Session): Id => s.id)
  )
  return ids.filter((id: Id): boolean => sameFolder.has(id) && live(id))
}
