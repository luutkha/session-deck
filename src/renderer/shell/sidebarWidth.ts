// Width of the sessions sidebar (D70): the user drags its edge, the value is kept in localStorage. Pure rules; the hook
// (useSidebarWidth) and the drag handle (SidebarResizeHandle) use them.
export const SIDEBAR_WIDTH_STORAGE_KEY = 'sessiondeck.sidebarWidth.v1'
export const SIDEBAR_WIDTH_DEFAULT = 300
export const SIDEBAR_WIDTH_MIN = 220
export const SIDEBAR_WIDTH_MAX = 640
/** Arrow key step on the focused handle; Shift multiplies it. */
export const SIDEBAR_WIDTH_KEY_STEP = 16
export const SIDEBAR_WIDTH_KEY_STEP_BIG = 64
/** Space the terminal area keeps whatever the sidebar width is (applied in CSS as a max-width, so a small window is safe). */
export const SIDEBAR_KEEP_FOR_MAIN = 420

/** A width inside [MIN, MAX], rounded to whole pixels; anything that is not a finite number becomes the default. */
export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_WIDTH_DEFAULT
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(value)))
}

/** The stored value, or the default for a missing, broken or out-of-range one (an out-of-range number is clamped). */
export function parseSidebarWidth(raw: string | null): number {
  if (raw === null || raw.trim() === '') return SIDEBAR_WIDTH_DEFAULT
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : SIDEBAR_WIDTH_DEFAULT
}

/** New width for a key pressed on the handle, or null when the key does nothing there. */
export function widthForKey(width: number, key: string, shiftKey: boolean): number | null {
  const step = shiftKey ? SIDEBAR_WIDTH_KEY_STEP_BIG : SIDEBAR_WIDTH_KEY_STEP
  switch (key) {
    case 'ArrowLeft':
      return clampSidebarWidth(width - step)
    case 'ArrowRight':
      return clampSidebarWidth(width + step)
    case 'Home':
      return SIDEBAR_WIDTH_MIN
    case 'End':
      return SIDEBAR_WIDTH_MAX
    default:
      return null
  }
}

/** The width while dragging: where the drag started plus how far the pointer moved. */
export function widthForDrag(startWidth: number, startX: number, pointerX: number): number {
  return clampSidebarWidth(startWidth + (pointerX - startX))
}
