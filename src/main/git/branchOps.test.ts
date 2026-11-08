// D60: commit, branch status, push, merge and delete-from-disk against real temp repositories.
// A bare repository in the temp folder is the "origin"; nothing reaches the network.
import { existsSync, appendFileSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readBranchStatus, pushBranch } from './branchStatus'
import { commitPaths, parseStatusZ, readUncommittedPaths, withIndexLock } from './commit'
import { GitError, runGit, type GitRun } from './gitRunner'
import { mergeIntoBase } from './merge'
import { createGhCheck, createPullRequest, type GhRun } from './pullRequest'
import { addWorktree, cleanupTempDirs, git, makeRepo, makeTempDir, writeText } from './testRepo'
import { deleteWorktreeFromDisk, readRemovalFacts } from './worktreeDelete'

afterAll(() => cleanupTempDirs())

/** runGit with a fixed identity, so commits work on a PC without user.name/user.email. */
const run: GitRun = (args, options) => runGit(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], options)
const noSleep = async (): Promise<void> => undefined

function repoWithOrigin(label: string): { repo: string; origin: string } {
  const { repo } = makeRepo(label)
  const origin = makeTempDir(`${label}-origin`)
  git(origin, 'init', '--bare', '-b', 'main')
  git(repo, 'remote', 'add', 'origin', origin)
  git(repo, 'push', '-q', 'origin', 'main')
  return { repo, origin }
}

describe('parseStatusZ', () => {
  it('reads staged, unstaged, untracked and both sides of a rename', () => {
    const out = ['M  a.txt', ' M b.txt', '?? new file.txt', 'R  moved.txt', 'old.txt', ' D gone.txt', ''].join('\0')
    expect([...parseStatusZ(out)].sort()).toEqual(['a.txt', 'b.txt', 'gone.txt', 'moved.txt', 'new file.txt', 'old.txt'])
  })

  it('is empty for a clean tree', () => {
    expect(parseStatusZ('').size).toBe(0)
  })
})

describe('commitPaths', () => {
  it('commits only the chosen files and leaves the others uncommitted', async () => {
    const { repo } = makeRepo('commit-some')
    const wt = addWorktree(repo, 'feat-a')
    appendFileSync(path.join(wt.dir, 'a.txt'), 'more\n')
    appendFileSync(path.join(wt.dir, 'b.txt'), 'more\n')
    writeText(path.join(wt.dir, 'docs', 'new [1].md'), 'hello\n')
    unlinkSync(path.join(wt.dir, 'gone.txt'))
    const result = await commitPaths({ worktreePath: wt.dir, message: 'feat: a and docs\n\nbody', paths: ['a.txt', 'docs/new [1].md', 'gone.txt'] }, run)
    expect(result.subject).toBe('feat: a and docs')
    expect(result.sha).toMatch(/^[0-9a-f]{40}$/)
    expect(result.files).toBe(3)
    expect([...(await readUncommittedPaths(wt.dir))]).toEqual(['b.txt'])
    expect(git(wt.dir, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual(['a.txt', 'docs/new [1].md', 'gone.txt'])
  })

  it('refuses an empty message, no files and a path that has nothing to commit', async () => {
    const { repo } = makeRepo('commit-refuse')
    const wt = addWorktree(repo, 'feat-b')
    appendFileSync(path.join(wt.dir, 'a.txt'), 'more\n')
    await expect(commitPaths({ worktreePath: wt.dir, message: '   ', paths: ['a.txt'] }, run)).rejects.toThrow('Write a commit message')
    await expect(commitPaths({ worktreePath: wt.dir, message: 'x', paths: [] }, run)).rejects.toThrow('at least one file')
    await expect(commitPaths({ worktreePath: wt.dir, message: 'x', paths: ['c.txt'] }, run)).rejects.toThrow('Nothing to commit for c.txt')
  })

  it('waits for an index.lock another git holds for a moment (D60 race with background status)', async () => {
    const { repo } = makeRepo('commit-lock')
    const wt = addWorktree(repo, 'feat-lock')
    appendFileSync(path.join(wt.dir, 'a.txt'), 'more\n')
    const lock = path.resolve(wt.dir, git(wt.dir, 'rev-parse', '--git-path', 'index.lock'))
    writeFileSync(lock, '')
    setTimeout(() => rmSync(lock, { force: true }), 900)
    const result = await commitPaths({ worktreePath: wt.dir, message: 'after the lock', paths: ['a.txt'] }, run)
    expect(result.subject).toBe('after the lock')
  })

  it('gives up on a lock that stays', async () => {
    let calls = 0
    const busy = async (): Promise<never> => { calls += 1; throw new GitError("fatal: Unable to create 'C:/r/.git/index.lock': File exists.") }
    await expect(withIndexLock(busy, async () => undefined)).rejects.toThrow('index.lock')
    expect(calls).toBe(6)
    await expect(withIndexLock(async () => { throw new GitError('fatal: other') }, async () => undefined)).rejects.toThrow('other')
  })

  it('explains a missing git identity in plain words', async () => {
    const { repo } = makeRepo('commit-ident')
    const wt = addWorktree(repo, 'feat-c')
    appendFileSync(path.join(wt.dir, 'a.txt'), 'more\n')
    const noIdentity: GitRun = async (args, options) => {
      if (args.includes('commit')) throw new GitError('fatal: unable to auto-detect email address (got \'t@PC.(none)\')')
      return run(args, options)
    }
    await expect(commitPaths({ worktreePath: wt.dir, message: 'x', paths: ['a.txt'] }, noIdentity)).rejects.toThrow('Git does not know who you are')
  })
})

describe('readBranchStatus + pushBranch', () => {
  it('counts work to push before the first push, then ahead/behind against the upstream', async () => {
    const { repo, origin } = repoWithOrigin('status-push')
    const wt = addWorktree(repo, 'fix-login')
    const ref = { id: 'w1', path: wt.dir, baseBranch: 'main' }
    appendFileSync(path.join(wt.dir, 'a.txt'), 'more\n')
    let status = await readBranchStatus(ref, { run })
    expect(status).toMatchObject({ branch: 'fix-login', remote: 'origin', upstream: null, ahead: 0, behind: 0, uncommitted: 1, repoFolder: false, compareUrl: null })
    await commitPaths({ worktreePath: wt.dir, message: 'fix', paths: ['a.txt'] }, run)
    status = await readBranchStatus(ref, { run })
    expect(status.ahead).toBe(1)
    expect(status.uncommitted).toBe(0)
    expect(await pushBranch(ref, run)).toEqual({ remote: 'origin', branch: 'fix-login' })
    expect(git(origin, 'rev-parse', 'refs/heads/fix-login')).toBe(git(wt.dir, 'rev-parse', 'HEAD'))
    status = await readBranchStatus(ref, { run })
    expect(status).toMatchObject({ upstream: 'origin/fix-login', ahead: 0, behind: 0 })
  })

  it('gives the GitHub compare page for a GitHub remote and asks gh only then', async () => {
    const { repo } = makeRepo('status-gh')
    const wt = addWorktree(repo, 'feat/x')
    git(repo, 'remote', 'add', 'origin', 'git@github.com:acme/shop.git')
    let asked = 0
    const status = await readBranchStatus({ id: 'w', path: wt.dir, baseBranch: 'main' }, { run, ghReady: async () => { asked += 1; return true } })
    expect(status.compareUrl).toBe('https://github.com/acme/shop/compare/main...feat/x?expand=1')
    expect(status.ghReady).toBe(true)
    expect(asked).toBe(1)
  })

  it('has no remote: status says so and push explains', async () => {
    const { repo } = makeRepo('no-remote')
    const wt = addWorktree(repo, 'lonely')
    const ref = { id: 'w', path: wt.dir, baseBranch: 'main' }
    expect((await readBranchStatus(ref, { run })).remote).toBeNull()
    await expect(pushBranch(ref, run)).rejects.toThrow('no remote to push to')
  })

  it('refuses a push the remote rejects, without forcing', async () => {
    const { repo, origin } = repoWithOrigin('rejected')
    const wt = addWorktree(repo, 'shared')
    const ref = { id: 'w', path: wt.dir, baseBranch: 'main' }
    appendFileSync(path.join(wt.dir, 'a.txt'), 'mine\n')
    await commitPaths({ worktreePath: wt.dir, message: 'mine', paths: ['a.txt'] }, run)
    await pushBranch(ref, run)
    // Someone else pushes to the same branch.
    const other = makeTempDir('other-clone')
    git(other, 'clone', '-q', '-b', 'shared', origin, '.')
    appendFileSync(path.join(other, 'b.txt'), 'theirs\n')
    git(other, 'commit', '-qam', 'theirs')
    git(other, 'push', '-q', 'origin', 'shared')
    appendFileSync(path.join(wt.dir, 'c.txt'), 'mine again\n')
    await commitPaths({ worktreePath: wt.dir, message: 'mine again', paths: ['c.txt'] }, run)
    await expect(pushBranch(ref, run)).rejects.toThrow('never force-pushes')
  })

  it('a missing folder comes back as an error, not a throw', async () => {
    const status = await readBranchStatus({ id: 'w', path: path.join(makeTempDir('gone'), 'nope'), baseBranch: 'main' }, { run })
    expect(status.error).toBeTruthy()
  })
})

describe('mergeIntoBase', () => {
  it('merges committed work into the base in the repository folder', async () => {
    const { repo } = makeRepo('merge-ok')
    const wt = addWorktree(repo, 'feat-m')
    appendFileSync(path.join(wt.dir, 'a.txt'), 'feature\n')
    await commitPaths({ worktreePath: wt.dir, message: 'feature', paths: ['a.txt'] }, run)
    const result = await mergeIntoBase({ repoPath: repo, worktreePath: wt.dir, branch: 'feat-m', baseBranch: 'main' }, run)
    expect(result).toEqual({ merged: true, message: 'Merged feat-m into main.' })
    expect(git(repo, 'log', '-1', '--format=%P').split(' ')).toHaveLength(2) // a merge commit (--no-ff)
    const again = await mergeIntoBase({ repoPath: repo, worktreePath: wt.dir, branch: 'feat-m', baseBranch: 'main' }, run)
    expect(again.merged).toBe(false)
    expect(again.message).toContain('Already up to date')
  })

  it('refuses uncommitted work, a dirty repo folder and a repo folder on another branch', async () => {
    const { repo } = makeRepo('merge-guards')
    const wt = addWorktree(repo, 'feat-g')
    const input = { repoPath: repo, worktreePath: wt.dir, branch: 'feat-g', baseBranch: 'main' }
    appendFileSync(path.join(wt.dir, 'a.txt'), 'x\n')
    await expect(mergeIntoBase(input, run)).rejects.toThrow('1 uncommitted file')
    await commitPaths({ worktreePath: wt.dir, message: 'x', paths: ['a.txt'] }, run)
    appendFileSync(path.join(repo, 'b.txt'), 'dirty\n')
    await expect(mergeIntoBase(input, run)).rejects.toThrow('repository folder has uncommitted changes')
    git(repo, 'checkout', '-q', '--', 'b.txt')
    git(repo, 'checkout', '-q', '-b', 'other')
    await expect(mergeIntoBase(input, run)).rejects.toThrow('is on other, not main')
  })

  it('undoes a conflicting merge and lists the files', async () => {
    const { repo } = makeRepo('merge-conflict')
    const wt = addWorktree(repo, 'feat-c')
    writeText(path.join(wt.dir, 'a.txt'), 'theirs\n')
    await commitPaths({ worktreePath: wt.dir, message: 'theirs', paths: ['a.txt'] }, run)
    writeText(path.join(repo, 'a.txt'), 'ours\n')
    git(repo, 'commit', '-qam', 'ours')
    const before = git(repo, 'rev-parse', 'HEAD')
    const result = await mergeIntoBase({ repoPath: repo, worktreePath: wt.dir, branch: 'feat-c', baseBranch: 'main' }, run)
    expect(result.merged).toBe(false)
    expect(result.conflicts).toEqual(['a.txt'])
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(before)
    expect(git(repo, 'status', '--porcelain')).toBe('')
  })
})

describe('deleteWorktreeFromDisk', () => {
  it('removes the folder and a merged branch', async () => {
    const { repo } = makeRepo('del-merged')
    const wt = addWorktree(repo, 'done')
    const target = { repoPath: repo, path: wt.dir, branch: 'done', baseBranch: 'main' }
    expect(await readRemovalFacts(target, run)).toEqual({ uncommitted: 0, branchMerged: true, folderExists: true })
    const result = await deleteWorktreeFromDisk(target, { discardChanges: false, deleteUnmergedBranch: false }, { run, sleep: noSleep })
    expect(result).toEqual({ folderDeleted: true, branchDeleted: true })
    expect(existsSync(wt.dir)).toBe(false)
    expect(git(repo, 'branch', '--list', 'done')).toBe('')
  })

  it('keeps an unmerged branch unless told, and refuses uncommitted files unless told', async () => {
    const { repo } = makeRepo('del-unmerged')
    const wt = addWorktree(repo, 'wip')
    const target = { repoPath: repo, path: wt.dir, branch: 'wip', baseBranch: 'main' }
    appendFileSync(path.join(wt.dir, 'a.txt'), 'work\n')
    await commitPaths({ worktreePath: wt.dir, message: 'work', paths: ['a.txt'] }, run)
    appendFileSync(path.join(wt.dir, 'b.txt'), 'unsaved\n')
    expect(await readRemovalFacts(target, run)).toEqual({ uncommitted: 1, branchMerged: false, folderExists: true })
    await expect(deleteWorktreeFromDisk(target, { discardChanges: false, deleteUnmergedBranch: false }, { run, sleep: noSleep })).rejects.toThrow('1 uncommitted file')
    expect(existsSync(wt.dir)).toBe(true)
    const kept = await deleteWorktreeFromDisk(target, { discardChanges: true, deleteUnmergedBranch: false }, { run, sleep: noSleep })
    expect(kept.folderDeleted).toBe(true)
    expect(kept.branchDeleted).toBe(false)
    expect(kept.note).toContain('has commits main does not have')
    expect(git(repo, 'branch', '--list', 'wip')).toContain('wip')
  })

  it('removes the empty folder git left behind when a process still held it (Windows)', async () => {
    const { repo } = makeRepo('del-held')
    const wt = addWorktree(repo, 'held')
    let first = true
    // Real removal, but the folder "could not be deleted": git unregistered it and left it empty.
    const heldRun: GitRun = async (args, options) => {
      if (first && args[0] === 'worktree' && args[1] === 'remove') {
        first = false
        await run(args, options)
        mkdirSync(wt.dir)
        throw new GitError(`error: failed to delete '${wt.dir}': Permission denied`)
      }
      return run(args, options)
    }
    const result = await deleteWorktreeFromDisk({ repoPath: repo, path: wt.dir, branch: 'held', baseBranch: 'main' }, { discardChanges: false, deleteUnmergedBranch: false }, { run: heldRun, sleep: noSleep })
    expect(result).toEqual({ folderDeleted: true, branchDeleted: true })
    expect(existsSync(wt.dir)).toBe(false)
  })

  it('never removes a leftover folder that still has files', async () => {
    const { repo } = makeRepo('del-files')
    const wt = addWorktree(repo, 'files')
    const keepRun: GitRun = async (args, options) => {
      if (args[0] === 'worktree' && args[1] === 'remove') {
        await run(['worktree', 'remove', '--force', wt.dir], options).catch(() => undefined)
        mkdirSync(wt.dir, { recursive: true })
        writeFileSync(path.join(wt.dir, 'keep.txt'), 'mine\n')
        throw new GitError(`fatal: '${wt.dir}' is not a working tree`)
      }
      return run(args, options)
    }
    await expect(deleteWorktreeFromDisk({ repoPath: repo, path: wt.dir, branch: 'files', baseBranch: 'main' }, { discardChanges: false, deleteUnmergedBranch: false }, { run: keepRun, sleep: noSleep })).rejects.toThrow('not a working tree')
    expect(existsSync(path.join(wt.dir, 'keep.txt'))).toBe(true)
  })

  it('deletes an unmerged branch when told', async () => {
    const { repo } = makeRepo('del-force')
    const wt = addWorktree(repo, 'drop')
    appendFileSync(path.join(wt.dir, 'a.txt'), 'work\n')
    await commitPaths({ worktreePath: wt.dir, message: 'work', paths: ['a.txt'] }, run)
    const result = await deleteWorktreeFromDisk({ repoPath: repo, path: wt.dir, branch: 'drop', baseBranch: 'main' }, { discardChanges: false, deleteUnmergedBranch: true }, { run, sleep: noSleep })
    expect(result).toEqual({ folderDeleted: true, branchDeleted: true })
  })
})

describe('GitHub CLI', () => {
  it('caches "gh ready" for a minute', async () => {
    let calls = 0
    let clock = 0
    const fake: GhRun = async () => { calls += 1; return { code: 0, stdout: '', stderr: '' } }
    const ready = createGhCheck(fake, () => clock, '.')
    expect(await ready()).toBe(true)
    clock = 30_000
    expect(await ready()).toBe(true)
    expect(calls).toBe(1)
    clock = 61_000
    await ready()
    expect(calls).toBe(2)
  })

  it('creates a PR and returns the URL gh prints; an existing PR returns its URL', async () => {
    const seen: string[][] = []
    const ok: GhRun = async (args) => { seen.push([...args]); return { code: 0, stdout: 'Creating pull request...\nhttps://github.com/acme/shop/pull/7\n', stderr: '' } }
    expect(await createPullRequest({ cwd: '.', base: 'main', branch: 'fix', title: ' Fix login ', body: 'b' }, ok)).toBe('https://github.com/acme/shop/pull/7')
    expect(seen[0]).toEqual(['pr', 'create', '--base', 'main', '--head', 'fix', '--title', 'Fix login', '--body', 'b'])
    const exists: GhRun = async () => ({ code: 1, stdout: '', stderr: 'a pull request for branch "fix" into branch "main" already exists:\nhttps://github.com/acme/shop/pull/3\n' })
    expect(await createPullRequest({ cwd: '.', base: 'main', branch: 'fix', title: 't', body: '' }, exists)).toBe('https://github.com/acme/shop/pull/3')
    const fails: GhRun = async () => ({ code: 1, stdout: '', stderr: 'GraphQL: Head sha can\'t be blank\n' })
    await expect(createPullRequest({ cwd: '.', base: 'main', branch: 'fix', title: 't', body: '' }, fails)).rejects.toThrow('Head sha')
    await expect(createPullRequest({ cwd: '.', base: 'main', branch: 'fix', title: ' ', body: '' }, ok)).rejects.toThrow('title')
  })
})
