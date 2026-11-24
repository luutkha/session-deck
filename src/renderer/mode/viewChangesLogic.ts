// "View changes" in a session tab's menu (Code mode): the side panel must show its Changes tab and, the first time,
// be wide enough to read a diff. The width rule is pure so it is unit-tested; the workspace owns state and storage.
import { SIDE_PANEL_WIDTH_DEFAULT, SIDE_PANEL_WIDTH_PREVIEW } from '../shell/sidePanelWidth'

export interface ViewChangesPanelPlan {
  /** The panel is closed and must be opened (an open panel would toggle shut). */
  readonly open: boolean
  /** A wider panel to save now, or null to keep the width the panel has. */
  readonly width: number | null
}

/**
 * What showing the Changes tab must do to the panel: open it when closed, and widen it to the preview width the first
 * time — but only from the default width, so a width the user chose is never overridden.
 */
export function planViewChangesPanel(input: {
  readonly notesOpen: boolean
  readonly width: number
  readonly widened: boolean
}): ViewChangesPanelPlan {
  const width = !input.widened && input.width === SIDE_PANEL_WIDTH_DEFAULT ? SIDE_PANEL_WIDTH_PREVIEW : null
  return { open: !input.notesOpen, width }
}
