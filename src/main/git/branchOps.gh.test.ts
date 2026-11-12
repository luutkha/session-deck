// D60: GitHub CLI (gh) check and pull-request creation, with a fake gh runner.
import { describe, expect, it } from 'vitest'
import { createGhCheck, createPullRequest, type GhRun } from './pullRequest'



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
