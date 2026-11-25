// G2/G5: every poller (10 s Changes panel, 30 s sidebar badge, detached windows) reads the same worktree through IPC.
// A short TTL shares one scan; only an internal change (Stop hook, commit, discard, ...) forces a new one and refreshes
// the cache. The clock is injected through deps.now, so nothing here waits in real time.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HookEvent, WorktreeChanges } from '../../shared/types'
import { SessionStore } from '../store'
import { emptyStore } from '../store/reducers'
import { CHANGES_AFTER_TURN_MS, CHANGES_CACHE_TTL_MS, createCodeWiring } from './codeWiring'
import { commitPaths } from '../git'
import type { SessionController } from './sessionController'

const runs: Array<{ resolve: (changes: WorktreeChanges) => void }> = []
let broadcasted: WorktreeChanges[] = []

vi.mock('../git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../git')>()
  return {
    ...actual,
    readWorktreeChanges: vi.fn((worktree: { id: string }) => new Promise<WorktreeChanges>((resolve) => {
      runs.push({ resolve: (changes) => resolve({ ...changes, worktreeId: worktree.id }) })
    })),
    commitPaths: vi.fn(async (): Promise<{ sha: string; subject: string; files: number }> => ({ sha: 's', subject: 'm', files: 1 }))
  }
})

function changes(file: string | null, at = 1): WorktreeChanges {
  return {
    worktreeId: 'w',
    files: file === null ? [] : [{ path: file, kind: 'untracked', additions: 1, deletions: 0, uncommitted: true }],
    truncated: false,
    additions: file === null ? 0 : 1,
    deletions: 0,
    computedAt: at
  }
}

function setup() {
  runs.length = 0
  broadcasted = []
  let currentTime = 1000
  const store = new SessionStore(emptyStore(), { schedule: () => {} }, { newId: () => 'id', now: () => 1 })
  const repo = store.addRepo({ name: 'r', path: process.cwd() })
  const worktree = store.addWorktree({ repoId: repo.id, name: 'wt', path: process.cwd(), branch: 'b', baseBranch: 'main' } as never)
  const wiring = createCodeWiring({
    store,
    controller: { removeWorktree: (id: string) => store.removeWorktree(id) } as unknown as SessionController,
    broadcast: (_channel, changes) => { broadcasted.push(changes as WorktreeChanges) },
    homedir: process.cwd(),
    now: () => currentTime,
    onError: () => undefined,
    openExternal: async () => undefined,
    ghReady: async () => false
  })
  return { wiring, worktree, store, setTime: (t: number): void => { currentTime = t } }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('worktree changes: IPC read cache (G2/G5)', () => {
  it('two reads inside the TTL share one compute; a read after the TTL recomputes', async () => {
    const { wiring, worktree, setTime } = setup()
    const first = wiring.changes(worktree.id, true)
    runs[0]!.resolve(changes(null))
    expect((await first).files).toHaveLength(0)

    const second = await wiring.changes(worktree.id, true)
    expect(second.files).toHaveLength(0)
    expect(runs).toHaveLength(1)

    setTime(1000 + CHANGES_CACHE_TTL_MS - 1)
    expect((await wiring.changes(worktree.id, true)).files).toHaveLength(0)
    expect(runs).toHaveLength(1)

    setTime(1000 + CHANGES_CACHE_TTL_MS)
    const afterTtl = wiring.changes(worktree.id, true)
    runs[1]!.resolve(changes('later.txt'))
    expect((await afterTtl).files.map((file) => file.path)).toEqual(['later.txt'])
    expect(runs).toHaveLength(2)
  })

  it('a forced internal compute refreshes the cache: the next read returns the new result without recomputing', async () => {
    const { wiring, worktree } = setup()
    const initial = wiring.changes(worktree.id, true)
    runs[0]!.resolve(changes(null))
    await initial
    await wiring.git.commit({ worktreeId: worktree.id, message: 'm', paths: ['after.txt'] })
    await tick()
    expect(runs).toHaveLength(2)
    runs[1]!.resolve(changes('after.txt'))
    await tick()

    const read = await wiring.changes(worktree.id, true)
    expect(read.files.map((file) => file.path)).toEqual(['after.txt'])
    expect(runs).toHaveLength(2)
    // The change gate still pushes a different result to the windows, and only once.
    expect(broadcasted).toHaveLength(2)
    expect(broadcasted[1]?.files.map((file) => file.path)).toEqual(['after.txt'])
    expect(vi.mocked(commitPaths)).toHaveBeenCalledTimes(1)
  })

  it('a Stop-hook refresh forces a new compute and refreshes the cache (no real waiting)', async () => {
    vi.useFakeTimers()
    const { wiring, worktree, store } = setup()
    const initial = wiring.changes(worktree.id, true)
    runs[0]!.resolve(changes(null))
    await initial

    const session = store.createSession({ cwd: process.cwd(), worktreeId: worktree.id })
    wiring.onHookEvent({ event: 'Stop', sessionId: session.id } as HookEvent)
    await vi.advanceTimersByTimeAsync(CHANGES_AFTER_TURN_MS)
    expect(runs).toHaveLength(2)
    runs[1]!.resolve(changes('from-hook.txt'))
    await vi.advanceTimersByTimeAsync(0)

    expect((await wiring.changes(worktree.id, true)).files.map((file) => file.path)).toEqual(['from-hook.txt'])
    expect(runs).toHaveLength(2)
  })

  it('a plain read (panel mount, manual refresh, scripts) recomputes even inside the TTL; only allowCached may reuse', async () => {
    const { wiring, worktree } = setup()
    const first = wiring.changes(worktree.id, true)
    runs[0]!.resolve(changes(null))
    await first

    const plain = wiring.changes(worktree.id)
    expect(runs).toHaveLength(2)
    runs[1]!.resolve(changes('just-written.txt'))
    expect((await plain).files.map((file) => file.path)).toEqual(['just-written.txt'])

    // A background poll right after reuses that fresh result.
    expect((await wiring.changes(worktree.id, true)).files.map((file) => file.path)).toEqual(['just-written.txt'])
    expect(runs).toHaveLength(2)
  })

  it('removing a worktree drops its cache entry; a later read computes again', async () => {
    const { wiring, worktree, store } = setup()
    const initial = wiring.changes(worktree.id, true)
    runs[0]!.resolve(changes(null))
    await initial

    wiring.removeWorktree(worktree.id)
    expect(store.getWorktree(worktree.id)).toBeUndefined()
    // Pretend the same worktree id is available again: if the cache entry survived, no new run would start.
    vi.spyOn(store, 'getWorktree').mockReturnValue(worktree)
    const afterRemoval = wiring.changes(worktree.id, true)
    expect(runs).toHaveLength(2)
    runs[1]!.resolve(changes('fresh.txt'))
    expect((await afterRemoval).files.map((file) => file.path)).toEqual(['fresh.txt'])
  })

  it('concurrent reads still dedupe to one compute', async () => {
    const { wiring, worktree } = setup()
    const reads = [wiring.changes(worktree.id, true), wiring.changes(worktree.id, true), wiring.changes(worktree.id, true)]
    expect(runs).toHaveLength(1)
    runs[0]!.resolve(changes('shared.txt'))
    const results = await Promise.all(reads)
    expect(runs).toHaveLength(1)
    for (const result of results) expect(result.files.map((file) => file.path)).toEqual(['shared.txt'])
    expect((await wiring.changes(worktree.id, true)).files.map((file) => file.path)).toEqual(['shared.txt'])
    expect(runs).toHaveLength(1)
  })
})
