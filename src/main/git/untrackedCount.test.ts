import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { countUntrackedAdditions, UNTRACKED_COUNT_MAX_BYTES } from './untrackedCount'
import { cleanupTempDirs, makeTempDir } from './testRepo'

describe('countUntrackedAdditions', () => {
  let dir = ''

  beforeAll(() => {
    dir = makeTempDir('untracked')
    mkdirSync(dir, { recursive: true })
  })

  afterAll(() => {
    cleanupTempDirs()
  })

  function file(name: string, content: string | Buffer): string {
    const filePath = path.join(dir, name)
    writeFileSync(filePath, content)
    return filePath
  }

  it('counts the lines of a text file', async () => {
    expect(await countUntrackedAdditions(file('three.txt', 'one\ntwo\nthree\n'))).toBe(3)
  })

  it('counts a last line without a newline', async () => {
    expect(await countUntrackedAdditions(file('no-eol.txt', 'one\ntwo'))).toBe(2)
  })

  it('counts an empty file as zero lines', async () => {
    expect(await countUntrackedAdditions(file('empty.txt', ''))).toBe(0)
  })

  it('returns null for a file with a NUL byte in its first 8000 bytes', async () => {
    const content = Buffer.concat([Buffer.from('header\n'), Buffer.from([0]), Buffer.from('tail\n')])
    expect(await countUntrackedAdditions(file('binary.bin', content))).toBeNull()
  })

  it('counts a file whose NUL byte sits after the first 8000 bytes', async () => {
    const head = Buffer.from('a\n'.repeat(5000))
    const content = Buffer.concat([head, Buffer.from([0]), Buffer.from('b\n')])
    expect(await countUntrackedAdditions(file('late-nul.txt', content))).toBe(5001)
  })

  it('returns null for a file larger than 1 MiB', async () => {
    const content = Buffer.alloc(UNTRACKED_COUNT_MAX_BYTES + 1, 'x')
    expect(await countUntrackedAdditions(file('huge.txt', content))).toBeNull()
  })

  it('returns null for a folder (for example a nested repository)', async () => {
    const nested = path.join(dir, 'nested')
    mkdirSync(nested)
    expect(await countUntrackedAdditions(nested)).toBeNull()
  })
})
