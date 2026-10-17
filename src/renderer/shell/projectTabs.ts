import type { Id, Session } from '../../shared/types'

const BACKSLASH = String.fromCharCode(92)

/** Folder identity for grouping: slash style, trailing slash and (Windows) case don't matter. */
export function folderKey(cwd: string): string {
  return cwd.split(BACKSLASH).join('/').replace(/\/+$/, '').toLowerCase()
}

/**
 * The tabs worth showing next to the active one: open sessions that share its folder.
 * A session alone in its folder gets a bar of one tab. With no active session, every tab shows.
 */
export function projectTabIds(
  ids: readonly Id[],
  sessions: readonly Session[],
  activeId: Id | null
): readonly Id[] {
  const active = sessions.find((s: Session): boolean => s.id === activeId)
  if (active === undefined) return ids
  const key = folderKey(active.cwd)
  const sameFolder = new Set(
    sessions.filter((s: Session): boolean => folderKey(s.cwd) === key).map((s: Session): Id => s.id)
  )
  return ids.filter((id: Id): boolean => sameFolder.has(id))
}
