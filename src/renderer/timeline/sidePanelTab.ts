// Which tab the side panel shows (Notes, Activity or Changes), remembered across launches.
// localStorage can be blocked, so every access is guarded and falls back to Notes.
// Changes exists only for worktree (Code mode) sessions; elsewhere a stored 'changes' shows Notes.

export type SidePanelTab = 'notes' | 'activity' | 'changes'

export const SIDE_PANEL_TAB_KEY = 'sessiondeck.sidepanel.tab.v1'
export const DEFAULT_SIDE_PANEL_TAB: SidePanelTab = 'notes'

export function parseSidePanelTab(raw: string | null): SidePanelTab {
  if (raw === 'activity' || raw === 'changes') {
    return raw
  }
  return DEFAULT_SIDE_PANEL_TAB
}

/** The tabs a session offers: Changes only for a worktree session. */
export function sidePanelTabsFor(hasChanges: boolean): readonly SidePanelTab[] {
  return hasChanges ? ['notes', 'activity', 'changes'] : ['notes', 'activity']
}

/** The tab to show: a stored Changes tab falls back to Notes when the session has no worktree. */
export function resolveSidePanelTab(stored: SidePanelTab, hasChanges: boolean): SidePanelTab {
  if (stored === 'changes' && !hasChanges) {
    return DEFAULT_SIDE_PANEL_TAB
  }
  return stored
}

export function readSidePanelTab(key: string = SIDE_PANEL_TAB_KEY): SidePanelTab {
  try {
    return parseSidePanelTab(window.localStorage.getItem(key))
  } catch (error: unknown) {
    console.warn('SessionDeck: could not read the side panel tab; using Notes', error)
    return DEFAULT_SIDE_PANEL_TAB
  }
}

export function storeSidePanelTab(tab: SidePanelTab, key: string = SIDE_PANEL_TAB_KEY): void {
  try {
    window.localStorage.setItem(key, tab)
  } catch (error: unknown) {
    console.warn('SessionDeck: could not save the side panel tab; it lasts this session only', error)
  }
}
