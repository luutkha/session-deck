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

  it('keeps the last, short chunk', () => {
    const chunks = chunkRows(801)
    expect(chunks.length).toBe(5)
    expect(chunks[4]).toEqual({ index: 4, start: 800, end: 801, rows: 1 })
  })

  it('falls back to the default size for a bad size', () => {
    expect(chunkRows(1000, 0).length).toBe(chunkRows(1000, DIFF_CHUNK_SIZE).length)
    expect(chunkRows(1000, 0.5).length).toBe(chunkRows(1000, DIFF_CHUNK_SIZE).length)
  })
})

describe('mounted chunk decision', () => {
  it('mounts the first few chunks immediately', () => {
    expect(initialMountedChunks(10)).toEqual(new Set([0, 1, 2]))
    expect(nextMountedChunks(new Set(), [], 10)).toEqual(new Set([0, 1, 2]))
    expect(INITIAL_MOUNTED_CHUNKS).toBe(3)
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
