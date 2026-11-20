// Zoom rules of the preview pane (D74 #6). Pure: the image ladder (10..800) and the text ladder
// (70..200) live here, plus parse/serialize of the remembered text zoom. localStorage stays in
// useTextZoom.ts so these rules are testable in Node.
export const FILE_VIEW_ZOOM_STORAGE_KEY = 'sessiondeck.fileview.zoom.v1'

export const IMAGE_ZOOM_MIN = 10
export const IMAGE_ZOOM_MAX = 800
export const TEXT_ZOOM_MIN = 70
export const TEXT_ZOOM_MAX = 200
export const DEFAULT_ZOOM = 100

export const IMAGE_ZOOM_STEPS: readonly number[] = [10, 25, 50, 75, 100, 150, 200, 300, 400, 800]
export const TEXT_ZOOM_STEPS: readonly number[] = [70, 80, 90, 100, 110, 125, 150, 175, 200]

export type ZoomDirection = 1 | -1

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ZOOM
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function clampImageZoom(percent: number): number {
  return clamp(percent, IMAGE_ZOOM_MIN, IMAGE_ZOOM_MAX)
}

export function clampTextZoom(percent: number): number {
  return clamp(percent, TEXT_ZOOM_MIN, TEXT_ZOOM_MAX)
}

/** One ladder step up (1) or down (-1); an off-ladder value moves to the next step past it. */
export function nextZoomStep(current: number, direction: ZoomDirection, steps: readonly number[]): number {
  const value = Number.isFinite(current) ? current : DEFAULT_ZOOM
  const sorted = [...steps].sort((a: number, b: number): number => a - b)
  if (sorted.length === 0) return DEFAULT_ZOOM
  if (direction === 1) {
    return sorted.find((step: number): boolean => step > value) ?? (sorted[sorted.length - 1] as number)
  }
  return [...sorted].reverse().find((step: number): boolean => step < value) ?? (sorted[0] as number)
}

/** A stored zoom; missing, broken or non-positive values fall back to 100. */
export function parseTextZoom(raw: string | null): number {
  if (raw === null) return DEFAULT_ZOOM
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_ZOOM
  return clampTextZoom(value)
}

export function serializeTextZoom(percent: number): string {
  return String(clampTextZoom(percent))
}

export function formatZoom(percent: number): string {
  return `${String(Math.round(percent))}%`
}
