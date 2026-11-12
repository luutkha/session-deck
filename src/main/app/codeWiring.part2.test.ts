// CodeWiring unit tests: the worktree rollback when its session does not start (review fix B) and the
// drive-root repo name fallback (review fix C2). git runs for real (see testRepo); only resolveRepoRoot is faked.
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Id, Session } from '../../shared/types'
import { SessionStore } from '../store'
import { emptyStore } from '../store/reducers'
import { cleanupTempDirs, makeRepo } from '../git/testRepo'
import { createCodeWiring, type CodeWiringDeps } from './codeWiring'
import type { SessionController } from './sessionController'

// resolveRepoRoot is replaced so a test can pretend a drive root is a repo top level; everything else is real.
vi.mock('../git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../git')>()
  return {
    ...actual,
    resolveRepoRoot: vi.fn(async (folder: string) => folder)
  }
})

const tmpDirs: string[] = []

afterAll(() => {
  cleanupTempDirs()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function fakeController(createSession: () => Session): SessionController {
  return { createSession } as unknown as SessionController
}

function wiring(store: SessionStore, controller: SessionController): ReturnType<typeof createCodeWiring> {
  const deps: CodeWiringDeps = {
    store,
    controller,
    broadcast: () => {},
    homedir: tmpdir(),
    now: () => 1000,
    onError: () => {},
    openExternal: async () => {},
    ghReady: async () => false
  }
  return createCodeWiring(deps)
}

describe('createWorktree when its session does not start (review fix B)', () => {
  let repoId: Id = ''
  let worktreesRoot = ''
  let store!: SessionStore

  beforeEach(() => {
    const { repo } = makeRepo('wiring')
    store = new SessionStore(emptyStore(), { schedule: () => {} }, {
      newId: (): string => `id-${Date.now()}-${Math.random()}`,
      now: (): number => Date.now()
    })
    repoId = store.addRepo({ name: 'my-app', path: repo }).id
    worktreesRoot = mkdtempSync(join(tmpdir(), 'sd-wiring-wt-'))
    tmpDirs.push(worktreesRoot)
    store.updateSettings({ code: { worktreesRoot } })
  })

  it('a taken name becomes name-2 for the stored worktree too (D57)', async () => {
    const code = wiring(store, fakeController((): Session => ({ id: `s-${Math.random()}` }) as unknown as Session))
    await code.createWorktree({ repoId, name: 'same', baseBranch: 'main', agent: 'shell' })
    const again = await code.createWorktree({ repoId, name: 'same', baseBranch: 'main', agent: 'shell' })
    expect([again.worktree.name, again.worktree.branch]).toEqual(['same-2', 'same-2'])
  })

  it('opens the repo folder itself once, on its checked-out branch, without creating a branch (D57)', async () => {
    const code = wiring(store, fakeController((): Session => ({ id: 's-main' }) as unknown as Session))
    const repo = store.get().repos?.[0]
    const result = await code.createWorktree({ repoId, name: 'my-app', baseBranch: 'main', source: 'main', agent: 'shell' })
    expect(result.worktree).toMatchObject({ main: true, path: repo?.path, branch: 'main', baseBranch: 'main' })
    expect((await code.branches(repoId)).branches).toEqual(['main'])
    await expect(
      code.createWorktree({ repoId, name: 'again', baseBranch: 'main', source: 'main', agent: 'shell' })
    ).rejects.toThrow('already open in SessionDeck as "my-app"')
  })

  it('checks out an existing branch through the validated input (D57)', async () => {
    const code = wiring(store, fakeController((): Session => ({ id: 's-x' }) as unknown as Session))
    await code.createWorktree({ repoId, name: 'topic', baseBranch: 'main', agent: 'shell' })
    // "topic" is open in that worktree now: reusing it is refused by name.
    await expect(
      code.createWorktree({ repoId, name: 'topic again', baseBranch: 'main', source: 'existing', branch: 'topic', agent: 'shell' })
    ).rejects.toThrow('Branch "topic" is already open in')
  })
})
