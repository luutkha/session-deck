// Which tab the side panel shows (Notes or Activity), remembered across launches.
// localStorage can be blocked, so every access is guarded and falls back to Notes.

export type SidePanelTab = 'notes' | 'activity'

export const SIDE_PANEL_TAB_KEY = 'sessiondeck.sidepanel.tab.v1'
export const DEFAULT_SIDE_PANEL_TAB: SidePanelTab = 'notes'

export function parseSidePanelTab(raw: string | null): SidePanelTab {
  return raw === 'activity' ? 'activity' : DEFAULT_SIDE_PANEL_TAB
}

export function readSidePanelTab(): SidePanelTab {
  try {
    return parseSidePanelTab(window.localStorage.getItem(SIDE_PANEL_TAB_KEY))
  } catch (error: unknown) {
    console.warn('SessionDeck: could not read the side panel tab; using Notes', error)
    return DEFAULT_SIDE_PANEL_TAB
  }
}

export function storeSidePanelTab(tab: SidePanelTab): void {
  try {
    window.localStorage.setItem(SIDE_PANEL_TAB_KEY, tab)
  } catch (error: unknown) {
    console.warn('SessionDeck: could not save the side panel tab; it lasts this session only', error)
  }
}
