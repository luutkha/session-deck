// How the sidebar list looks, for Jarvis (D58): group by, folder buckets, search, status filter, the Closed section
// and collapsing sections. The sidebar keeps this state itself (React state + localStorage); it registers a control
// here while mounted, and the workspace's Jarvis handler applies changes through it. Pure apart from the registry.
import type { Id, JarvisSidebarView } from '../../shared/types'

export interface SidebarViewState {
  /** null: this sidebar has no such option (Code mode). */
  readonly groupBy: 'groups' | 'status' | null
  readonly showWorkspaces: boolean | null
  readonly search: string
  readonly statusFilter: readonly (Id | null)[] | null
  readonly closedCollapsed: boolean
}

export interface SidebarViewControl {
  readonly state: () => SidebarViewState
  readonly statusNames: () => ReadonlyMap<Id, string>
  readonly setSearch: (value: string) => void
  readonly setClosedCollapsed: (collapsed: boolean) => void
  readonly setGroupBy?: (value: 'groups' | 'status') => void
  readonly setShowWorkspaces?: (show: boolean) => void
  readonly setStatusFilter?: (ids: ReadonlySet<Id | null>) => void
  /** Collapses or expands every status section and folder bucket. */
  readonly setSectionsCollapsed?: (collapsed: boolean) => void
}

let current: SidebarViewControl | null = null

/** The mounted sidebar registers itself; returns the unregister function (removes only this control). */
export function registerSidebarView(control: SidebarViewControl): () => void {
  current = control
  return (): void => {
    if (current === control) current = null
  }
}

export function sidebarViewControl(): SidebarViewControl | null {
  return current
}

function statusLabel(names: ReadonlyMap<Id, string>, id: Id | null): string {
  return id === null ? '"No status"' : `"${names.get(id) ?? id}"`
}

export function describeSidebarView(control: SidebarViewControl): string {
  const s = control.state()
  const parts = [
    s.groupBy !== null ? `grouped by ${s.groupBy === 'status' ? 'status' : 'group'}` : null,
    s.showWorkspaces !== null ? `folder buckets ${s.showWorkspaces ? 'on' : 'off'}` : null,
    s.search.trim().length > 0 ? `search "${s.search}"` : 'no search',
    s.statusFilter !== null
      ? (s.statusFilter.length > 0 ? `status filter ${s.statusFilter.map((id) => statusLabel(control.statusNames(), id)).join(', ')}` : 'no status filter')
      : null,
    `Closed section ${s.closedCollapsed ? 'collapsed' : 'expanded'}`
  ].filter((part): part is string => part !== null)
  return `Sidebar list: ${parts.join(', ')}`
}

function unsupported(what: string): Error {
  return new Error(`The Code mode sidebar has no ${what}; it shows repos > worktrees > sessions.`)
}

/** Applies the given fields; returns the new picture. Throws for an option this sidebar does not have. */
export function applySidebarView(view: JarvisSidebarView, control: SidebarViewControl): string {
  if (view.groupBy !== undefined && control.setGroupBy === undefined) throw unsupported('"group by" option')
  if (view.showWorkspaces !== undefined && control.setShowWorkspaces === undefined) throw unsupported('folder buckets')
  if (view.statusFilter !== undefined && control.setStatusFilter === undefined) throw unsupported('status filter')
  if (view.sections !== undefined && control.setSectionsCollapsed === undefined) throw unsupported('status sections or folder buckets to collapse')
  if (view.statusFilter !== undefined) {
    const names = control.statusNames()
    const unknown = view.statusFilter.filter((id) => id !== null && !names.has(id))
    if (unknown.length > 0) throw new Error(`Unknown status id(s): ${unknown.join(', ')}.`)
  }
  if (view.groupBy !== undefined) control.setGroupBy?.(view.groupBy)
  if (view.showWorkspaces !== undefined) control.setShowWorkspaces?.(view.showWorkspaces)
  if (view.search !== undefined) control.setSearch(view.search)
  if (view.statusFilter !== undefined) control.setStatusFilter?.(new Set(view.statusFilter))
  if (view.closedSection !== undefined) control.setClosedCollapsed(view.closedSection === 'collapsed')
  if (view.sections !== undefined) control.setSectionsCollapsed?.(view.sections === 'collapseAll')
  return 'Sidebar updated.'
}
