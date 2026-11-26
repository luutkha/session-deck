import { describe, expect, it } from 'vitest'
import {
  DIFF_CHUNK_SIZE,
  INITIAL_MOUNTED_CHUNKS,
  SMALL_DIFF_MAX_ROWS,
  chunkRows,
  initialMountedChunks,
  nextMountedChunks
} from './diffChunks'

describe('chunkRows', () => {
  it('has no chunks for an empty diff', () => {
    expect(chunkRows(0)).toEqual([])
    expect(chunkRows(-1)).toEqual([])
  })

  it('has no chunks for a non-finite row count', () => {
    expect(chunkRows(Number.NaN)).toEqual([])
    expect(chunkRows(Number.POSITIVE_INFINITY)).toEqual([])
  })

  it('keeps a small diff as a single chunk, so it renders exactly as before', () => {
    const chunks = chunkRows(SMALL_DIFF_MAX_ROWS)
    expect(chunks).toEqual([{ index: 0, start: 0, end: SMALL_DIFF_MAX_ROWS, rows: SMALL_DIFF_MAX_ROWS }])
    expect(chunkRows(450).length).toBe(1)
  })

  it('splits a long diff into contiguous chunks of the wanted size', () => {
    const chunks = chunkRows(DIFF_CHUNK_SIZE * 4, DIFF_CHUNK_SIZE)
    expect(chunks.map((chunk) => chunk.index)).toEqual([0, 1, 2, 3])
    expect(chunks.map((chunk) => chunk.start)).toEqual([0, 200, 400, 600])
    expect(chunks.map((chunk) => chunk.end)).toEqual([200, 400, 600, 800])
    expect(chunks.map((chunk) => chunk.rows)).toEqual([200, 200, 200, 200])
  })

  it('starts chunking only just past the small-diff boundary', () => {
    expect(chunkRows(SMALL_DIFF_MAX_ROWS - 1).length).toBe(1)
    const chunks = chunkRows(SMALL_DIFF_MAX_ROWS + 1)
    expect(chunks.map((chunk) => chunk.index)).toEqual([0, 1, 2, 3])
    expect(chunks[0]?.end).toBe(DIFF_CHUNK_SIZE)
    expect(chunks[3]).toEqual({ index: 3, start: 600, end: 601, rows: 1 })
  })

  it('keeps the last, short chunk', () => {
    const chunks = chunkRows(801)
    expect(chunks.length).toBe(5)
    expect(chunks[4]).toEqual({ index: 4, start: 800, end: 801, rows: 1 })
  })

  it('covers a very long diff with contiguous chunks and no gaps or overlaps', () => {
    const chunks = chunkRows(10_000)
    expect(chunks.length).toBe(50)
    expect(chunks[0]?.start).toBe(0)
    expect(chunks[49]?.end).toBe(10_000)
    expect(chunks.reduce((sum, chunk) => sum + chunk.rows, 0)).toBe(10_000)
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index]
      expect(chunk.index).toBe(index)
      expect(chunk.end - chunk.start).toBe(chunk.rows)
      expect(chunk.rows).toBeGreaterThan(0)
      expect(chunk.rows).toBeLessThanOrEqual(DIFF_CHUNK_SIZE)
      if (index > 0) expect(chunks[index - 1]?.end).toBe(chunk.start)
    }
  })

  it('honours a custom chunk size and floors a fractional one', () => {
    const chunks = chunkRows(1001, 64)
    expect(chunks.length).toBe(16)
    expect(chunks[15]).toEqual({ index: 15, start: 960, end: 1001, rows: 41 })
    expect(chunkRows(1001, 1.9)[1]?.start).toBe(1)
  })

  it('falls back to the default size for a bad size', () => {
    expect(chunkRows(1000, 0).length).toBe(chunkRows(1000, DIFF_CHUNK_SIZE).length)
    expect(chunkRows(1000, 0.5).length).toBe(chunkRows(1000, DIFF_CHUNK_SIZE).length)
    expect(chunkRows(1000, -5).length).toBe(chunkRows(1000, DIFF_CHUNK_SIZE).length)
    expect(chunkRows(1000, Number.NaN).length).toBe(chunkRows(1000, DIFF_CHUNK_SIZE).length)
    expect(chunkRows(1000, Number.POSITIVE_INFINITY).length).toBe(chunkRows(1000, DIFF_CHUNK_SIZE).length)
  })
})

describe('mounted chunk decision', () => {
  it('mounts the first few chunks immediately', () => {
    expect(initialMountedChunks(10)).toEqual(new Set([0, 1, 2]))
    expect(nextMountedChunks(new Set(), [], 10)).toEqual(new Set([0, 1, 2]))
    expect(INITIAL_MOUNTED_CHUNKS).toBe(3)
  })

  it('has no chunks to mount for an empty diff', () => {
    expect(initialMountedChunks(0)).toEqual(new Set<number>())
    const mounted = new Set<number>()
    expect(nextMountedChunks(mounted, [0, 1], 0)).toBe(mounted)
  })

  it('adds an intersecting chunk to the mounted set', () => {
    const current = initialMountedChunks(10)
    expect(nextMountedChunks(current, [5], 10)).toEqual(new Set([0, 1, 2, 5]))
    expect(current).toEqual(new Set([0, 1, 2]))
  })

  it('never unmounts a chunk once it has been mounted', () => {
    const mounted = nextMountedChunks(initialMountedChunks(10), [4, 7], 10)
    expect(nextMountedChunks(mounted, [], 10)).toBe(mounted)
    expect(nextMountedChunks(mounted, [1], 10)).toBe(mounted)
  })

  it('mounts only the one chunk of a small diff', () => {
    expect(initialMountedChunks(1)).toEqual(new Set([0]))
    expect(nextMountedChunks(new Set(), [], 1)).toEqual(new Set([0]))
    expect(nextMountedChunks(new Set(), [0, 1, 2], 1)).toEqual(new Set([0]))
  })

  it('mounts chunks one at a time as the viewport reaches them, without unmounting', () => {
    const first = nextMountedChunks(new Set<number>(), [5], 12)
    expect(first).toEqual(new Set([0, 1, 2, 5]))
    const second = nextMountedChunks(first, [9], 12)
    expect(second).toEqual(new Set([0, 1, 2, 5, 9]))
    expect(second).not.toBe(first)
    expect(nextMountedChunks(second, [2], 12)).toBe(second)
    expect(nextMountedChunks(second, [], 12)).toBe(second)
  })

  it('ignores non-integer and non-finite visible indexes', () => {
    const mounted = new Set([0, 1, 2])
    expect(nextMountedChunks(mounted, [1.5, Number.NaN, Number.POSITIVE_INFINITY, -2, 10], 10)).toBe(mounted)
  })

  it('drops mounted chunks above the new row count when a diff shrinks', () => {
    expect(nextMountedChunks(new Set([0, 1, 2, 7]), [], 2)).toEqual(new Set([0, 1]))
    expect(nextMountedChunks(new Set([0, 1, 2, 7]), [0, 3], 2)).toEqual(new Set([0, 1]))
  })

  it('ignores out-of-range indexes and drops stale ones when the diff shrinks', () => {
    expect(nextMountedChunks(new Set([0, 12]), [-1, 10, 20], 10)).toEqual(new Set([0, 1, 2]))
    const mounted = nextMountedChunks(new Set<number>(), [5], 10)
    expect(nextMountedChunks(mounted, [], 4)).toEqual(new Set([0, 1, 2]))
  })

  it('returns the same set when nothing changed', () => {
    const mounted = new Set([0, 1, 2])
    expect(nextMountedChunks(mounted, [0, 1], 10)).toBe(mounted)
  })
})
