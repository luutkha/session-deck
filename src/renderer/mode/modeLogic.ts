// Pure rules for the two UI modes (D31): which session belongs to which mode, the storage key of each
// mode, which mode a window shows, and where a focus request goes. No React, no DOM, no IPC.
import type { Id, RuntimeState, Session, StoreData, UiMode, WindowRole } from '../../shared/types'
import { needsYouItems } from '../attention/needsYou'
import { OPEN_TABS_STORAGE_KEY } from '../shell/openTabsLogic'
import { SPLIT_STORAGE_KEY } from '../split/splitLogic'
import { GRID_STORAGE_KEY } from '../grid/gridLogic'
import { SIDE_PANEL_TAB_KEY } from '../timeline/sidePanelTab'

export const MODE_STORAGE_KEY = 'sessiondeck.mode.v1'
export const DEFAULT_MODE: UiMode = 'ops'
export const VIEW_STORAGE_KEY = 'sessiondeck.view.v1'
export const NOTES_STORAGE_KEY = 'sessiondeck.notes.open.v1'
const CODE_KEY_SUFFIX = '.code'

export type NeedsYouCounts = Readonly<Record<UiMode, number>>

/** The per-mode storage keys of one workspace. Ops keys are the historical keys, unchanged. */
export interface ModeStorageKeys {
  readonly tabs: string
  readonly split: string
  readonly grid: string
  readonly view: string
  readonly notes: string
  readonly sidePanel: string
}

/** A session is a Code session when it has a worktree (D31); every other session is an Ops session. */
export function sessionMode(session: Pick<Session, 'worktreeId'>): UiMode {
  return session.worktreeId === undefined ? 'ops' : 'code'
}

export function otherMode(mode: UiMode): UiMode {
  return mode === 'ops' ? 'code' : 'ops'
}

/**
 * The store as one mode sees it: every field kept, sessions limited to that mode. Jarvis (D53) belongs to no mode:
 * it lives in its own panel, so it is never a tab, a sidebar card, a Hub card or a needs-you item.
 */
export function dataForMode(data: StoreData, mode: UiMode): StoreData {
  return { ...data, sessions: data.sessions.filter((session: Session): boolean => session.role !== 'jarvis' && sessionMode(session) === mode) }
}

/** Ops keeps the base key (so existing users keep their state); Code gets its own key. */
export function storageKeyFor(baseKey: string, mode: UiMode): string {
  return mode === 'ops' ? baseKey : `${baseKey}${CODE_KEY_SUFFIX}`
}

export function modeStorageKeys(mode: UiMode): ModeStorageKeys {
  return {
    tabs: storageKeyFor(OPEN_TABS_STORAGE_KEY, mode),
    split: storageKeyFor(SPLIT_STORAGE_KEY, mode),
    grid: storageKeyFor(GRID_STORAGE_KEY, mode),
    view: storageKeyFor(VIEW_STORAGE_KEY, mode),
    notes: storageKeyFor(NOTES_STORAGE_KEY, mode),
    sidePanel: storageKeyFor(SIDE_PANEL_TAB_KEY, mode)
  }
}

/** Anything other than the stored 'code' (garbage, missing, old values) means Ops. */
export function parseStoredMode(raw: string | null): UiMode {
  return raw === 'code' ? 'code' : DEFAULT_MODE
}

/**
 * The mode on screen. The Code window always shows Code. The main window shows Ops while Code is
 * popped out (Code lives in the other window), and its stored mode otherwise.
 */
export function effectiveMode(role: WindowRole, stored: UiMode, codePoppedOut: boolean): UiMode {
  if (role === 'code') {
    return 'code'
  }
  return codePoppedOut ? 'ops' : stored
}

/** When the Code window docks back, the main window switches to Code. Null = no change. */
export function modeAfterDock(wasPopped: boolean, isPopped: boolean): UiMode | null {
  return wasPopped && !isPopped ? 'code' : null
}

export interface FocusDecision {
  /** Mode the window must switch to before it can show the session. */
  readonly switchTo?: UiMode
}

/**
 * A request to show a session. The main window switches mode for a session of the other mode, unless
 * Code is popped out (then the Code window shows it). A window never switches while Code is popped out.
 */
export function decideFocus(currentMode: UiMode, target: UiMode, codePoppedOut: boolean): FocusDecision {
  if (target === currentMode || codePoppedOut) {
    return {}
  }
  return { switchTo: target }
}

/** Needs-you bells per mode, for the badges on the mode switch. */
export function needsYouCounts(data: StoreData | null, runtime: ReadonlyMap<Id, RuntimeState>): NeedsYouCounts {
  const count = (mode: UiMode): number =>
    data === null ? 0 : needsYouItems(dataForMode(data, mode).sessions, runtime).length
  return { ops: count('ops'), code: count('code') }
}
