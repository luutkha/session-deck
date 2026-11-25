import { appendFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { splitHunks, discardFile, discardHunk } from './discard'
import { type GitRun, runGit } from './gitRunner'
import { addWorktree, cleanupTempDirs, git, makeRepo, writeText } from './testRepo'
import { readFileDiff } from './worktreeFileDiff'
import { readWorktreeChanges, type WorktreeRef } from './worktreeChanges'

const NOW = 1_700_000_000_000
const now = (): number => NOW
const HUNKS_FILE = 'hunks.txt'
const SPACE_FILE = 'with space.txt'
const CHANGED_LINES = new Set([2, 10, 18])
const HUNKS_CONTENT = Array.from({ length: 20 }, (_, index) => `line ${String(index + 1).padStart(2, '0')}`)
const NOTHING_UNCOMMITTED = 'Nothing uncommitted to discard in this file.'
const STALE = 'This file changed since the diff was shown. Reload and try again.'
const NOT_IN_LIST = 'File is not in the changes list.'

let repo = ''
let counter = 0

function setUp(label: string): WorktreeRef {
  counter += 1
  const { dir, baseCommit } = addWorktree(repo, `${label}-${counter}`)
  return { id: `wt-${counter}`, path: dir, baseBranch: 'main', baseCommit }
}

/** core.autocrlf makes git write CRLF into checkouts; compare text, not the physical line endings. */
function content(filePath: string): string {
  return readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n')
}

function original(name: string): string {
  return content(path.join(repo, name))
}

function heading(hunk: string): string {
  return hunk.split(/\r?\n/)[0] ?? ''
}

/** Commits a long tracked file to main so a diff against the base has three separated hunks. */
function changeThreeLines(wt: WorktreeRef): string {
  const content = HUNKS_CONTENT.map((line, index) => (CHANGED_LINES.has(index + 1) ? `${line} changed` : line)).join('\n') + '\n'
  writeText(path.join(wt.path, HUNKS_FILE), content)
  return content
}

beforeAll(() => {
  ;({ repo } = makeRepo('discard'))
  writeText(path.join(repo, HUNKS_FILE), HUNKS_CONTENT.join('\n') + '\n')
  writeText(path.join(repo, SPACE_FILE), 'space one\nspace two\n')
  git(repo, 'add', HUNKS_FILE, SPACE_FILE)
  git(repo, 'commit', '-m', 'fixtures')
})

afterAll(() => {
  cleanupTempDirs()
})

describe('discardFile', () => {
  it('restores a modified file from HEAD', async () => {
    const wt = setUp('modified')
    const file = path.join(wt.path, 'a.txt')
    appendFileSync(file, 'line 4\n')
    const current = await readWorktreeChanges(wt, now)
    expect(current.files.find((entry) => entry.path === 'a.txt')?.uncommitted).toBe(true)
    expect(await discardFile(wt, 'a.txt', current)).toEqual({ ok: true })
    expect(content(file)).toBe(original('a.txt'))
  })

  it('restores a deleted file', async () => {
    const wt = setUp('deleted')
    const file = path.join(wt.path, 'gone.txt')
    unlinkSync(file)
    const current = await readWorktreeChanges(wt, now)
    expect(await discardFile(wt, 'gone.txt', current)).toEqual({ ok: true })
    expect(content(file)).toBe(original('gone.txt'))
  })

  it('removes only the listed untracked file', async () => {
    const wt = setUp('untracked')
    writeText(path.join(wt.path, 'notes.md'), 'one\ntwo\n')
    const sibling = path.join(wt.path, 'sibling.md')
    writeText(sibling, 'keep me\n')
    const current = await readWorktreeChanges(wt, now)
    expect(await discardFile(wt, 'notes.md', current)).toEqual({ ok: true })
    expect(existsSync(path.join(wt.path, 'notes.md'))).toBe(false)
    expect(content(sibling)).toBe('keep me\n')
    expect(git(wt.path, 'status', '--porcelain')).toContain('sibling.md')
  })

  it('refuses a path that is not in the changes list', async () => {
    const wt = setUp('not-listed')
    const file = path.join(wt.path, 'z.txt')
    const current = await readWorktreeChanges(wt, now)
    writeText(file, 'untouched\n')
    const result = await discardFile(wt, 'z.txt', current)
    expect(result.ok).toBe(false)
    expect(result.error).toBe(NOT_IN_LIST)
    expect(content(file)).toBe('untouched\n')
  })

  it('refuses a committed-only file', async () => {
    const wt = setUp('committed')
    const file = path.join(wt.path, 'a.txt')
    appendFileSync(file, 'committed line\n')
    git(wt.path, 'add', 'a.txt')
    git(wt.path, 'commit', '-m', 'second')
    const current = await readWorktreeChanges(wt, now)
    expect(current.files.find((entry) => entry.path === 'a.txt')?.uncommitted).toBeUndefined()
    const result = await discardFile(wt, 'a.txt', current)
    expect(result.ok).toBe(false)
    expect(result.error).toBe(NOTHING_UNCOMMITTED)
    expect(content(file)).toContain('committed line')
  })

  it('restores both the index and the working tree when a file is staged and modified', async () => {
    const wt = setUp('staged-modified')
    const file = path.join(wt.path, 'a.txt')
    appendFileSync(file, 'staged line\n')
    git(wt.path, 'add', 'a.txt')
    appendFileSync(file, 'unstaged line\n')
    const current = await readWorktreeChanges(wt, now)
    expect(await discardFile(wt, 'a.txt', current)).toEqual({ ok: true })
    expect(content(file)).toBe(original('a.txt'))
    expect(git(wt.path, 'status', '--porcelain')).toBe('')
  })

  it('restores a rename and removes the new path', async () => {
    const wt = setUp('renamed')
    git(wt.path, 'mv', 'b.txt', 'b-renamed.txt')
    const current = await readWorktreeChanges(wt, now)
    expect(current.files.find((entry) => entry.path === 'b-renamed.txt')?.kind).toBe('renamed')
    expect(await discardFile(wt, 'b-renamed.txt', current)).toEqual({ ok: true })
    expect(existsSync(path.join(wt.path, 'b.txt'))).toBe(true)
    expect(content(path.join(wt.path, 'b.txt'))).toBe(original('b.txt'))
    expect(existsSync(path.join(wt.path, 'b-renamed.txt'))).toBe(false)
    expect(git(wt.path, 'status', '--porcelain')).toBe('')
  })

  it('refuses a parent-directory path', async () => {
    const wt = setUp('dotdot')
    const current = await readWorktreeChanges(wt, now)
    expect((await discardFile(wt, '../a.txt', current)).ok).toBe(false)
    expect(content(path.join(wt.path, 'a.txt'))).toBe(original('a.txt'))
  })

  it('handles paths with spaces', async () => {
    const wt = setUp('spaces')
    writeText(path.join(wt.path, 'my notes.txt'), 'one\n')
    const sibling = path.join(wt.path, 'sibling.txt')
    writeText(sibling, 'keep me\n')
    const untracked = await readWorktreeChanges(wt, now)
    expect(await discardFile(wt, 'my notes.txt', untracked)).toEqual({ ok: true })
    expect(existsSync(path.join(wt.path, 'my notes.txt'))).toBe(false)
    expect(content(sibling)).toBe('keep me\n')

    const tracked = path.join(wt.path, SPACE_FILE)
    appendFileSync(tracked, 'new line\n')
    const current = await readWorktreeChanges(wt, now)
    expect(await discardFile(wt, SPACE_FILE, current)).toEqual({ ok: true })
    expect(content(tracked)).toBe(original(SPACE_FILE))
  })
})

describe('discardHunk', () => {
  it('reverses the second of three hunks and leaves the other two', async () => {
    const wt = setUp('hunk-second')
    changeThreeLines(wt)
    const current = await readWorktreeChanges(wt, now)
    const diff = await readFileDiff(wt, HUNKS_FILE, current)
    const { hunks } = splitHunks(diff.diff)
    expect(hunks).toHaveLength(3)
    expect(await discardHunk(wt, HUNKS_FILE, 1, heading(hunks[1] ?? ''), current)).toEqual({ ok: true })
    const after = content(path.join(wt.path, HUNKS_FILE))
    expect(after).toContain('line 02 changed')
    expect(after).not.toContain('line 10 changed')
    expect(after).toContain('line 18 changed')
  })

  it('refuses a stale header or an out-of-range index without changing the file', async () => {
    const wt = setUp('stale')
    changeThreeLines(wt)
    const before = content(path.join(wt.path, HUNKS_FILE))
    const current = await readWorktreeChanges(wt, now)
    const diff = await readFileDiff(wt, HUNKS_FILE, current)
    const { hunks } = splitHunks(diff.diff)
    const result = await discardHunk(wt, HUNKS_FILE, 1, '@@ -1,1 +1,1 @@', current)
    expect(result.ok).toBe(false)
    expect(result.error).toBe(STALE)
    expect((await discardHunk(wt, HUNKS_FILE, 9, heading(hunks[0] ?? ''), current)).ok).toBe(false)
    expect(content(path.join(wt.path, HUNKS_FILE))).toBe(before)
  })

  it('refuses a hunk when the working copy changed before the apply check', async () => {
    const wt = setUp('working-copy')
    changeThreeLines(wt)
    const current = await readWorktreeChanges(wt, now)
    const diff = await readFileDiff(wt, HUNKS_FILE, current)
    const { hunks } = splitHunks(diff.diff)
    // Simulates an edit between the diff read inside discardHunk and git apply --check.
    const run: GitRun = async (args, options) => {
      if (args[0] === 'apply' && args.includes('--check')) {
        writeText(path.join(wt.path, HUNKS_FILE), HUNKS_CONTENT.map((line, index) =>
          index + 1 === 10 ? `${line} edited again` : CHANGED_LINES.has(index + 1) ? `${line} changed` : line).join('\n') + '\n')
      }
      return runGit(args, options)
    }
    const result = await discardHunk(wt, HUNKS_FILE, 1, heading(hunks[1] ?? ''), current, run)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('The working copy no longer matches this hunk.')
    expect(content(path.join(wt.path, HUNKS_FILE))).toContain('line 10 edited again')
  })

  it('refuses a hunk of an untracked file', async () => {
    const wt = setUp('untracked-hunk')
    writeText(path.join(wt.path, 'notes.md'), 'one\n')
    const current = await readWorktreeChanges(wt, now)
    const diff = await readFileDiff(wt, 'notes.md', current)
    const { hunks } = splitHunks(diff.diff)
    const result = await discardHunk(wt, 'notes.md', 0, heading(hunks[0] ?? ''), current)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Cannot discard one hunk of an untracked file. Discard the whole file instead.')
    expect(existsSync(path.join(wt.path, 'notes.md'))).toBe(true)
  })

  it('reverses a hunk of a file whose path has spaces', async () => {
    const wt = setUp('hunk-spaces')
    const file = path.join(wt.path, SPACE_FILE)
    appendFileSync(file, 'new line\n')
    const current = await readWorktreeChanges(wt, now)
    const diff = await readFileDiff(wt, SPACE_FILE, current)
    const { hunks } = splitHunks(diff.diff)
    expect(await discardHunk(wt, SPACE_FILE, 0, heading(hunks[0] ?? ''), current)).toEqual({ ok: true })
    expect(content(file)).toBe(original(SPACE_FILE))
  })
})

describe('splitHunks', () => {
  it('keeps the file header, line endings and the no-newline marker of each hunk', () => {
    const diff = 'diff --git a/f b/f\r\nindex 1..2 100644\r\n--- a/f\r\n+++ b/f\r\n' +
      '@@ -1 +1 @@\r\n-a\r\n+b\r\n\\ No newline at end of file\r\n@@ -3 +3 @@\r\n-c\r\n+d\r\n'
    const parts = splitHunks(diff)
    expect(parts.header).toContain('+++ b/f\r\n')
    expect(parts.hunks).toHaveLength(2)
    expect(parts.hunks[0]).toContain('\\ No newline at end of file\r\n')
    expect(parts.hunks[1]).toContain('+d\r\n')
    expect(parts.header + parts.hunks.join('')).toBe(diff)
  })
})
