import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreData } from '../../shared/types'
import { emptyStore } from './reducers'
import {
  createDebouncedSaver,
  loadStoreFile,
  parseStoreData,
  saveStoreFile
} from './persistence'

async function tempPath(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  return join(dir, 'store.json')
}

describe('parseStoreData', () => {
  it('parses a valid store', () => {
    const data: StoreData = {
      version: 1,
      sessions: [
        {
          id: 's1',
          name: 'A',
          cwd: '/x',
          groupId: 'g1',
          statusId: 'todo',
          order: 0,
          createdAt: 1,
          claudeArgs: ['--verbose'],
          claudeSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
        }
      ],
      groups: [{ id: 'g1', name: 'G', collapsed: false }],
      statuses: [{ id: 'todo', name: 'Todo', color: '#9e9e9e' }],
      groupOrder: ['g1']
    }
    expect(parseStoreData(data)).toEqual(data)
  })

  it('parses a valid store without claudeSessionId (old format)', () => {
    const data = {
      version: 1,
      sessions: [
        {
          id: 's1',
          name: 'A',
          cwd: '/x',
          groupId: 'g1',
          statusId: 'todo',
          order: 0,
          createdAt: 1,
          claudeArgs: ['--verbose']
        }
      ],
      groups: [{ id: 'g1', name: 'G', collapsed: false }],
      statuses: [{ id: 'todo', name: 'Todo', color: '#9e9e9e' }],
      groupOrder: ['g1']
    }
    const parsed = parseStoreData(data)
    expect(parsed.sessions[0].claudeSessionId).toBeUndefined()
  })

  it('rejects invalid claudeSessionId format', () => {
    const data = {
      version: 1,
      sessions: [
        {
          id: 's1',
          name: 'A',
          cwd: '/x',
          groupId: null,
          statusId: null,
          order: 0,
          createdAt: 1,
          claudeArgs: [],
          claudeSessionId: 'not-a-uuid'
        }
      ],
      groups: [],
      statuses: [],
      groupOrder: []
    }
    expect(() => parseStoreData(data)).toThrow('claudeSessionId is not a valid UUID')
  })

  it('rejects empty claudeSessionId', () => {
    const data = {
      version: 1,
      sessions: [
        {
          id: 's1',
          name: 'A',
          cwd: '/x',
          groupId: null,
          statusId: null,
          order: 0,
          createdAt: 1,
          claudeArgs: [],
          claudeSessionId: ''
        }
      ],
      groups: [],
      statuses: [],
      groupOrder: []
    }
    expect(() => parseStoreData(data)).toThrow('claudeSessionId must not be empty')
  })

  it('rejects non-string claudeSessionId', () => {
    const data = {
      version: 1,
      sessions: [
        {
          id: 's1',
          name: 'A',
          cwd: '/x',
          groupId: null,
          statusId: null,
          order: 0,
          createdAt: 1,
          claudeArgs: [],
          claudeSessionId: 123
        }
      ],
      groups: [],
      statuses: [],
      groupOrder: []
    }
    expect(() => parseStoreData(data)).toThrow('claudeSessionId must be a string')
  })

  it('repairs dangling groupId and statusId references', () => {
    const data = {
      version: 1,
      sessions: [
        {
          id: 's1',
          name: 'A',
          cwd: '/x',
          groupId: 'missing',
          statusId: 'missing',
          order: 0,
          createdAt: 1,
          claudeArgs: []
        }
      ],
      groups: [],
      statuses: [],
      groupOrder: []
    }
    const parsed = parseStoreData(data)
    expect(parsed.sessions[0].groupId).toBeNull()
    expect(parsed.sessions[0].statusId).toBeNull()
  })

  it('throws on wrong version', () => {
    expect(() => parseStoreData({ version: 2 })).toThrow('Invalid store: version 2')
  })

  it('throws when not an object', () => {
    expect(() => parseStoreData('nope')).toThrow('Invalid store: not an object')
  })

  it('throws for missing or wrong-typed fields', () => {
    expect(() => parseStoreData({ version: 1 })).toThrow('Invalid store: sessions is not an array')
    expect(() =>
      parseStoreData({ version: 1, sessions: 'x', groups: [], statuses: [], groupOrder: [] })
    ).toThrow('Invalid store: sessions is not an array')
    expect(() =>
      parseStoreData({ version: 1, sessions: [], groups: [], statuses: [], groupOrder: [1] })
    ).toThrow('Invalid store: groupOrder is not a string array')
  })

  it('throws for duplicate session/group/status ids', () => {
    const base = { version: 1, sessions: [], groups: [], statuses: [], groupOrder: [] }
    expect(() =>
      parseStoreData({
        ...base,
        sessions: [
          { id: 's1', name: 'A', cwd: '/x', groupId: null, statusId: null, order: 0, createdAt: 1, claudeArgs: [] },
          { id: 's1', name: 'B', cwd: '/y', groupId: null, statusId: null, order: 1, createdAt: 2, claudeArgs: [] }
        ]
      })
    ).toThrow('Invalid store: duplicate session id')
    expect(() =>
      parseStoreData({
        ...base,
        groups: [
          { id: 'g1', name: 'A', collapsed: false },
          { id: 'g1', name: 'B', collapsed: false }
        ]
      })
    ).toThrow('Invalid store: duplicate group id')
    expect(() =>
      parseStoreData({
        ...base,
        statuses: [
          { id: 'x', name: 'A', color: '#111111' },
          { id: 'x', name: 'B', color: '#222222' }
        ]
      })
    ).toThrow('Invalid store: duplicate status id')
  })
})

describe('loadStoreFile', () => {
  let path: string

  beforeEach(async () => {
    path = await tempPath('session-deck-load-')
  })

  afterEach(async () => {
    await rm(dirname(path), { recursive: true, force: true })
  })

  it('returns empty store for missing file', async () => {
    const { data, warning } = await loadStoreFile(path)
    expect(data).toEqual(emptyStore())
    expect(warning).toBeUndefined()
  })

  it('loads a valid file', async () => {
    const store = emptyStore()
    await writeFile(path, JSON.stringify(store), 'utf-8')
    const { data, warning } = await loadStoreFile(path)
    expect(data).toEqual(store)
    expect(warning).toBeUndefined()
  })

  it('renames corrupt JSON and returns empty store with warning', async () => {
    await writeFile(path, '{ not json', 'utf-8')
    const { data, warning } = await loadStoreFile(path)
    expect(data).toEqual(emptyStore())
    expect(warning).toContain('corrupt')
    expect(warning).toContain(path)
    const files = await readdir(dirname(path))
    expect(files.some((f) => f.startsWith('store.json.corrupt-'))).toBe(true)
    expect(files).not.toContain('store.json')
  })

  it('renames valid JSON with wrong shape', async () => {
    await writeFile(path, JSON.stringify({ version: 2 }), 'utf-8')
    const { data, warning } = await loadStoreFile(path)
    expect(data).toEqual(emptyStore())
    expect(warning).toContain('version 2')
  })
})

describe('saveStoreFile', () => {
  let path: string

  beforeEach(async () => {
    path = await tempPath('session-deck-save-')
  })

  afterEach(async () => {
    await rm(dirname(path), { recursive: true, force: true })
  })

  it('writes pretty JSON and creates parent dir', async () => {
    const store = emptyStore()
    await saveStoreFile(path, store)
    const text = await readFile(path, 'utf-8')
    expect(text).toContain('  "version": 1')
    expect(JSON.parse(text)).toEqual(store)
  })

  it('leaves no tmp file after atomic save', async () => {
    await saveStoreFile(path, emptyStore())
    const files = await readdir(dirname(path))
    expect(files).toContain('store.json')
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false)
  })
})

describe('createDebouncedSaver', () => {
  it('coalesces writes and flushes pending', async () => {
    const saves: StoreData[] = []
    const save = async (_path: string, data: StoreData): Promise<void> => {
      saves.push(data)
    }

    let timerId = 0
    const timers = new Map<number, () => void>()

    const setTimer = (_callback: () => void, _ms: number) => {
      const id = ++timerId
      timers.set(id, _callback)
      return id as unknown as ReturnType<typeof setTimeout>
    }
    const clearTimer = (id: ReturnType<typeof setTimeout>) => {
      timers.delete(id as unknown as number)
    }
    const fireTimer = () => {
      for (const callback of timers.values()) {
        callback()
      }
      timers.clear()
    }

    const saver = createDebouncedSaver('/x', 100, { save, setTimeout: setTimer, clearTimeout: clearTimer })
    const a = emptyStore()
    const b = { ...a, sessions: [{ id: 's1', name: 'A', cwd: '/x', groupId: null, statusId: null, order: 0, createdAt: 1, claudeArgs: [] }] }
    saver.schedule(a)
    saver.schedule(b)
    expect(saves).toHaveLength(0)
    await saver.flush()
    expect(saves).toHaveLength(1)
    expect(saves[0]).toEqual(b)
    saver.schedule(a)
    fireTimer()
    expect(saves).toHaveLength(2)
  })

  it('flush with nothing pending resolves immediately', async () => {
    const saver = createDebouncedSaver('/x', 100, { save: vi.fn() })
    await expect(saver.flush()).resolves.toBeUndefined()
  })
})

describe('parseStoreData closedAt', () => {
  const baseSession = {
    id: 's1',
    name: 'A',
    cwd: '/x',
    groupId: null,
    statusId: null,
    order: 0,
    createdAt: 1,
    claudeArgs: []
  }

  function storeWith(session: Record<string, unknown>): unknown {
    return { version: 1, sessions: [session], groups: [], statuses: [], groupOrder: [] }
  }

  it('keeps a valid closedAt', () => {
    const parsed = parseStoreData(storeWith({ ...baseSession, closedAt: 1700000000000 }))
    expect(parsed.sessions[0].closedAt).toBe(1700000000000)
  })

  it('accepts closedAt of 0', () => {
    const parsed = parseStoreData(storeWith({ ...baseSession, closedAt: 0 }))
    expect(parsed.sessions[0].closedAt).toBe(0)
  })

  it('loads an old file without closedAt and leaves it undefined', () => {
    const parsed = parseStoreData(storeWith({ ...baseSession }))
    expect(parsed.sessions[0].closedAt).toBeUndefined()
    expect('closedAt' in parsed.sessions[0]).toBe(false)
  })

  it('rejects a negative closedAt', () => {
    expect(() => parseStoreData(storeWith({ ...baseSession, closedAt: -1 }))).toThrow(
      'Invalid store: sessions[0].closedAt must be a non-negative number'
    )
  })

  it('rejects a non-number closedAt', () => {
    expect(() => parseStoreData(storeWith({ ...baseSession, closedAt: '2024-01-01' }))).toThrow(
      'Invalid store: sessions[0].closedAt must be a non-negative number'
    )
  })

  it('rejects null closedAt', () => {
    expect(() => parseStoreData(storeWith({ ...baseSession, closedAt: null }))).toThrow(
      'Invalid store: sessions[0].closedAt must be a non-negative number'
    )
  })

  it('rejects non-finite closedAt', () => {
    expect(() => parseStoreData(storeWith({ ...baseSession, closedAt: Number.NaN }))).toThrow(
      'Invalid store: sessions[0].closedAt must be a non-negative number'
    )
  })
})

async function readdir(dir: string): Promise<string[]> {
  const { readdir: rd } = await import('node:fs/promises')
  return rd(dir)
}
