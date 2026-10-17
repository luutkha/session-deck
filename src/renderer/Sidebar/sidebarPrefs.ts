/** Persisted sidebar preferences and small storage helpers. */

export type GroupBy = 'groups' | 'status'

export type StatusCollapsedMap = ReadonlyMap<string, boolean>

/** The relative-time label on cards re-renders on this cadence. */
export const RELATIVE_TIME_INTERVAL_MS = 30 * 1000

const GROUP_BY_STORAGE_KEY = 'sessiondeck-sidebar-groupby'
const CLOSED_COLLAPSED_STORAGE_KEY = 'sessiondeck-sidebar-closed-collapsed'
const STATUS_COLLAPSED_STORAGE_KEY = 'sessiondeck-sidebar-status-collapsed'
const SHOW_WORKSPACES_STORAGE_KEY = 'sessiondeck-sidebar-show-workspaces'
const WORKSPACE_COLLAPSED_STORAGE_KEY = 'sessiondeck-sidebar-workspace-collapsed'

function readStorageString(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorageString(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // localStorage may be unavailable (private mode / quota); ignore.
  }
}

export function readGroupBy(): GroupBy {
  return readStorageString(GROUP_BY_STORAGE_KEY) === 'status' ? 'status' : 'groups'
}

export function writeGroupBy(value: GroupBy): void {
  writeStorageString(GROUP_BY_STORAGE_KEY, value)
}

export function readClosedCollapsed(): boolean {
  return readStorageString(CLOSED_COLLAPSED_STORAGE_KEY) !== 'false'
}

export function writeClosedCollapsed(collapsed: boolean): void {
  writeStorageString(CLOSED_COLLAPSED_STORAGE_KEY, collapsed ? 'true' : 'false')
}

export function readShowWorkspaces(): boolean {
  return readStorageString(SHOW_WORKSPACES_STORAGE_KEY) !== 'false'
}

export function writeShowWorkspaces(show: boolean): void {
  writeStorageString(SHOW_WORKSPACES_STORAGE_KEY, show ? 'true' : 'false')
}

export function readWorkspaceCollapsed(): StatusCollapsedMap {
  return readBooleanMap(WORKSPACE_COLLAPSED_STORAGE_KEY)
}

export function writeWorkspaceCollapsed(value: StatusCollapsedMap): void {
  writeBooleanMap(WORKSPACE_COLLAPSED_STORAGE_KEY, value)
}

export function readStatusCollapsed(): StatusCollapsedMap {
  return readBooleanMap(STATUS_COLLAPSED_STORAGE_KEY)
}

export function writeStatusCollapsed(value: StatusCollapsedMap): void {
  writeBooleanMap(STATUS_COLLAPSED_STORAGE_KEY, value)
}

function readBooleanMap(storageKey: string): StatusCollapsedMap {
  const raw = readStorageString(storageKey)
  if (raw === null) return new Map()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return new Map()
    const result = new Map<string, boolean>()
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') result.set(key, value)
    }
    return result
  } catch {
    return new Map()
  }
}

function writeBooleanMap(storageKey: string, value: StatusCollapsedMap): void {
  const obj: Record<string, boolean> = {}
  for (const [key, flag] of value.entries()) {
    obj[key] = flag
  }
  writeStorageString(storageKey, JSON.stringify(obj))
}