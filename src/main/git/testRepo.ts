// Test helpers: real git repositories in the OS temp dir. Used only by *.test.ts files.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const GIT_IDENTITY = ['-c', 'user.name=t', '-c', 'user.email=t@t']

const tempDirs: string[] = []

/** Runs git synchronously (setup only). Returns trimmed stdout. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', [...GIT_IDENTITY, ...args], { cwd, encoding: 'utf8', windowsHide: true }).trim()
}

/** Creates a fresh temp directory, removed by cleanupTempDirs(). Returns its real (symlink-free) path. */
export function makeTempDir(label: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `sd-git-${label}-`))
  tempDirs.push(dir)
  return realpathSync.native(dir)
}

export function cleanupTempDirs(): void {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function writeText(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
}

/**
 * A repo on branch main with README.md, a.txt, b.txt, c.txt and gone.txt committed.
 * Returns the repo path and the commit sha of main.
 */
export function makeRepo(label: string): { readonly repo: string; readonly mainSha: string } {
  const repo = makeTempDir(label)
  git(repo, 'init', '-b', 'main')
  for (const name of ['README.md', 'a.txt', 'b.txt', 'c.txt', 'gone.txt']) {
    writeText(path.join(repo, name), `${name} line 1\nline 2\nline 3\n`)
  }
  git(repo, 'add', '-A')
  git(repo, 'commit', '-m', 'initial')
  return { repo, mainSha: git(repo, 'rev-parse', 'HEAD') }
}

/** Adds a linked worktree on a new branch `branch` from `base`. Returns its real path and base commit. */
export function addWorktree(repo: string, branch: string, base = 'main'): { readonly dir: string; readonly baseCommit: string } {
  const parent = makeTempDir('wt')
  const dir = path.join(parent, branch.replace(/\//g, '-'))
  git(repo, 'worktree', 'add', '-b', branch, dir, base)
  return { dir: realpathSync.native(dir), baseCommit: git(repo, 'rev-parse', base) }
}
