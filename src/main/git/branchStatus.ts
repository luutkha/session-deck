// D60: where a worktree's branch stands (remote, upstream, ahead/behind, uncommitted files), pushing, fetching and pulling.
// Reading status never fetches: "behind" is as of the last fetch. A push never forces; a pull only fast-forwards.
import type { BranchStatus, Id, PushResult } from '../../shared/types'
import { readUncommittedPaths } from './commit'
import { GIT_FATAL_EXIT_CODE, GitError, type GitRun, runGit } from './gitRunner'
import { compareUrl } from './remoteHost'

/** Pushing talks to the network (and maybe a credential helper window). */
export const PUSH_TIMEOUT_MS = 120_000

export interface BranchRef {
  readonly id: Id
  readonly path: string
  readonly baseBranch: string
  readonly main?: boolean
}

async function text(run: GitRun, cwd: string, args: readonly string[]): Promise<string | null> {
  const result = await run(args, { cwd, okCodes: [0, 1, GIT_FATAL_EXIT_CODE] })
  const out = result.stdout.trim()
  return result.code === 0 && out.length > 0 ? out : null
}

async function currentBranch(run: GitRun, cwd: string): Promise<string | null> {
  return text(run, cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
}

/** The remote a push goes to: the upstream's remote, else "origin", else the only remote; null without remotes. */
export async function pushRemote(run: GitRun, cwd: string, branch: string | null): Promise<string | null> {
  if (branch !== null) {
    const configured = await text(run, cwd, ['config', '--get', `branch.${branch}.remote`])
    if (configured !== null && configured !== '.') return configured
  }
  const remotes = (await text(run, cwd, ['remote']))?.split(/\r?\n/).map((r) => r.trim()).filter((r) => r.length > 0) ?? []
  if (remotes.includes('origin')) return 'origin'
  return remotes.length === 1 ? remotes[0] : null
}

function counts(output: string | null): readonly [number, number] {
  const [left, right] = (output ?? '').split(/\s+/).map((n) => Number.parseInt(n, 10))
  return [Number.isFinite(left) ? left : 0, Number.isFinite(right) ? right : 0]
}

async function ghReadyDefault(): Promise<boolean> {
  return false
}

export interface BranchStatusDeps {
  readonly run?: GitRun
  /** GitHub CLI installed and signed in (cached by the caller). */
  readonly ghReady?: () => Promise<boolean>
}

/** Never throws: a failure comes back as `error` with zero counts. */
export async function readBranchStatus(wt: BranchRef, deps: BranchStatusDeps = {}): Promise<BranchStatus> {
  const run = deps.run ?? runGit
  const base: BranchStatus = {
    worktreeId: wt.id, branch: null, baseBranch: wt.baseBranch, remote: null, upstream: null, ahead: 0, behind: 0,
    uncommitted: 0, repoFolder: wt.main === true, compareUrl: null, ghReady: false
  }
  try {
    const branch = await currentBranch(run, wt.path)
    const remote = await pushRemote(run, wt.path, branch)
    const upstream = branch === null ? null : await text(run, wt.path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{upstream}`])
    // Never pushed: what a first push would send is the work the base does not have.
    const [behind, ahead] = upstream !== null
      ? counts(await text(run, wt.path, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`]))
      : [0, counts(await text(run, wt.path, ['rev-list', '--count', `${wt.baseBranch}..HEAD`]))[0]]
    const uncommitted = (await readUncommittedPaths(wt.path, run)).size
    const remoteUrl = remote === null ? null : await text(run, wt.path, ['remote', 'get-url', remote])
    const url = remoteUrl !== null && branch !== null && branch !== wt.baseBranch ? compareUrl(remoteUrl, wt.baseBranch, branch) : null
    const ghReady = remote !== null && url !== null && url.includes('/compare/') ? await (deps.ghReady ?? ghReadyDefault)() : false
    return { ...base, branch, remote, upstream, ahead, behind, uncommitted, compareUrl: url, ghReady }
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) }
  }
}

/** `git push -u <remote> <branch>` (sets the upstream on the first push). Never forces. */
export async function pushBranch(wt: BranchRef, run: GitRun = runGit): Promise<PushResult> {
  const branch = await currentBranch(run, wt.path)
  if (branch === null) throw new GitError('The worktree is not on a branch (detached HEAD); nothing to push.')
  const remote = await pushRemote(run, wt.path, branch)
  if (remote === null) throw new GitError('This repository has no remote to push to. Add one first (git remote add origin <url>).')
  // Exit 1 = git ran but refused a ref (its reason is in the full stderr, not only the first error line).
  const result = await run(['push', '-u', remote, `refs/heads/${branch}:refs/heads/${branch}`], { cwd: wt.path, timeoutMs: PUSH_TIMEOUT_MS, okCodes: [0, 1] })
  if (result.code !== 0) {
    if (/\[rejected\]|non-fast-forward|fetch first/i.test(result.stderr)) {
      throw new GitError('The remote has commits this branch does not have, so the push was refused (SessionDeck never force-pushes). Pull or rebase in the session first.')
    }
    const line = result.stderr.split(/\r?\n/).map((l) => l.trim()).find((l) => /^(fatal|error|remote): /.test(l))
    throw new GitError(line ?? 'git push failed')
  }
  return { remote, branch }
}

/** `git fetch <remote>`: update the remote-tracking refs; the worktree and its files are untouched. */
export async function fetchBranch(wt: BranchRef, run: GitRun = runGit): Promise<{ remote: string }> {
  const branch = await currentBranch(run, wt.path)
  const remote = await pushRemote(run, wt.path, branch)
  if (remote === null) throw new GitError('This repository has no remote to fetch from. Add one first (git remote add origin <url>).')
  // Fetch talks to the network like a push, so it gets the same generous timeout.
  const result = await run(['fetch', remote], { cwd: wt.path, timeoutMs: PUSH_TIMEOUT_MS })
  if (result.code !== 0) {
    const line = result.stderr.split(/\r?\n/).map((l) => l.trim()).find((l) => /^(fatal|error|remote): /.test(l))
    throw new GitError(line ?? 'git fetch failed')
  }
  return { remote }
}

/**
 * Fetch, then `git merge --ff-only <upstream>`. Never rebases, never merges a non-fast-forward, and never stashes or
 * discards uncommitted work: git itself refuses when local changes would be overwritten.
 */
export async function pullBranch(wt: BranchRef, run: GitRun = runGit): Promise<{ remote: string; branch: string; updated: boolean }> {
  const branch = await currentBranch(run, wt.path)
  if (branch === null) throw new GitError('The worktree is not on a branch (detached HEAD); nothing to pull.')
  const { remote } = await fetchBranch(wt, run)
  const before = (await run(['rev-parse', 'HEAD'], { cwd: wt.path })).stdout.trim()
  const configured = await text(run, wt.path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{upstream}`])
  let upstream: string
  if (configured !== null) {
    upstream = configured
  } else {
    const candidate = `${remote}/${branch}`
    const ref = await run(['rev-parse', '--verify', '--quiet', `refs/remotes/${candidate}`], { cwd: wt.path, okCodes: [0, 1, GIT_FATAL_EXIT_CODE] })
    if (ref.code !== 0) throw new GitError('nothing to pull: the branch was never pushed')
    upstream = candidate
  }
  // Exit 1 (git refused) and 128 ("fatal: Not possible to fast-forward") both mean no fast-forward was made.
  const merged = await run(['merge', '--ff-only', upstream], { cwd: wt.path, okCodes: [0, 1, GIT_FATAL_EXIT_CODE] })
  if (merged.code !== 0) throw new GitError(`The branch has diverged from ${upstream}; pull or rebase in the session`)
  const after = (await run(['rev-parse', 'HEAD'], { cwd: wt.path })).stdout.trim()
  return { remote, branch, updated: after !== before }
}

/** Title and body for a new PR: the last commit's subject, and the subjects of the branch's commits as a list. */
export async function pullRequestDefaults(wt: BranchRef, run: GitRun = runGit): Promise<{ readonly title: string; readonly body: string }> {
  const log = await run(['log', '--format=%s', `${wt.baseBranch}..HEAD`], { cwd: wt.path, okCodes: [0, GIT_FATAL_EXIT_CODE] })
  const subjects = log.stdout.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0)
  return { title: subjects[0] ?? '', body: subjects.length > 1 ? subjects.map((s) => `- ${s}`).join('\n') : '' }
}
