// D60: pull requests through the GitHub CLI (`gh`) when it is installed and signed in. execFile, no shell.
// Without gh the caller opens the host's compare page in the browser instead (remoteHost.compareUrl).
import { execFile } from 'node:child_process'
import { GitError } from './gitRunner'

export const GH_TIMEOUT_MS = 60_000
export const GH_CHECK_TTL_MS = 60_000
export const PR_TITLE_MAX = 256
export const PR_BODY_MAX = 20_000

export interface GhResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export type GhRun = (args: readonly string[], cwd: string) => Promise<GhResult>

/** Runs gh; a missing gh resolves with code -1 (never throws). gh never prompts here. */
export const runGh: GhRun = (args, cwd) =>
  new Promise<GhResult>((resolve) => {
    execFile('gh', [...args], {
      cwd,
      windowsHide: true,
      timeout: GH_TIMEOUT_MS,
      encoding: 'utf8',
      env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' }
    }, (error, stdout, stderr) => {
      const failure = error as (NodeJS.ErrnoException & { code?: string | number }) | null
      if (failure === null) resolve({ code: 0, stdout, stderr })
      else resolve({ code: typeof failure.code === 'number' ? failure.code : -1, stdout: stdout ?? '', stderr: stderr ?? '' })
    })
  })

/** Remembers "gh installed and signed in" for a minute, so the Changes panel's status polls stay cheap. */
export function createGhCheck(run: GhRun, now: () => number, cwd: string): () => Promise<boolean> {
  let cached: { at: number; ready: boolean } | null = null
  return async (): Promise<boolean> => {
    if (cached !== null && now() - cached.at < GH_CHECK_TTL_MS) return cached.ready
    const result = await run(['auth', 'status'], cwd)
    cached = { at: now(), ready: result.code === 0 }
    return cached.ready
  }
}

export interface CreatePrInput {
  readonly cwd: string
  readonly base: string
  readonly branch: string
  readonly title: string
  readonly body: string
}

/** `gh pr create`; returns the PR URL gh prints. Throws a GitError with gh's reason. */
export async function createPullRequest(input: CreatePrInput, run: GhRun = runGh): Promise<string> {
  const title = input.title.trim().slice(0, PR_TITLE_MAX)
  if (title.length === 0) throw new GitError('Give the pull request a title.')
  const result = await run(['pr', 'create', '--base', input.base, '--head', input.branch, '--title', title, '--body', input.body.slice(0, PR_BODY_MAX)], input.cwd)
  const url = result.stdout.split(/\r?\n/).map((l) => l.trim()).reverse().find((l) => /^https?:\/\//.test(l))
  if (result.code === 0 && url !== undefined) return url
  // "a pull request for branch X already exists: <url>"
  // gh prints the existing PR's URL on the line after the message.
  const existing = /already exists[\s\S]*?(https?:\/\/\S+)/i.exec(result.stderr)
  if (existing !== null) return existing[1]
  const reason = result.stderr.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0)
  throw new GitError(reason ?? 'gh pr create failed')
}
