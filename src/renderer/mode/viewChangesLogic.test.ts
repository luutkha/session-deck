import { describe, expect, it } from 'vitest'
import { SIDE_PANEL_WIDTH_DEFAULT, SIDE_PANEL_WIDTH_PREVIEW } from '../shell/sidePanelWidth'
import { planViewChangesPanel } from './viewChangesLogic'

describe('planViewChangesPanel', () => {
  it('opens a closed panel and leaves an open one alone', () => {
    expect(planViewChangesPanel({ notesOpen: false, width: 400, widened: true })).toEqual({ open: true, width: null })
    expect(planViewChangesPanel({ notesOpen: true, width: 400, widened: true })).toEqual({ open: false, width: null })
  })

  it('widens a default-width panel on the first request, like the file preview does', () => {
    expect(planViewChangesPanel({ notesOpen: true, width: SIDE_PANEL_WIDTH_DEFAULT, widened: false })).toEqual({
      open: false,
      width: SIDE_PANEL_WIDTH_PREVIEW
    })
  })

  it('never overrides a width the user chose', () => {
    expect(planViewChangesPanel({ notesOpen: true, width: SIDE_PANEL_WIDTH_DEFAULT + 1, widened: false }).width).toBeNull()
    expect(planViewChangesPanel({ notesOpen: true, width: SIDE_PANEL_WIDTH_PREVIEW, widened: false }).width).toBeNull()
  })

  it('widens only once, even when the width is back at the default', () => {
    expect(planViewChangesPanel({ notesOpen: true, width: SIDE_PANEL_WIDTH_DEFAULT, widened: true }).width).toBeNull()
  })
})
