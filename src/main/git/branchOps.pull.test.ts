// D60: fetch and fast-forward pull against real temp repositories; the bare repo in the temp folder is the "origin".
import { appendFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { fetchBranch, pullBranch } from './branchStatus'
import { commitPaths } from './commit'
import { runGit, type GitRun } from './gitRunner'
import { addWorktree, cleanupTempDirs, git, makeRepo, makeTempDir } from './testRepo'

afterAll(() => cleanupTempDirs())

/** runGit with a fixed identity, so commits work on a PC without user.name/user.email. */
const run: GitRun = (args, options) => runGit(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], options)

function repoWithOrigin(label: string): { repo: string; origin: string } {
  const { repo } = makeRepo(label)
  const origin = makeTempDir(`${label}-origin`)
  git(origin, 'init', '--bare', '-b', 'main')
  git(repo, 'remote', 'add', 'origin', origin)
  git(repo, 'push', '-q', 'origin', 'main')
  return { repo, origin }
}

/** A second clone that simulates somebody else pushing a commit to the same branch. */
function pushFromClone(origin: string, label: string, branch: string, fileName: string, content: string): void {
  const clone = makeTempDir(`${label}-clone`)
  git(clone, 'clone', '-q', '-b', branch, origin, '.')
  appendFileSync(path.join(clone, fileName), `${content}\n`)
  git(clone, 'add', '-A')
  git(clone, 'commit', '-qm', `${label} commit`)
  git(clone, 'push', '-q', 'origin', branch)
}

const refFor = (dir: string) => ({ id: 'w', path: dir, baseBranch: 'main' })

/** Git checks out CRLF on Windows; compare file contents with LF line endings only. */
const readLf = (file: string): string => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

describe('fetchBranch + pullBranch', () => {
  it('fast-forwards to a pushed commit and reports an up-to-date pull as no update', async () => {
    const { repo, origin } = repoWithOrigin('pull-ff')
    const wt = addWorktree(repo, 'feat-x')
    const ref = refFor(wt.dir)
    appendFileSync(path.join(wt.dir, 'a.txt'), 'mine\n')
    await commitPaths({ worktreePath: wt.dir, message: 'mine', paths: ['a.txt'] }, run)
    git(wt.dir, 'push', '-qu', 'origin', 'feat-x')
    pushFromClone(origin, 'theirs', 'feat-x', 'incoming.txt', 'from remote')

    const before = git(wt.dir, 'rev-parse', 'HEAD')
    expect(await fetchBranch(ref, run)).toEqual({ remote: 'origin' })
    expect(await pullBranch(ref, run)).toEqual({ remote: 'origin', branch: 'feat-x', updated: true })
    const after = git(wt.dir, 'rev-parse', 'HEAD')
    expect(after).not.toBe(before)
    expect(after).toBe(git(origin, 'rev-parse', 'refs/heads/feat-x'))
    expect(readLf(path.join(wt.dir, 'incoming.txt'))).toBe('from remote\n')
    expect(await pullBranch(ref, run)).toEqual({ remote: 'origin', branch: 'feat-x', updated: false })
    expect(git(wt.dir, 'rev-parse', 'HEAD')).toBe(after)
  })

  it('refuses a diverged branch without moving HEAD', async () => {
    const { repo, origin } = repoWithOrigin('pull-diverged')
    const wt = addWorktree(repo, 'shared')
    const ref = refFor(wt.dir)
    appendFileSync(path.join(wt.dir, 'mine.txt'), 'mine\n')
    await commitPaths({ worktreePath: wt.dir, message: 'mine', paths: ['mine.txt'] }, run)
    git(wt.dir, 'push', '-qu', 'origin', 'shared')
    pushFromClone(origin, 'theirs', 'shared', 'theirs.txt', 'theirs')
    appendFileSync(path.join(wt.dir, 'local.txt'), 'local\n')
    await commitPaths({ worktreePath: wt.dir, message: 'local', paths: ['local.txt'] }, run)

    const before = git(wt.dir, 'rev-parse', 'HEAD')
    await expect(pullBranch(ref, run)).rejects.toThrow('The branch has diverged from origin/shared; pull or rebase in the session')
    expect(git(wt.dir, 'rev-parse', 'HEAD')).toBe(before)
  })

  it('explains a missing remote and a branch that was never pushed', async () => {
    const { repo } = makeRepo('pull-no-remote')
    const lonely = refFor(addWorktree(repo, 'lonely').dir)
    await expect(fetchBranch(lonely, run)).rejects.toThrow('no remote')
    await expect(pullBranch(lonely, run)).rejects.toThrow('no remote')

    const { repo: withOrigin } = repoWithOrigin('pull-never-pushed')
    const unpushed = refFor(addWorktree(withOrigin, 'unpushed').dir)
    expect(await fetchBranch(unpushed, run)).toEqual({ remote: 'origin' })
    await expect(pullBranch(unpushed, run)).rejects.toThrow('nothing to pull: the branch was never pushed')
  })

  it('keeps uncommitted work that the pulled commits do not touch', async () => {
    const { repo, origin } = repoWithOrigin('pull-keep-work')
    const wt = addWorktree(repo, 'keep-work')
    const ref = refFor(wt.dir)
    git(wt.dir, 'push', '-qu', 'origin', 'keep-work')
    pushFromClone(origin, 'theirs', 'keep-work', 'incoming.txt', 'from remote')
    appendFileSync(path.join(wt.dir, 'a.txt'), 'not committed\n')

    expect(await pullBranch(ref, run)).toEqual({ remote: 'origin', branch: 'keep-work', updated: true })
    expect(readLf(path.join(wt.dir, 'a.txt'))).toBe('a.txt line 1\nline 2\nline 3\nnot committed\n')
    expect(git(wt.dir, 'status', '--porcelain')).toContain('a.txt')
  })

  it('refuses a pull that would overwrite an uncommitted file, leaving it untouched', async () => {
    const { repo, origin } = repoWithOrigin('pull-overwrite')
    const wt = addWorktree(repo, 'dirty')
    const ref = refFor(wt.dir)
    git(wt.dir, 'push', '-qu', 'origin', 'dirty')
    const clone = makeTempDir('overwrite-clone')
    git(clone, 'clone', '-q', '-b', 'dirty', origin, '.')
    appendFileSync(path.join(clone, 'a.txt'), 'theirs\n')
    git(clone, 'commit', '-qam', 'theirs')
    git(clone, 'push', '-q', 'origin', 'dirty')
    appendFileSync(path.join(wt.dir, 'a.txt'), 'mine\n')

    const before = git(wt.dir, 'rev-parse', 'HEAD')
    await expect(pullBranch(ref, run)).rejects.toThrow('The branch has diverged from origin/dirty; pull or rebase in the session')
    expect(git(wt.dir, 'rev-parse', 'HEAD')).toBe(before)
    expect(readLf(path.join(wt.dir, 'a.txt'))).toBe('a.txt line 1\nline 2\nline 3\nmine\n')
  })

  it('refuses to pull in a detached HEAD', async () => {
    const { repo } = repoWithOrigin('pull-detached')
    const wt = addWorktree(repo, 'detached')
    git(wt.dir, 'switch', '-q', '--detach')
    await expect(pullBranch(refFor(wt.dir), run)).rejects.toThrow('detached HEAD')
  })
})
