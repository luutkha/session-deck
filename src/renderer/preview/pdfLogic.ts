// Pure rules of the PDF body (D75): fit scale, zoom ladder, page boxes and the page at a scroll
// offset, plus canvas pixel budgeting. No pdfjs and no DOM: vitest runs this file in Node.
import { nextZoomStep } from './fileViewZoom'

export const PDF_ZOOM_MIN = 50
export const PDF_ZOOM_MAX = 300
export const PDF_ZOOM_STEPS: readonly number[] = [50, 75, 100, 125, 150, 200, 300]
/** Vertical gap between pages and the padding around them; the layout uses the same numbers. */
export const PDF_PAGE_GAP = 12
export const PDF_VIEW_PADDING = 16
/** A page canvas never exceeds this many device pixels (memory stays bounded at high zoom). */
export const PDF_MAX_CANVAS_PIXELS = 16_000_000

export interface PdfPageSize {
  readonly width: number
  readonly height: number
}

export interface PdfPageBox extends PdfPageSize {
  readonly index: number
  /** Offset of the page top from the top of the scrollable content. */
  readonly top: number
}

export interface PdfVisibleRange {
  /** Inclusive first page index to draw; end is -1 when nothing is visible. */
  readonly start: number
  readonly end: number
}

export interface PdfCanvasSize {
  readonly width: number
  readonly height: number
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

export function clampPdfZoom(percent: number): number {
  if (!Number.isFinite(percent)) return 100
  return Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, Math.round(percent)))
}

/** One ladder step; an off-ladder value (the fit percentage) moves to the next step past it. */
export function stepPdfZoom(currentPercent: number, direction: 1 | -1): number {
  return clampPdfZoom(nextZoomStep(currentPercent, direction, PDF_ZOOM_STEPS))
}

/** Scale that makes a page of `pageWidth` fit the pane; 1 when there is no usable width yet. */
export function fitPdfScale(
  containerWidth: number,
  pageWidth: number,
  padding: number = PDF_VIEW_PADDING * 2
): number {
  if (!positiveFinite(containerWidth) || !positiveFinite(pageWidth)) return 1
  const usable = containerWidth - Math.max(0, padding)
  if (!positiveFinite(usable)) return 1
  return Math.min(4, Math.max(0.05, usable / pageWidth))
}

/** Page tops/heights at a scale, so the current page needs no DOM reads. */
export function pdfPageBoxes(
  pages: readonly PdfPageSize[],
  scale: number,
  gap: number = PDF_PAGE_GAP,
  padding: number = PDF_VIEW_PADDING
): readonly PdfPageBox[] {
  const safeScale = positiveFinite(scale) ? scale : 1
  const safeGap = Number.isFinite(gap) && gap > 0 ? gap : 0
  let top = Number.isFinite(padding) && padding > 0 ? padding : 0
  const boxes: PdfPageBox[] = []
  pages.forEach((page: PdfPageSize, index: number): void => {
    const width = positiveFinite(page.width) ? page.width * safeScale : 1
    const height = positiveFinite(page.height) ? page.height * safeScale : 1
    boxes.push({ index, top, width, height })
    top += height + safeGap
  })
  return boxes
}

/** The page at the top edge of the viewport: a gap belongs to the page above it. */
export function pdfCurrentPage(boxes: readonly PdfPageBox[], scrollTop: number): number {
  const reference = Number.isFinite(scrollTop) ? scrollTop + 1 : 0
  let current = 0
  for (const box of boxes) {
    if (box.top > reference) break
    current = box.index
  }
  return current
}

/** Inclusive page range within one viewport of margin above and below (used for tests/debug). */
export function pdfVisibleRange(
  boxes: readonly PdfPageBox[],
  scrollTop: number,
  viewportHeight: number,
  margin?: number
): PdfVisibleRange {
  if (boxes.length === 0) return { start: 0, end: -1 }
  const top = Number.isFinite(scrollTop) ? scrollTop : 0
  const height = positiveFinite(viewportHeight) ? viewportHeight : 0
  const pad = margin !== undefined && Number.isFinite(margin) ? Math.max(0, margin) : height
  const from = top - pad
  const to = top + height + pad
  let start = -1
  let end = -1
  boxes.forEach((box: PdfPageBox): void => {
    if (box.top + box.height < from || box.top > to) return
    if (start === -1) start = box.index
    end = box.index
  })
  return start === -1 ? { start: 0, end: -1 } : { start, end }
}

/** Device-pixel size of a page canvas: devicePixelRatio sharpness, capped at a pixel budget. */
export function pdfCanvasSize(
  width: number,
  height: number,
  scale: number,
  devicePixelRatio: number,
  maxPixels: number = PDF_MAX_CANVAS_PIXELS
): PdfCanvasSize {
  const safeScale = positiveFinite(scale) ? scale : 1
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? Math.min(devicePixelRatio, 4) : 1
  let pixelsWide = Math.max(1, Math.round(Math.max(1, width) * safeScale * ratio))
  let pixelsHigh = Math.max(1, Math.round(Math.max(1, height) * safeScale * ratio))
  const budget = Number.isFinite(maxPixels) && maxPixels > 0 ? maxPixels : PDF_MAX_CANVAS_PIXELS
  const area = pixelsWide * pixelsHigh
  if (area > budget) {
    const factor = Math.sqrt(budget / area)
    pixelsWide = Math.max(1, Math.floor(pixelsWide * factor))
    pixelsHigh = Math.max(1, Math.floor(pixelsHigh * factor))
  }
  return { width: pixelsWide, height: pixelsHigh }
}

export function pdfPercentLabel(scale: number): string {
  if (!Number.isFinite(scale) || scale <= 0) return '100%'
  return `${String(Math.round(scale * 100))}%`
}

/** "Page 3 / 12" from a 0-based current page; a document without pages has no label. */
export function pdfPageLabel(current: number, total: number): string {
  if (!Number.isFinite(total) || total <= 0) return 'No pages'
  const safeCurrent = Number.isFinite(current) ? Math.min(Math.max(Math.trunc(current), 0), total - 1) : 0
  return `Page ${String(safeCurrent + 1)} / ${String(total)}`
}

/** pdf.js marks a locked document with this error name; main hides the bytes otherwise. */
export function isPasswordError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'PasswordException'
}

/** A cancelled render rejects on purpose when a page scrolls away; it is not a failure. */
export function isRenderCancelled(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'RenderingCancelledException'
}
