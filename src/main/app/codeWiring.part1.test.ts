// CodeWiring unit tests: the worktree rollback when its session does not start (review fix B) and the
// drive-root repo name fallback (review fix C2). git runs for real (see testRepo); only resolveRepoRoot is faked.
import { existsSync, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Id, Session } from '../../shared/types'
import { SessionStore } from '../store'
import { emptyStore } from '../store/reducers'
import { cleanupTempDirs, makeRepo } from '../git/testRepo'
import { resolveRepoRoot } from '../git'
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

  it('removes the stored worktree again and mentions the session reason', async () => {
    const createSession = vi.fn((): never => {
      throw new Error('shell not installed')
    })
    const code = wiring(store, fakeController(createSession as unknown as () => Session))

    await expect(
      code.createWorktree({ repoId, name: 'fix-login', baseBranch: 'main', agent: 'shell' })
    ).rejects.toThrow(/shell not installed/)

    expect(store.get().worktrees ?? []).toEqual([])
    let hasWorktreeSession = false
    for (const session of store.get().sessions) {
      if (session.worktreeId !== undefined) hasWorktreeSession = true
    }
    expect(hasWorktreeSession).toBe(false)
    expect(createSession).toHaveBeenCalledTimes(1)
  })

  it('keeps the created folder and branch on disk (nothing is deleted)', async () => {
    const code = wiring(store, fakeController((): never => {
      throw new Error('shell not installed')
    }))

    await expect(
      code.createWorktree({ repoId, name: 'keep-me', baseBranch: 'main', agent: 'shell' })
    ).rejects.toThrow(/files stay on disk/)

    expect(existsSync(join(worktreesRoot, 'my-app', 'keep-me'))).toBe(true)
  })

  it('a successful create keeps the worktree in the store', async () => {
    const session = { id: 'sess-1' } as unknown as Session
    const code = wiring(store, fakeController((): Session => session))

    const result = await code.createWorktree({ repoId, name: 'second', baseBranch: 'main', agent: 'shell' })

    expect(store.getWorktree(result.worktree.id)).toEqual(result.worktree)
    expect(result.worktree.branch).toBe('second')
  })
})

describe('addRepo of a drive root (review fix C2)', () => {
  it('names the repo with the repoFolderName fallback instead of an empty basename', async () => {
    // A drive root has no basename ('' for D:\), so addRepo must fall back to a usable name.
    vi.mocked(resolveRepoRoot).mockResolvedValue('D:\\')

    const store = new SessionStore(emptyStore(), { schedule: () => {} }, {
      newId: () => 'id-1',
      now: () => 1000
    })
    const code = wiring(store, fakeController((): never => {
      throw new Error('createSession not called by addRepo')
    }))

    const repo = await code.addRepo('D:\\some-subfolder')

    expect(repo.name).toBe('d')
    expect(repo.path).toBe('D:\\')
  })
})
