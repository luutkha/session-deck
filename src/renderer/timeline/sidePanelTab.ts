// Which tab the side panel shows (Notes, Activity, Queue, Changes or the D73 Preview), remembered across launches.
// localStorage can be blocked, so every access is guarded and falls back to Notes.
// Changes exists only for worktree (Code mode) sessions; elsewhere a stored 'changes' shows Notes.
// Preview exists only while a file request is open; elsewhere a stored 'preview' shows Notes too.

export type SidePanelTab = 'notes' | 'activity' | 'queue' | 'changes' | 'preview'

export const SIDE_PANEL_TAB_KEY = 'sessiondeck.sidepanel.tab.v1'
export const DEFAULT_SIDE_PANEL_TAB: SidePanelTab = 'notes'

export function parseSidePanelTab(raw: string | null): SidePanelTab {
  if (raw === 'activity' || raw === 'queue' || raw === 'changes' || raw === 'preview') {
    return raw
  }
  return DEFAULT_SIDE_PANEL_TAB
}

/** The tabs a session offers: Changes only for a worktree session, Preview only while a file request is open. */
export function sidePanelTabsFor(hasChanges: boolean, hasPreview = false): readonly SidePanelTab[] {
  const tabs: SidePanelTab[] = hasChanges ? ['notes', 'activity', 'queue', 'changes'] : ['notes', 'activity', 'queue']
  return hasPreview ? [...tabs, 'preview'] : tabs
}

/** The tab to show: a stored tab the session cannot offer falls back to Notes. */
export function resolveSidePanelTab(stored: SidePanelTab, hasChanges: boolean, hasPreview = false): SidePanelTab {
  if (stored === 'changes' && !hasChanges) {
    return DEFAULT_SIDE_PANEL_TAB
  }
  if (stored === 'preview' && !hasPreview) {
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
