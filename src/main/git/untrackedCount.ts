// Line count of an untracked file, for the "additions" column. Binary and very large files are not counted.
import { lstat, readFile } from 'node:fs/promises'

export const UNTRACKED_COUNT_MAX_BYTES = 1024 * 1024
const NUL_SCAN_BYTES = 8000
const LF = 0x0a

function countLines(data: Buffer): number {
  if (data.length === 0) return 0
  let newlines = 0
  for (const byte of data) {
    if (byte === LF) newlines++
  }
  return data[data.length - 1] === LF ? newlines : newlines + 1
}

/**
 * Number of lines in an untracked file. Null when the entry is not a regular file, is larger than 1 MiB, or looks
 * binary (a NUL byte in its first 8000 bytes).
 */
export async function countUntrackedAdditions(filePath: string): Promise<number | null> {
  const info = await lstat(filePath)
  if (!info.isFile() || info.size > UNTRACKED_COUNT_MAX_BYTES) return null
  const data = await readFile(filePath)
  if (data.subarray(0, NUL_SCAN_BYTES).includes(0)) return null
  return countLines(data)
}
