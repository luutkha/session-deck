// G1: the Changes scan must walk the untracked tree once. A fake GitRun records every invocation so a second full
// untracked walk (status -uall AND ls-files --others) is caught, while the parsed result stays identical to the
// fixtures the real-git tests use (tracked/untracked, rename, deletion, untracked directories, spaces/unicode, cap).
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CHANGES_MAX_FILES } from '../../shared/types'
import { type GitResult, type GitRun } from './gitRunner'
import { cleanupTempDirs, makeTempDir } from './testRepo'
import { readWorktreeChanges, type WorktreeRef } from './worktreeChanges'

const NOW = 1_700_000_000_000
const now = (): number => NOW
const BASE = 'a'.repeat(40)

let root = ''
let wt: WorktreeRef

const numstat = [
  '1\t0\ta.txt\0',
  '2\t0\tcommitted.txt\0',
  '0\t0\t\0old.txt\0new name.txt\0',
  '0\t3\tgone.txt\0'
].join('')
const nameStatus = 'M\0a.txt\0A\0committed.txt\0R100\0old.txt\0new name.txt\0D\0gone.txt\0'
const status = [
  'MM a.txt\0',
  'R  new name.txt\0old.txt\0',
  ' D gone.txt\0',
  '?? my notes.txt\0',
  '?? deep/dir/x.txt\0',
  '?? ünïcode.txt\0'
].join('')

interface Call {
  readonly args: readonly string[]
}

/** A GitRun that serves fixed fixtures and records what was asked. `ls-files` is intentionally not served. */
function fakeRun(calls: Call[], fixture: { numstat: string; nameStatus: string; status: string }): GitRun {
  return async (args): Promise<GitResult> => {
    calls.push({ args })
    const ok = (stdout: string, code = 0): GitResult => ({ stdout, stderr: '', code })
    switch (args[0]) {
      case 'merge-base':
        return ok(`${BASE}\n`)
      case 'diff':
        return ok(args.includes('--numstat') ? fixture.numstat : fixture.nameStatus)
      case 'status':
        // The same untracked files the old ls-files fixture listed; only the command count may change.
        expect(args).toContain('--untracked-files=all')
        return ok(fixture.status)
      case 'ls-files':
        throw new Error('the untracked tree must not be walked a second time')
      default:
        throw new Error(`unexpected git command: ${args.join(' ')}`)
    }
  }
}

beforeAll(() => {
  root = makeTempDir('changes-mock')
  mkdirSync(path.join(root, 'deep', 'dir'), { recursive: true })
  writeFileSync(path.join(root, 'my notes.txt'), 'x\n')
  writeFileSync(path.join(root, 'deep', 'dir', 'x.txt'), 'y\n')
  writeFileSync(path.join(root, 'ünïcode.txt'), 'z')
  wt = { id: 'w', path: root, baseBranch: 'main', baseCommit: BASE }
})

afterAll(() => {
  cleanupTempDirs()
})

describe('readWorktreeChanges with a fake git (G1)', () => {
  it('walks untracked files once and keeps every path, flag and total', async () => {
    const calls: Call[] = []
    const changes = await readWorktreeChanges(wt, now, fakeRun(calls, { numstat, nameStatus, status }))
    expect(changes.error).toBeUndefined()
    expect(calls).toHaveLength(4)
    expect(calls.map((call) => call.args[0])).toEqual(['merge-base', 'diff', 'diff', 'status'])
    expect(changes.files).toEqual([
      { path: 'a.txt', kind: 'modified', additions: 1, deletions: 0, uncommitted: true },
      { path: 'committed.txt', kind: 'added', additions: 2, deletions: 0 },
      { path: 'deep/dir/x.txt', kind: 'untracked', additions: 1, deletions: 0, uncommitted: true },
      { path: 'gone.txt', kind: 'deleted', additions: 0, deletions: 3, uncommitted: true },
      { path: 'my notes.txt', kind: 'untracked', additions: 1, deletions: 0, uncommitted: true },
      { path: 'new name.txt', oldPath: 'old.txt', kind: 'renamed', additions: 0, deletions: 0, uncommitted: true },
      { path: 'ünïcode.txt', kind: 'untracked', additions: 1, deletions: 0, uncommitted: true }
    ])
    expect(changes.additions).toBe(6)
    expect(changes.deletions).toBe(3)
    expect(changes.truncated).toBe(false)
    expect(changes.computedAt).toBe(NOW)
  })

  it('still caps at CHANGES_MAX_FILES but totals every file', async () => {
    const count = CHANGES_MAX_FILES + 1
    const manyNumstat = Array.from({ length: count }, (_, i) => `1\t0\tmany/f${String(i).padStart(3, '0')}.txt\0`).join('')
    const manyNameStatus = Array.from({ length: count }, (_, i) => `A\0many/f${String(i).padStart(3, '0')}.txt\0`).join('')
    const manyStatus = Array.from({ length: count }, (_, i) => ` A many/f${String(i).padStart(3, '0')}.txt\0`).join('')
    const calls: Call[] = []
    const changes = await readWorktreeChanges(wt, now, fakeRun(calls, { numstat: manyNumstat, nameStatus: manyNameStatus, status: manyStatus }))
    expect(calls).toHaveLength(4)
    expect(changes.files).toHaveLength(CHANGES_MAX_FILES)
    expect(changes.files[0]?.path).toBe('many/f000.txt')
    expect(changes.truncated).toBe(true)
    expect(changes.additions).toBe(count)
  })
})
