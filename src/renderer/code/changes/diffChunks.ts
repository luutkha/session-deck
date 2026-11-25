// Pure chunk plan for long diffs (W4-G): mount 200 rows at a time and keep every chunk once mounted.
// No React, no DOM, no IPC.
export const DIFF_CHUNK_SIZE = 200
/** Up to this many rows render as one chunk, exactly as before: no placeholders, no observer. */
export const SMALL_DIFF_MAX_ROWS = 600
/** Chunks mounted before the viewport is consulted (and again after a file change). */
export const INITIAL_MOUNTED_CHUNKS = 3
/** How far above/below the scroll viewport a placeholder becomes real rows. */
export const DIFF_CHUNK_ROOT_MARGIN_PX = 1500
/**
 * The diff body sets leading-[18px] and every text span is whitespace-pre, so a row never wraps.
 * Hunk headers add mt-1 + a border (a few px); that difference is corrected when the chunk mounts.
 */
export const DIFF_ROW_HEIGHT_PX = 18

export interface DiffChunk {
  readonly index: number
  /** First row index, inclusive. */
  readonly start: number
  /** Last row index, exclusive. */
  readonly end: number
  readonly rows: number
}

/** Splits a row count into contiguous chunks; a small diff stays one chunk so its rendering is unchanged. */
export function chunkRows(count: number, size: number = DIFF_CHUNK_SIZE): readonly DiffChunk[] {
  if (!Number.isFinite(count) || count <= 0) return []
  const floored = Math.floor(size)
  const safeSize = Number.isFinite(size) && floored > 0 ? floored : DIFF_CHUNK_SIZE
  if (count <= SMALL_DIFF_MAX_ROWS) return [{ index: 0, start: 0, end: count, rows: count }]
  const chunks: DiffChunk[] = []
  for (let start = 0; start < count; start += safeSize) {
    const end = Math.min(start + safeSize, count)
    chunks.push({ index: chunks.length, start, end, rows: end - start })
  }
  return chunks
}

/** The chunks mounted before any intersection event (or after switching files). */
export function initialMountedChunks(total: number): ReadonlySet<number> {
  const mounted = new Set<number>()
  for (let index = 0; index < Math.min(total, INITIAL_MOUNTED_CHUNKS); index += 1) mounted.add(index)
  return mounted
}

/**
 * Adds intersecting chunks to the mounted set and never removes one. Returns the same set when nothing
 * changed, so a stray observer callback does not re-render the diff.
 */
export function nextMountedChunks(
  mounted: ReadonlySet<number>,
  visible: readonly number[],
  total: number
): ReadonlySet<number> {
  const next: Set<number> = new Set(initialMountedChunks(total))
  for (const index of mounted) if (index >= 0 && index < total) next.add(index)
  for (const index of visible) if (Number.isInteger(index) && index >= 0 && index < total) next.add(index)
  if (next.size === mounted.size && [...next].every((index) => mounted.has(index))) return mounted
  return next
}
