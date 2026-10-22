import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupTempDirs, makeRepo } from './testRepo'
import { GIT_MAX_BYTES, GIT_TIMEOUT_MS, GitError, runGit } from './gitRunner'

describe('runGit', () => {
  let repo = ''
  let mainSha = ''

  beforeAll(() => {
    ;({ repo, mainSha } = makeRepo('runner'))
  })

  afterAll(() => {
    cleanupTempDirs()
  })

  it('returns stdout and exit code 0 for a successful command', async () => {
    const result = await runGit(['rev-parse', 'HEAD'], { cwd: repo })
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe(mainSha)
  })

  it('uses the default timeout and byte limits', () => {
    expect(GIT_TIMEOUT_MS).toBe(15000)
    expect(GIT_MAX_BYTES).toBe(16 * 1024 * 1024)
  })

  it('rejects with the first stderr line when the exit code is not ok', async () => {
    const failure = runGit(['rev-parse', '--verify', 'no-such-ref^{commit}'], { cwd: repo })
    await expect(failure).rejects.toBeInstanceOf(GitError)
    await expect(failure).rejects.toThrow(/^fatal: /)
  })

  it('rejects with a generic message when the command fails without stderr', async () => {
    // `git config --get` for a missing key exits 1 and prints nothing.
    await expect(runGit(['config', '--get', 'sessiondeck.no-such-key'], { cwd: repo })).rejects.toThrow(
      'git config failed'
    )
  })

  it('resolves a non-zero exit code listed in okCodes', async () => {
    const result = await runGit(['show-ref', '--verify', '--quiet', 'refs/heads/no-such-branch'], {
      cwd: repo,
      okCodes: [0, 1]
    })
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
  })

  it('rejects with a timeout message when the command runs too long', async () => {
    // hash-object --stdin waits on stdin forever, so the timeout always fires.
    await expect(runGit(['hash-object', '--stdin'], { cwd: repo, timeoutMs: 300 })).rejects.toThrow(
      'git hash-object timed out'
    )
  })

  it('rejects with a size message when stdout exceeds maxBytes', async () => {
    await expect(runGit(['--version'], { cwd: repo, maxBytes: 4 })).rejects.toThrow('git --version output is too large')
  })

  it('rejects with the install hint when git cannot be started', async () => {
    const savedPath = process.env.PATH
    process.env.PATH = ''
    try {
      await expect(runGit(['--version'], { cwd: repo })).rejects.toThrow(
        'Git was not found. Install Git and restart SessionDeck.'
      )
    } finally {
      process.env.PATH = savedPath
    }
  })
})
