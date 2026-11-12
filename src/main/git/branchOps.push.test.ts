// D60: commit, branch status, push, merge and delete-from-disk against real temp repositories.
// A bare repository in the temp folder is the "origin"; nothing reaches the network.
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readBranchStatus, pushBranch } from './branchStatus'
import { commitPaths } from './commit'
import { runGit, type GitRun } from './gitRunner'
import { addWorktree, cleanupTempDirs, git, makeRepo, makeTempDir } from './testRepo'

afterAll(() => cleanupTempDirs())

/** runGit with a fixed identity/** runGit with a fixed identity, so commits work on a PC without user.name/user.email. */
const run: GitRun = (args, options) => runGit(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], options)
function repoWithOrigin(label: string): { repo: string; origin: string } {
  const { repo } = makeRepo(label)
  const origin = makeTempDir(`${label}-origin`)
  git(origin, 'init', '--bare', '-b', 'main')
  git(repo, 'remote', 'add', 'origin', origin)
  git(repo, 'push', '-q', 'origin', 'main')
  return { repo, origin }
}


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

