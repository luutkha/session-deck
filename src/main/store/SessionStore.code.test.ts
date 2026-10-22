import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Session, StoreData } from '../../shared/types'
import { emptyStore } from './reducers'
import { SessionStore } from './SessionStore'

const SHA = 'b'.repeat(40)

function makeStore(initial: StoreData = emptyStore()) {
  const saved: StoreData[] = []
  let counter = 0
  const store = new SessionStore(
    initial,
    { schedule: (d: StoreData) => saved.push(d) },
    { newId: () => `id-${++counter}`, now: () => 5000 }
  )
  return { store, saved }
}

const WORKTREE_DRAFT = {
  repoId: '',
  branch: 'sd/feature',
  name: 'feature',
  path: resolve('/wt/feature'),
  baseBranch: 'main',
  baseCommit: SHA
}

describe('SessionStore repos', () => {
  it('addRepo stores the repo, saves it and notifies subscribers', () => {
    const { store, saved } = makeStore()
    const seen: StoreData[] = []
    store.subscribe((d) => seen.push(d))
    const repo = store.addRepo({ name: 'app', path: resolve('/src/app') })
    expect(repo).toMatchObject({ id: 'id-1', name: 'app', collapsed: false, createdAt: 5000 })
    expect(store.getRepo('id-1')).toEqual(repo)
    expect(saved).toHaveLength(1)
    expect(seen).toHaveLength(1)
  })

  it.runIf(process.platform === 'win32')('addRepo with the same path in another case and slash style returns the first repo', () => {
    const { store, saved } = makeStore()
    const first = store.addRepo({ name: 'app', path: 'C:\\Works\\App' })
    const second = store.addRepo({ name: 'copy', path: 'c:/works/app/' })
    expect(second.id).toBe(first.id)
    expect(store.get().repos).toHaveLength(1)
    expect(saved).toHaveLength(1)
  })

  it('removeRepo removes its worktrees and their sessions, and saves', () => {
    const { store, saved } = makeStore()
    const repo = store.addRepo({ name: 'app', path: resolve('/src/app') })
    const worktree = store.addWorktree({ ...WORKTREE_DRAFT, repoId: repo.id })
    store.removeRepo(repo.id)
    expect(store.getRepo(repo.id)).toBeUndefined()
    expect(store.getWorktree(worktree.id)).toBeUndefined()
    expect(store.get().repos).toEqual([])
    expect(store.get().worktrees).toEqual([])
    expect(saved.at(-1)).toBe(store.get())
  })

  it('removeRepo of an unknown id saves and notifies nothing', () => {
    const { store, saved } = makeStore()
    store.removeRepo('missing')
    expect(saved).toHaveLength(0)
  })

  it('setRepoCollapsed updates the flag', () => {
    const { store } = makeStore()
    const repo = store.addRepo({ name: 'app', path: resolve('/src/app') })
    store.setRepoCollapsed(repo.id, true)
    expect(store.getRepo(repo.id)?.collapsed).toBe(true)
  })
})

describe('SessionStore worktrees', () => {
  it('addWorktree needs a stored repo', () => {
    const { store } = makeStore()
    expect(() => store.addWorktree({ ...WORKTREE_DRAFT, repoId: 'nope' })).toThrow('Repo not found')
  })

  it('addWorktree stores the worktree under its repo', () => {
    const { store } = makeStore()
    const repo = store.addRepo({ name: 'app', path: resolve('/src/app') })
    const worktree = store.addWorktree({ ...WORKTREE_DRAFT, repoId: repo.id })
    expect(worktree).toMatchObject({ repoId: repo.id, collapsed: false, createdAt: 5000 })
    expect(store.getWorktree(worktree.id)).toEqual(worktree)
  })

  it('addWorktree twice for the same path throws Worktree already added', () => {
    const { store } = makeStore()
    const repo = store.addRepo({ name: 'app', path: resolve('/src/app') })
    store.addWorktree({ ...WORKTREE_DRAFT, repoId: repo.id })
    expect(() => store.addWorktree({ ...WORKTREE_DRAFT, repoId: repo.id })).toThrow('Worktree already added')
  })

  it('removeWorktree removes the worktree and only its sessions', () => {
    const { store } = makeStore()
    const repo = store.addRepo({ name: 'app', path: resolve('/src/app') })
    const worktree = store.addWorktree({ ...WORKTREE_DRAFT, repoId: repo.id })
    const inside = store.createSession({ cwd: worktree.path, worktreeId: worktree.id, agent: 'shell' })
    const ops = store.createSession({ cwd: resolve('/ops') })
    store.removeWorktree(worktree.id)
    const remaining = store.get().sessions.map((s: Session) => s.id)
    expect(remaining).toEqual([ops.id])
    expect(store.getRepo(repo.id)).toBeDefined()
    expect(inside.worktreeId).toBe(worktree.id)
  })

  it('setWorktreeCollapsed updates the flag', () => {
    const { store } = makeStore()
    const repo = store.addRepo({ name: 'app', path: resolve('/src/app') })
    const worktree = store.addWorktree({ ...WORKTREE_DRAFT, repoId: repo.id })
    store.setWorktreeCollapsed(worktree.id, true)
    expect(store.getWorktree(worktree.id)?.collapsed).toBe(true)
  })
})

describe('SessionStore worktree sessions', () => {
  it('createSession keeps worktreeId and leaves the session ungrouped', () => {
    const { store } = makeStore()
    const repo = store.addRepo({ name: 'app', path: resolve('/src/app') })
    const worktree = store.addWorktree({ ...WORKTREE_DRAFT, repoId: repo.id })
    const session = store.createSession({ cwd: worktree.path, worktreeId: worktree.id, agent: 'shell' })
    expect(session).toMatchObject({ worktreeId: worktree.id, groupId: null, agent: 'shell', name: 'Shell' })
    expect(session.claudeSessionId).toBeUndefined()
  })

  it('createSession with an unknown worktreeId throws and stores nothing', () => {
    const { store, saved } = makeStore()
    expect(() => store.createSession({ cwd: resolve('/x'), worktreeId: 'missing' })).toThrow('Worktree not found')
    expect(store.get().sessions).toEqual([])
    expect(saved).toHaveLength(0)
  })
})
