// Pure model of the command palette: which items exist, their labels, and what each one does.
// No React, no DOM, no IPC. Commands are data only; App maps them to real calls (runCommand.ts).
import type { Id, RuntimeState, Session, StatusDef } from '../../shared/types'

export type PaletteGroup = 'Sessions' | 'Actions' | 'This session'
export type PaletteView = 'terminal' | 'hub'

/** What an item does, as plain data. Executed by runPaletteCommand. */
export type PaletteCommand =
  | { readonly kind: 'open-session'; readonly id: Id }
  | { readonly kind: 'reopen-session'; readonly id: Id }
  | { readonly kind: 'new-session' }
  | { readonly kind: 'open-hub' }
  | { readonly kind: 'open-settings' }
  | { readonly kind: 'sleep'; readonly id: Id }
  | { readonly kind: 'set-keep-awake'; readonly id: Id; readonly keepAwake: boolean }
  | { readonly kind: 'set-status'; readonly id: Id; readonly statusId: Id }
  | { readonly kind: 'mark-read'; readonly id: Id }
  | { readonly kind: 'mark-unread'; readonly id: Id }

export interface PaletteItem {
  /** Unique within one palette build. */
  readonly id: string
  readonly group: PaletteGroup
  readonly label: string
  readonly detail: string
  /** Extra search text (never shown). */
  readonly keywords: string
  readonly run: PaletteCommand
}

export interface PaletteInput {
  readonly sessions: readonly Session[]
  readonly statuses: readonly StatusDef[]
  readonly runtime: ReadonlyMap<Id, RuntimeState>
  readonly activeId: Id | null
  readonly view: PaletteView
}

const NO_STATUS = 'No status'
const NEEDS_YOU = 'Needs you'
const SLEEPING = 'Sleeping'
const CLOSED = 'Closed'
const UNTITLED = 'Untitled session'
const DETAIL_SEPARATOR = ' · '
const DEFAULT_AGENT = 'claude'

// Sort ranks for the Sessions group: bell, open, sleeping, closed.
const RANK_BELL = 0
const RANK_OPEN = 1
const RANK_SLEEPING = 2
const RANK_CLOSED = 3

/** The last folder of a path. A drive or filesystem root has no folder name, so the full cwd is shown. */
export function folderLabel(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/, '')
  const last = trimmed.split(/[\\/]/).pop() ?? ''
  if (last === '' || last.endsWith(':')) {
    return cwd
  }
  return last
}

/** The session name, or the folder name when the name is blank. */
function displayName(session: Session): string {
  const name = session.name.trim()
  if (name !== '') {
    return name
  }
  return folderLabel(session.cwd) || UNTITLED
}

function statusName(session: Session, statuses: readonly StatusDef[]): string {
  return statuses.find((status: StatusDef): boolean => status.id === session.statusId)?.name ?? NO_STATUS
}

/** What the session is doing, in one word: Closed, then Sleeping, then Needs you, else its status. */
function sessionState(
  session: Session,
  state: RuntimeState | undefined,
  statuses: readonly StatusDef[]
): string {
  if (session.closedAt !== undefined) {
    return CLOSED
  }
  if (state?.sleeping === true) {
    return SLEEPING
  }
  if ((state?.attention ?? null) !== null) {
    return NEEDS_YOU
  }
  return statusName(session, statuses)
}

function sessionDetail(
  session: Session,
  state: RuntimeState | undefined,
  statuses: readonly StatusDef[]
): string {
  return `${folderLabel(session.cwd)}${DETAIL_SEPARATOR}${sessionState(session, state, statuses)}`
}

function sessionRank(session: Session, state: RuntimeState | undefined): number {
  if (session.closedAt !== undefined) {
    return RANK_CLOSED
  }
  if ((state?.attention ?? null) !== null) {
    return RANK_BELL
  }
  return state?.sleeping === true ? RANK_SLEEPING : RANK_OPEN
}

function sessionItem(
  session: Session,
  state: RuntimeState | undefined,
  statuses: readonly StatusDef[]
): PaletteItem {
  const closed = session.closedAt !== undefined
  return {
    id: `session:${session.id}`,
    group: 'Sessions',
    label: displayName(session),
    detail: sessionDetail(session, state, statuses),
    keywords: `${session.cwd} ${session.agent ?? DEFAULT_AGENT}`,
    run: closed
      ? { kind: 'reopen-session', id: session.id }
      : { kind: 'open-session', id: session.id }
  }
}

/** Bell first, then open, then sleeping, then closed; by name inside each rank (input order on equal names). */
function sortedSessions(
  sessions: readonly Session[],
  runtime: ReadonlyMap<Id, RuntimeState>
): readonly Session[] {
  return [...sessions].sort((a: Session, b: Session): number => {
    const rankDiff = sessionRank(a, runtime.get(a.id)) - sessionRank(b, runtime.get(b.id))
    if (rankDiff !== 0) {
      return rankDiff
    }
    return displayName(a).localeCompare(displayName(b))
  })
}

function sleepItem(session: Session, name: string, detail: string): PaletteItem {
  return {
    id: `this:sleep:${session.id}`,
    group: 'This session',
    label: `Sleep ${name}`,
    detail,
    keywords: 'stop pause idle',
    run: { kind: 'sleep', id: session.id }
  }
}

function keepAwakeItem(session: Session, name: string, detail: string): PaletteItem {
  const keepAwake = session.keepAwake !== true
  return {
    id: `this:keep-awake:${session.id}`,
    group: 'This session',
    label: keepAwake ? `Keep ${name} awake` : `Let ${name} sleep`,
    detail,
    keywords: 'keep awake sleep idle timer',
    run: { kind: 'set-keep-awake', id: session.id, keepAwake }
  }
}

function readItem(
  session: Session,
  name: string,
  detail: string,
  state: RuntimeState | undefined
): PaletteItem {
  const hasBell = (state?.attention ?? null) !== null
  return {
    id: `this:read:${session.id}`,
    group: 'This session',
    label: hasBell ? `Mark ${name} as read` : `Mark ${name} as unread`,
    detail,
    keywords: 'read unread bell attention',
    run: hasBell ? { kind: 'mark-read', id: session.id } : { kind: 'mark-unread', id: session.id }
  }
}

function statusItems(
  session: Session,
  detail: string,
  statuses: readonly StatusDef[]
): readonly PaletteItem[] {
  return statuses
    .filter((status: StatusDef): boolean => status.id !== session.statusId)
    .map(
      (status: StatusDef): PaletteItem => ({
        id: `status:${session.id}:${status.id}`,
        group: 'This session',
        label: `Set status: ${status.name}`,
        detail,
        keywords: 'status column move',
        run: { kind: 'set-status', id: session.id, statusId: status.id }
      })
    )
}

/** Commands for the session on screen. Empty when there is no open session. */
function thisSessionItems(
  session: Session,
  state: RuntimeState | undefined,
  statuses: readonly StatusDef[]
): readonly PaletteItem[] {
  const name = displayName(session)
  const detail = sessionDetail(session, state, statuses)
  const items: PaletteItem[] = []
  if (state?.run === 'running' && state.sleeping !== true) {
    items.push(sleepItem(session, name, detail))
  }
  items.push(keepAwakeItem(session, name, detail), readItem(session, name, detail, state))
  return [...items, ...statusItems(session, detail, statuses)]
}

function findOpenSession(sessions: readonly Session[], activeId: Id | null): Session | null {
  if (activeId === null) {
    return null
  }
  const session = sessions.find((candidate: Session): boolean => candidate.id === activeId)
  return session !== undefined && session.closedAt === undefined ? session : null
}

function actionItems(view: PaletteView): readonly PaletteItem[] {
  const items: PaletteItem[] = [
    {
      id: 'action:new-session',
      group: 'Actions',
      label: 'New session',
      detail: 'Start a session in a folder',
      keywords: 'create add start',
      run: { kind: 'new-session' }
    }
  ]
  if (view !== 'hub') {
    items.push({
      id: 'action:open-hub',
      group: 'Actions',
      label: 'Open Hub',
      detail: 'Board of sessions by status',
      keywords: 'board kanban status columns',
      run: { kind: 'open-hub' }
    })
  }
  items.push({
    id: 'action:open-settings',
    group: 'Actions',
    label: 'Open Settings',
    detail: 'Sound, statuses, agents and more',
    keywords: 'preferences options config',
    run: { kind: 'open-settings' }
  })
  return items
}

/** Every palette item in builder order: Sessions, then This session, then Actions. */
export function buildPaletteItems(input: PaletteInput): readonly PaletteItem[] {
  const { sessions, statuses, runtime, activeId, view } = input
  const sessionItems = sortedSessions(sessions, runtime).map(
    (session: Session): PaletteItem => sessionItem(session, runtime.get(session.id), statuses)
  )
  const active = findOpenSession(sessions, activeId)
  const thisItems =
    active === null ? [] : thisSessionItems(active, runtime.get(active.id), statuses)
  return [...sessionItems, ...thisItems, ...actionItems(view)]
}
