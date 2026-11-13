// Worktree changes: a caller that must see a file it just wrote never gets a run that started before the write (the git
// slot limit keeps runs in flight longer, which made this visible: Jarvis "has nothing uncommitted" right after a write).
import { describe, expect, it, vi } from 'vitest'
import type { WorktreeChanges } from '../../shared/types'
import { SessionStore } from '../store'
import { emptyStore } from '../store/reducers'
import { createCodeWiring } from './codeWiring'
import type { SessionController } from './sessionController'

const runs: Array<{ resolve: (changes: WorktreeChanges) => void }> = []

vi.mock('../git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../git')>()
  return {
    ...actual,
    readWorktreeChanges: vi.fn((worktree: { id: string }) => new Promise<WorktreeChanges>((resolve) => {
      runs.push({ resolve: (changes) => resolve({ ...changes, worktreeId: worktree.id }) })
    }))
  }
})

function changes(file: string | null): WorktreeChanges {
  return {
    worktreeId: 'w',
    files: file === null ? [] : [{ path: file, kind: 'untracked', additions: 1, deletions: 0, uncommitted: true }],
    computedAt: 1
  } as unknown as WorktreeChanges
}

function setup() {
  runs.length = 0
  const store = new SessionStore(emptyStore(), { schedule: () => {} }, { newId: () => 'id', now: () => 1 })
  const repo = store.addRepo({ name: 'r', path: process.cwd() })
  const worktree = store.addWorktree({ repoId: repo.id, name: 'wt', path: process.cwd(), branch: 'b', baseBranch: 'main' } as never)
  const wiring = createCodeWiring({
    store,
    controller: {} as SessionController,
    broadcast: () => undefined,
    homedir: process.cwd(),
    now: () => 1,
    onError: () => undefined,
    openExternal: async () => undefined,
    ghReady: async () => false
  })
  return { wiring, worktree }
}
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('worktree changes: fresh reads', () => {
  it('a fresh read made while a run is in flight waits for the NEXT run instead of sharing the stale one', async () => {
    const { wiring, worktree } = setup()
    const background = wiring.changes(worktree.id) // a run starts (before the file exists)
    await tick()
    const afterTheWrite = wiring.changes(worktree.id) // asked after the file was written
    expect(runs).toHaveLength(1)
    runs[0]!.resolve(changes(null))
    expect((await background).files).toHaveLength(0)
    await tick()
    expect(runs).toHaveLength(2)
    runs[1]!.resolve(changes('jarvis.txt'))
    expect((await afterTheWrite).files.map((f) => f.path)).toEqual(['jarvis.txt'])
  })

  it('several fresh reads during one run share a single trailing run', async () => {
    const { wiring, worktree } = setup()
    const first = wiring.changes(worktree.id)
    const second = wiring.changes(worktree.id)
    const third = wiring.changes(worktree.id)
    await tick()
    expect(runs).toHaveLength(1)
    runs[0]!.resolve(changes(null))
    await tick()
    expect(runs).toHaveLength(2)
    runs[1]!.resolve(changes('x.txt'))
    const results = await Promise.all([first, second, third])
    expect(results[1]).toBe(results[2])
    expect(results[1]!.files).toHaveLength(1)
    expect(results[0]!.files).toHaveLength(0)
  })
})
