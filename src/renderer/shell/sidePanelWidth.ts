// Width of the right side panel (D73), the D70 sidebar rule mirrored: the handle sits on the panel's LEFT edge, so
// dragging left makes it wider. Pure rules; the hook (useSidePanelWidth) and the handle (SidePanelResizeHandle) use them.
export const SIDE_PANEL_WIDTH_STORAGE_KEY = 'sessiondeck.sidePanelWidth.v1'
export const SIDE_PANEL_WIDTH_DEFAULT = 320
export const SIDE_PANEL_WIDTH_MIN = 280
export const SIDE_PANEL_WIDTH_MAX = 1000
/** A table is unreadable at the default width: the first preview of a session widens the panel to this once. */
export const SIDE_PANEL_WIDTH_PREVIEW = 520
/** Arrow key step on the focused handle; Shift multiplies it. */
export const SIDE_PANEL_WIDTH_KEY_STEP = 16
export const SIDE_PANEL_WIDTH_KEY_STEP_BIG = 64
/** Space the terminal area keeps whatever the panel width is (applied in CSS as a max-width, so a small window is safe). */
export const SIDE_PANEL_KEEP_FOR_MAIN = 420

/** A width inside [MIN, MAX], rounded to whole pixels; anything that is not a finite number becomes the default. */
export function clampSidePanelWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDE_PANEL_WIDTH_DEFAULT
  return Math.min(SIDE_PANEL_WIDTH_MAX, Math.max(SIDE_PANEL_WIDTH_MIN, Math.round(value)))
}

/** The stored value, or the default for a missing, broken or out-of-range one (an out-of-range number is clamped). */
export function parseSidePanelWidth(raw: string | null): number {
  if (raw === null || raw.trim() === '') return SIDE_PANEL_WIDTH_DEFAULT
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? clampSidePanelWidth(parsed) : SIDE_PANEL_WIDTH_DEFAULT
}

/** New width for a key pressed on the handle, or null when the key does nothing there. The handle is on the left edge:
 *  ArrowLeft widens, ArrowRight narrows. */
export function sidePanelWidthForKey(width: number, key: string, shiftKey: boolean): number | null {
  const step = shiftKey ? SIDE_PANEL_WIDTH_KEY_STEP_BIG : SIDE_PANEL_WIDTH_KEY_STEP
  switch (key) {
    case 'ArrowLeft':
      return clampSidePanelWidth(width + step)
    case 'ArrowRight':
      return clampSidePanelWidth(width - step)
    case 'Home':
      return SIDE_PANEL_WIDTH_MIN
    case 'End':
      return SIDE_PANEL_WIDTH_MAX
    default:
      return null
  }
}

/** The width while dragging: where the drag started plus how far the pointer moved LEFT of it. */
export function sidePanelWidthForDrag(startWidth: number, startX: number, pointerX: number): number {
  return clampSidePanelWidth(startWidth + (startX - pointerX))
}
