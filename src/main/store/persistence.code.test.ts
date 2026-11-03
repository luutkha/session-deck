import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { StoreData } from '../../shared/types'
import { loadStoreFile, parseStoreData, saveStoreFile } from './persistence'
import { emptyStore } from './reducers'

const SHA = 'c'.repeat(40)
const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

const repo = (id: string, path = `/repos/${id}`) => ({ id, name: id, path, createdAt: 1, collapsed: false })
const worktree = (id: string, repoId: string, path = `/wt/${id}`) => ({
  id,
  repoId,
  name: id,
  branch: `sd/${id}`,
  path,
  baseBranch: 'main',
  baseCommit: SHA,
  createdAt: 2,
  collapsed: false
})
const session = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  cwd: '/x',
  groupId: null,
  statusId: null,
  order: 0,
  createdAt: 1,
  claudeArgs: [],
  claudeSessionId: UUID,
  ...extra
})

function file(extra: Record<string, unknown>): unknown {
  return { version: 1, sessions: [], groups: [], statuses: [], groupOrder: [], ...extra }
}

const tmpDirs: string[] = []

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('parseStoreData repos and worktrees', () => {
  it('keeps valid repos and worktrees', () => {
    const parsed = parseStoreData(file({ repos: [repo('r1')], worktrees: [worktree('w1', 'r1')] }))
    expect(parsed.repos).toEqual([repo('r1')])
    expect(parsed.worktrees).toEqual([worktree('w1', 'r1')])
  })

  it('drops an invalid repo entry and keeps the rest of the file', () => {
    const parsed = parseStoreData(
      file({
        repos: [repo('r1'), { id: 'bad', name: 'x', path: '', createdAt: 1, collapsed: false }, repo('r2')],
        sessions: [session('s1')]
      })
    )
    expect(parsed.repos?.map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(parsed.sessions.map((s) => s.id)).toEqual(['s1'])
  })

  it('drops a repo whose collapsed flag is not a boolean', () => {
    const parsed = parseStoreData(file({ repos: [{ ...repo('r1'), collapsed: 'yes' }] }))
    expect(parsed.repos).toEqual([])
  })

  it('keeps the first of duplicate repo ids and of duplicate repo paths', () => {
    const parsed = parseStoreData(file({ repos: [repo('r1'), repo('r1', '/other'), repo('r2', '/repos/r1')] }))
    expect(parsed.repos?.map((r) => r.id)).toEqual(['r1'])
  })

  it('drops a worktree whose repoId is unknown and keeps the others', () => {
    const parsed = parseStoreData(
      file({ repos: [repo('r1')], worktrees: [worktree('w1', 'r1'), worktree('w2', 'gone')] })
    )
    expect(parsed.worktrees?.map((w) => w.id)).toEqual(['w1'])
  })

  it('drops an invalid worktree entry and duplicate worktree ids', () => {
    const parsed = parseStoreData(
      file({
        repos: [repo('r1')],
        worktrees: [worktree('w1', 'r1'), { ...worktree('w2', 'r1'), baseCommit: 7 }, worktree('w1', 'r1', '/other')]
      })
    )
    expect(parsed.worktrees?.map((w) => w.id)).toEqual(['w1'])
  })

  it('drops a session whose worktreeId is unknown and keeps every other session', () => {
    const parsed = parseStoreData(
      file({
        repos: [repo('r1')],
        worktrees: [worktree('w1', 'r1')],
        sessions: [
          session('ops'),
          session('inside', { worktreeId: 'w1', claudeSessionId: undefined }),
          session('orphan', { worktreeId: 'missing' })
        ]
      })
    )
    expect(parsed.sessions.map((s) => s.id)).toEqual(['ops', 'inside'])
    expect(parsed.sessions[1].worktreeId).toBe('w1')
  })

  it('drops a session whose worktreeId is an empty string or not a string', () => {
    const parsed = parseStoreData(
      file({
        sessions: [session('empty', { worktreeId: '' }), session('number', { worktreeId: 4 }), session('ok')]
      })
    )
    expect(parsed.sessions.map((s) => s.id)).toEqual(['ok'])
  })

  it('a file without repos or worktrees loads with those keys absent', () => {
    const parsed = parseStoreData(file({ sessions: [session('old')] }))
    expect(parsed.repos).toBeUndefined()
    expect(parsed.worktrees).toBeUndefined()
    expect(parsed.sessions.map((s) => s.id)).toEqual(['old'])
  })

  it('empty arrays are kept as arrays', () => {
    const parsed = parseStoreData(file({ repos: [], worktrees: [] }))
    expect(parsed.repos).toEqual([])
    expect(parsed.worktrees).toEqual([])
  })
})

describe('parseStoreData shell sessions', () => {
  it('accepts a shell session without a Claude session id', () => {
    const shell = session('sh', { agent: 'shell', claudeSessionId: undefined })
    const parsed = parseStoreData(file({ sessions: [shell] }))
    expect(parsed.sessions[0]).toMatchObject({ id: 'sh', agent: 'shell' })
    expect(parsed.sessions[0].claudeSessionId).toBeUndefined()
  })

  it('still rejects an unknown agent value', () => {
    expect(() => parseStoreData(file({ sessions: [session('x', { agent: 'bash' })] }))).toThrow('"shell"')
  })
})

describe('store round trip with repos, worktrees and shell sessions', () => {
  it('save then load returns the same data', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sd-persist-'))
    tmpDirs.push(dir)
    const path = join(dir, 'store.json')
    const data: StoreData = {
      ...emptyStore(),
      repos: [repo('r1', resolve('/repos/r1'))],
      worktrees: [worktree('w1', 'r1', resolve('/wt/w1'))],
      sessions: [
        session('ops'),
        session('sh', { agent: 'shell', claudeSessionId: undefined, worktreeId: 'w1', groupId: null })
      ]
    }
    await saveStoreFile(path, data)
    const loaded = await loadStoreFile(path)
    expect(loaded.warning).toBeUndefined()
    expect(loaded.data).toEqual(data)
  })

  it('a store file saved before repos existed loads and stays free of repos', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sd-persist-'))
    tmpDirs.push(dir)
    const path = join(dir, 'store.json')
    const old = emptyStore()
    await saveStoreFile(path, old)
    const loaded = await loadStoreFile(path)
    expect(loaded.data.repos).toBeUndefined()
    expect(loaded.data).toEqual(old)
  })
})

describe('the repo-folder workspace flag (D57)', () => {
  it('keeps main: true and drops any other value', () => {
    const data = parseStoreData(file({
      repos: [repo('r1')],
      worktrees: [{ ...worktree('w1', 'r1', '/repos/r1'), main: true }, { ...worktree('w2', 'r1'), main: 'yes' }]
    }))
    expect(data.worktrees?.[0].main).toBe(true)
    expect(data.worktrees?.[1]).not.toHaveProperty('main')
  })
})
