// Pure model of the command palette: which items exist, their labels, and what each one does.
// No React, no DOM, no IPC. Commands are data only; App maps them to real calls (runCommand.ts).
import type { Id, Repo, RuntimeState, Session, SessionPreset, StatusDef, UiMode, Worktree, WindowRole } from '../../shared/types'
import { presetDetail } from '../presets/presetLogic'
import { needsYouItems } from '../attention/needsYou'
import { allTags } from '../tags/tagLogic'

export type PaletteGroup = 'Sessions' | 'Actions' | 'This session'
export type PaletteView = 'terminal' | 'grid' | 'hub'

/** What an item does, as plain data. Executed by runPaletteCommand. */
export type PaletteCommand =
  | { readonly kind: 'open-session'; readonly id: Id }
  | { readonly kind: 'reopen-session'; readonly id: Id }
  | { readonly kind: 'new-session' }
  | { readonly kind: 'new-from-preset'; readonly presetId: Id }
  | { readonly kind: 'open-hub' }
  | { readonly kind: 'open-grid' }
  | { readonly kind: 'exit-grid' }
  | { readonly kind: 'open-settings' }
  /** G10: opens Settings straight on the diagnostics section. */
  | { readonly kind: 'open-settings-diagnostics' }
  | { readonly kind: 'show-away-summary' }
  | { readonly kind: 'show-costs' }
  | { readonly kind: 'fork-session'; readonly id: Id }
  /** D88: moves an Ops session into a Code-mode worktree (fresh conversation there). */
  | { readonly kind: 'move-to-code'; readonly id: Id; readonly worktreeId: Id }
  /** D88: opens the New worktree dialog; creating it moves this Ops session in. */
  | { readonly kind: 'move-to-new-worktree'; readonly id: Id }
  | { readonly kind: 'search-conversations' }
  | { readonly kind: 'open-jarvis' }
  | { readonly kind: 'reset-jarvis' }
  /** D74: picks a file and shows it in the side panel's viewer for the session on screen. */
  | { readonly kind: 'preview-file' }
  | { readonly kind: 'sleep'; readonly id: Id }
  | { readonly kind: 'set-keep-awake'; readonly id: Id; readonly keepAwake: boolean }
  | { readonly kind: 'set-status'; readonly id: Id; readonly statusId: Id }
  | { readonly kind: 'mark-read'; readonly id: Id }
  | { readonly kind: 'mark-unread'; readonly id: Id }
  | { readonly kind: 'switch-mode'; readonly mode: UiMode }
  | { readonly kind: 'pop-out-code' }
  | { readonly kind: 'dock-code' }
  | { readonly kind: 'new-worktree' }
  /** G10: opens the Changes tab of the active worktree session. */
  | { readonly kind: 'view-changes'; readonly id: Id }
  /** G10: pops the active worktree session's changes into their own window. */
  | { readonly kind: 'detach-changes'; readonly worktreeId: Id }
  /** D69: show the next / previous session that needs you. */
  | { readonly kind: 'step-attention'; readonly delta: 1 | -1 }

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
  /** The mode on screen (D31). */
  readonly mode: UiMode
  /** Which window the palette runs in: the main window offers the switch, the Code window offers to dock back. */
  readonly windowRole: WindowRole
  readonly codePoppedOut: boolean
  /** D49: saved New Session forms; each becomes a one-step "New session: <name>" item in Ops mode. Absent = none. */
  readonly presets?: readonly SessionPreset[]
  /** D88: Code-mode repos and worktrees, so an Ops session can be moved into one. Absent = no move items. */
  readonly repos?: readonly Repo[]
  readonly worktrees?: readonly Worktree[]
}

const NO_STATUS = 'No status'
const NEEDS_YOU = 'Needs you'
const SLEEPING = 'Sleeping'
const CLOSED = 'Closed'
const UNTITLED = 'Untitled session'
const DETAIL_SEPARATOR = ' · '
const DEFAULT_AGENT = 'claude'
// A palette with hundreds of worktrees would drown the list: offer the first ones (a typed query still narrows them).
const PALETTE_MOVE_LIMIT = 30
// Keep the tag jump list short; allTags already orders by count then name.
const PALETTE_TAG_LIMIT = 15

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

/** D88: "Move to Code: repo / worktree" for an Ops session (never Jarvis), one item per worktree. */
export function moveToCodeItems(session: Session, repos: readonly Repo[], worktrees: readonly Worktree[], detail: string): readonly PaletteItem[] {
  if (session.worktreeId !== undefined || session.role === 'jarvis') return []
  const name = displayName(session)
  const newOne: PaletteItem[] = repos.length === 0 ? [] : [{
    id: `this:move-to-new-worktree:${session.id}`,
    group: 'This session',
    label: 'Move to Code mode: new worktree…',
    detail: `Create a worktree, then ${name} moves into it with a new conversation`,
    keywords: 'move code mode new worktree create branch convert',
    run: { kind: 'move-to-new-worktree', id: session.id }
  }]
  const existing = worktrees.slice(0, PALETTE_MOVE_LIMIT).map((worktree: Worktree): PaletteItem => {
    const repoName = repos.find((repo: Repo): boolean => repo.id === worktree.repoId)?.name ?? ''
    const where = repoName === '' ? worktree.name : `${repoName} / ${worktree.name}`
    return {
      id: `this:move-to-code:${session.id}:${worktree.id}`,
      group: 'This session',
      label: `Move to Code mode: ${where}`,
      detail: `${name} restarts in ${worktree.path} with a new conversation (${detail})`,
      keywords: `move code mode worktree repo branch convert ${worktree.branch}`,
      run: { kind: 'move-to-code', id: session.id, worktreeId: worktree.id }
    }
  })
  return [...newOne, ...existing]
}

/** Commands for the session on screen. Empty when there is no open session. */
function thisSessionItems(
  session: Session,
  state: RuntimeState | undefined,
  statuses: readonly StatusDef[],
  repos: readonly Repo[],
  worktrees: readonly Worktree[]
): readonly PaletteItem[] {
  const name = displayName(session)
  const detail = sessionDetail(session, state, statuses)
  const items: PaletteItem[] = []
  if (state?.run === 'running' && state.sleeping !== true) {
    items.push(sleepItem(session, name, detail))
  }
  items.push(keepAwakeItem(session, name, detail), readItem(session, name, detail, state))
  // G10: the changes panel belongs to a worktree session; reuse the tab menu's target when there is one.
  if (session.worktreeId !== undefined) {
    items.push({
      id: `this:view-changes:${session.id}`,
      group: 'This session',
      label: 'View changes of this session',
      detail: 'Show this worktree session in the terminal with its Changes panel',
      keywords: 'changes diff worktree panel tab review',
      run: { kind: 'view-changes', id: session.id }
    }, {
      id: `this:detach-changes:${session.id}`,
      group: 'This session',
      label: 'Detach changes window',
      detail: 'Open this worktree session\'s changes in their own window',
      keywords: 'detach changes window pop out separate',
      run: { kind: 'detach-changes', worktreeId: session.worktreeId }
    })
  }
  // D52/D79: a Claude conversation forks with Claude's own --fork-session; an OpenCode one is copied (export/import).
  if ((session.agent ?? 'claude') !== 'shell') {
    items.push({
      id: `this:fork:${session.id}`,
      group: 'This session',
      label: `Fork ${name}`,
      detail: 'New session on a copy of this conversation',
      keywords: 'fork branch copy duplicate conversation',
      run: { kind: 'fork-session', id: session.id }
    })
  }
  items.push(...moveToCodeItems(session, repos, worktrees, detail))
  return [...items, ...statusItems(session, detail, statuses)]
}

function findOpenSession(sessions: readonly Session[], activeId: Id | null): Session | null {
  if (activeId === null) {
    return null
  }
  const session = sessions.find((candidate: Session): boolean => candidate.id === activeId)
  return session !== undefined && session.closedAt === undefined ? session : null
}

const MODE_NAMES: Readonly<Record<UiMode, string>> = { ops: 'Ops', code: 'Code' }

function switchModeItem(mode: UiMode): PaletteItem {
  const target: UiMode = mode === 'ops' ? 'code' : 'ops'
  return {
    id: 'action:switch-mode',
    group: 'Actions',
    label: `Switch to ${MODE_NAMES[target]} mode`,
    detail: target === 'code' ? 'Repositories, worktrees and their sessions' : 'Sessions outside worktrees',
    keywords: 'mode ops code switch',
    run: { kind: 'switch-mode', mode: target }
  }
}

/** Mode and window commands. The main window switches or pops Code out; the Code window docks it back. */
function modeItems(input: PaletteInput): readonly PaletteItem[] {
  const { mode, windowRole, codePoppedOut } = input
  const items: PaletteItem[] = []
  if (windowRole === 'code') {
    items.push({
      id: 'action:dock-code',
      group: 'Actions',
      label: 'Move Code back to the main window',
      detail: 'Closes this window; Code returns to the main window',
      keywords: 'dock close merge main window',
      run: { kind: 'dock-code' }
    })
  } else {
    if (!codePoppedOut) {
      items.push(switchModeItem(mode))
    }
    items.push({
      id: 'action:pop-out-code',
      group: 'Actions',
      label: 'Open Code in its own window',
      detail: 'Code mode in a separate window',
      keywords: 'pop out detach separate window',
      run: { kind: 'pop-out-code' }
    })
  }
  if (mode === 'code') {
    items.push({
      id: 'action:new-worktree',
      group: 'Actions',
      label: 'New worktree',
      detail: 'A branch and folder from a repository',
      keywords: 'worktree branch repo create add git',
      run: { kind: 'new-worktree' }
    })
  }
  return items
}

function actionItems(input: PaletteInput): readonly PaletteItem[] {
  const { view, windowRole, sessions, runtime, activeId } = input
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
  // Presets start Ops sessions in a folder; Code sessions belong to a worktree, so Code mode does not offer them.
  if (input.mode === 'ops') {
    for (const preset of input.presets ?? []) {
      items.push({
        id: `action:preset:${preset.id}`,
        group: 'Actions',
        label: `New session: ${preset.name}`,
        detail: presetDetail(preset),
        keywords: `preset create start ${preset.cwd}`,
        run: { kind: 'new-from-preset', presetId: preset.id }
      })
    }
  }
  // D69: only offered while something needs you (the bell list is empty otherwise).
  if (needsYouItems(sessions, runtime).length > 0) {
    items.push({
      id: 'action:next-attention',
      group: 'Actions',
      label: 'Next session that needs you',
      detail: 'Jump to the next bell (Ctrl+Shift+Down)',
      keywords: 'attention bell waiting needs you next triage',
      run: { kind: 'step-attention', delta: 1 }
    })
    items.push({
      id: 'action:previous-attention',
      group: 'Actions',
      label: 'Previous session that needs you',
      detail: 'Jump to the previous bell (Ctrl+Shift+Up)',
      keywords: 'attention bell waiting needs you previous triage',
      run: { kind: 'step-attention', delta: -1 }
    })
  }
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
  if (view !== 'grid') {
    items.push({
      id: 'action:open-grid',
      group: 'Actions',
      label: 'Open grid view',
      detail: 'See several sessions at once (1x1 to 3x2)',
      keywords: 'grid layout panes multiple',
      run: { kind: 'open-grid' }
    })
  } else {
    items.push({
      id: 'action:exit-grid',
      group: 'Actions',
      label: 'Exit grid view',
      detail: 'Back to one terminal (the grid is kept for next time)',
      keywords: 'grid close leave single terminal',
      run: { kind: 'exit-grid' }
    })
  }
  // D53: Jarvis lives in Ops mode; opening it from Code switches the main window to Ops (main's focus request).
  items.push({
    id: 'action:open-jarvis',
    group: 'Actions',
    label: 'Open Jarvis',
    detail: 'The assistant that controls SessionDeck (Ctrl+Shift+J)',
    keywords: 'jarvis assistant ai agent control hub chat',
    run: { kind: 'open-jarvis' }
  })
  items.push({
    id: 'action:reset-jarvis',
    group: 'Actions',
    label: 'Jarvis: start a new conversation',
    detail: 'Jarvis forgets the current conversation and starts fresh',
    keywords: 'jarvis reset clear new conversation restart assistant',
    run: { kind: 'reset-jarvis' }
  })
  items.push({
    id: 'action:search-conversations',
    group: 'Actions',
    label: 'Search conversations',
    detail: 'Find text in past Claude conversations of your sessions',
    keywords: 'search find history transcript conversation grep',
    run: { kind: 'search-conversations' }
  })
  // D74: the viewer shows a file for a session, so it needs one on screen (not the Hub or no open tab).
  if (view !== 'hub' && findOpenSession(sessions, activeId) !== null) {
    items.push({
      id: 'action:preview-file',
      group: 'Actions',
      label: 'Preview file...',
      detail: 'Open a file in the side panel viewer (Markdown, text, images, CSV, XLSX, DOCX)',
      keywords: 'preview view open file markdown image csv xlsx docx side panel reader',
      run: { kind: 'preview-file' }
    })
  }
  items.push({
    id: 'action:show-costs',
    group: 'Actions',
    label: 'Show cost report',
    detail: 'Cost per day and per session (last 30 days)',
    keywords: 'cost usage spend money dollars report chart',
    run: { kind: 'show-costs' }
  })
  items.push({
    id: 'action:open-settings',
    group: 'Actions',
    label: 'Open Settings',
    detail: 'Sound, statuses, agents and more',
    keywords: 'preferences options config',
    run: { kind: 'open-settings' }
  })
  // G10: a shortcut to the diagnostics section, which lives behind a tab in Settings.
  items.push({
    id: 'action:open-settings-diagnostics',
    group: 'Actions',
    label: 'Settings: Diagnostics',
    detail: 'Open the diagnostics section of Settings directly',
    keywords: 'settings diagnostics health troubleshooting logs errors',
    run: { kind: 'open-settings-diagnostics' }
  })
  // The away summary dialog lives in the main window only (one summary), so the Code window does not offer it.
  if (windowRole === 'main') {
    items.push({
      id: 'action:show-away-summary',
      group: 'Actions',
      label: 'Show "While you were away"',
      detail: 'What happened since you left',
      keywords: 'away summary timeline activity',
      run: { kind: 'show-away-summary' }
    })
  }
  return [...items, ...modeItems(input)]
}

/** G10: jump items for the most used tags; opening the first tagged session uses the normal session command. */
function tagItems(sessions: readonly Session[]): readonly PaletteItem[] {
  return allTags(sessions)
    .slice(0, PALETTE_TAG_LIMIT)
    .flatMap(({ tag, count }): readonly PaletteItem[] => {
      const first = sessions.find((session: Session): boolean =>
        (session.tags ?? []).some((candidate: string): boolean => candidate.toLowerCase() === tag.toLowerCase())
      )
      if (first === undefined) return []
      return [{
        id: `tag:${tag.toLowerCase()}`,
        group: 'Sessions',
        label: `Tag: ${tag}`,
        detail: `${count} session${count === 1 ? '' : 's'}`,
        keywords: `tag label jump goto filter ${tag}`,
        run: { kind: 'open-session', id: first.id }
      }]
    })
}

/** Every palette item in builder order: Sessions, then This session, then Actions. */
export function buildPaletteItems(input: PaletteInput): readonly PaletteItem[] {
  const { sessions, statuses, runtime, activeId } = input
  const sessionItems = sortedSessions(sessions, runtime).map(
    (session: Session): PaletteItem => sessionItem(session, runtime.get(session.id), statuses)
  )
  const active = findOpenSession(sessions, activeId)
  const thisItems =
    active === null ? [] : thisSessionItems(active, runtime.get(active.id), statuses, input.repos ?? [], input.worktrees ?? [])
  return [...sessionItems, ...tagItems(sessions), ...thisItems, ...actionItems(input)]
}

/**
 * The palette is mounted even while closed, and runtime publishes rebuild the store ~10 times a second.
 * Sharing one frozen empty array keeps the closed palette out of the localeCompare/build path entirely;
 * this seam also lets a unit test spy on the builder without rendering React.
 */
export const EMPTY_PALETTE_ITEMS: readonly PaletteItem[] = Object.freeze([])

/** Builds items only while the palette is open; opening re-runs the builder with the then-current runtime. */
export function paletteItemsWhenOpen(
  open: boolean,
  build: () => readonly PaletteItem[]
): readonly PaletteItem[] {
  return open ? build() : EMPTY_PALETTE_ITEMS
}
