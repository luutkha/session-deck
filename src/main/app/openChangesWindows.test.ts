import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createOpenWindowsStore,
  MAX_OPEN_CHANGES_WINDOWS,
  openChangesWindowsFilePath,
  parseOpenWindowsFile,
  restorableIds,
  shouldForgetOnClose,
  type OpenWindowsStoreIo
} from './openChangesWindows'

const FILE = openChangesWindowsFilePath('C:/userData')

interface MemoryIo {
  readonly io: OpenWindowsStoreIo
  readonly files: Map<string, string>
  readonly writes: string[]
  readonly renames: Array<{ readonly from: string; readonly to: string }>
  readonly errors: string[]
}

function memoryIo(initialText?: string): MemoryIo {
  const files = new Map<string, string>()
  if (initialText !== undefined) files.set(FILE, initialText)
  const writes: string[] = []
  const renames: Array<{ readonly from: string; readonly to: string }> = []
  const errors: string[] = []
  const io: OpenWindowsStoreIo = {
    readFileSync: (filePath) => {
      const text = files.get(filePath)
      if (text === undefined) {
        const error = new Error('missing') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      }
      return text
    },
    writeFileSync: (filePath, text) => {
      files.set(filePath, text)
      writes.push(filePath)
    },
    mkdirSync: () => undefined,
    renameSync: (from, to) => {
      const text = files.get(from)
      if (text === undefined) throw new Error(`no temp file ${from}`)
      files.delete(from)
      files.set(to, text)
      renames.push({ from, to })
    },
    onError: (where) => errors.push(where)
  }
  return { io, files, writes, renames, errors }
}

describe('openChangesWindowsFilePath', () => {
  it('puts the store inside userData', () => {
    expect(FILE).toBe(join('C:/userData', 'changes-windows-open.json'))
  })
})

describe('shouldForgetOnClose', () => {
  it('forgets a window the user closed while the app stays open', () => {
    expect(shouldForgetOnClose(false)).toBe(true)
  })

  it('keeps a window closed by a normal quit so it can be reopened next time', () => {
    expect(shouldForgetOnClose(true)).toBe(false)
  })
})

describe('parseOpenWindowsFile', () => {
  it('ignores anything that is not an array of ids', () => {
    expect(parseOpenWindowsFile('')).toEqual([])
    expect(parseOpenWindowsFile('{not json')).toEqual([])
    expect(parseOpenWindowsFile('null')).toEqual([])
    expect(parseOpenWindowsFile('{}')).toEqual([])
  })

  it('drops bad entries and keeps the good ones in order', () => {
    expect(parseOpenWindowsFile(JSON.stringify(['wt-a', '', 'wt-b', null, 7, {}, 'wt-c']))).toEqual(['wt-a', 'wt-b', 'wt-c'])
  })

  it('dedupes and caps at the window limit', () => {
    const ids = [...Array.from({ length: MAX_OPEN_CHANGES_WINDOWS + 2 }, (_, index) => `wt-${index}`), 'wt-0']
    expect(parseOpenWindowsFile(JSON.stringify(ids))).toEqual(ids.slice(0, MAX_OPEN_CHANGES_WINDOWS))
  })
})

describe('restorableIds', () => {
  it('keeps only existing worktrees, in saved order', () => {
    const known = new Set(['wt-b', 'wt-a'])
    expect(restorableIds(['wt-c', 'wt-a', 'wt-b'], known)).toEqual(['wt-a', 'wt-b'])
  })

  it('dedupes and caps at the window limit', () => {
    const saved = Array.from({ length: MAX_OPEN_CHANGES_WINDOWS + 2 }, (_, index) => `wt-${index}`)
    const known = new Set(saved)
    expect(restorableIds(saved, known)).toEqual(saved.slice(0, MAX_OPEN_CHANGES_WINDOWS))
  })

  it('returns nothing for an empty set', () => {
    expect(restorableIds(['wt-a'], new Set())).toEqual([])
  })
})

describe('open windows store', () => {
  it('round-trips ids through the file across store instances', () => {
    const memory = memoryIo()
    const first = createOpenWindowsStore(FILE, memory.io)
    first.add('wt-a')
    first.add('wt-b')
    const second = createOpenWindowsStore(FILE, memory.io)
    expect(second.load()).toEqual(['wt-a', 'wt-b'])
  })

  it('loads an empty list when the file is missing, without reporting an error', () => {
    const memory = memoryIo()
    expect(createOpenWindowsStore(FILE, memory.io).load()).toEqual([])
    expect(memory.errors).toEqual([])
  })

  it('ignores a corrupt file and can overwrite it', () => {
    const memory = memoryIo('{not json')
    const store = createOpenWindowsStore(FILE, memory.io)
    expect(store.load()).toEqual([])
    store.add('wt-a')
    expect(createOpenWindowsStore(FILE, memory.io).load()).toEqual(['wt-a'])
  })

  it('reports a real read error but stays empty', () => {
    const memory = memoryIo()
    const io: OpenWindowsStoreIo = {
      ...memory.io,
      readFileSync: () => {
        const error = new Error('denied') as NodeJS.ErrnoException
        error.code = 'EACCES'
        throw error
      }
    }
    expect(createOpenWindowsStore(FILE, io).load()).toEqual([])
    expect(memory.errors).toEqual(['open changes windows: read'])
  })

  it('adds only once and removes only the requested id', () => {
    const memory = memoryIo(JSON.stringify(['wt-a', 'wt-b']))
    const store = createOpenWindowsStore(FILE, memory.io)
    store.add('wt-a')
    expect(store.load()).toEqual(['wt-a', 'wt-b'])
    store.remove('wt-a')
    expect(store.load()).toEqual(['wt-b'])
    store.remove('wt-missing')
    expect(store.load()).toEqual(['wt-b'])
  })

  it('replaces the whole list with valid, deduped, capped ids', () => {
    const memory = memoryIo()
    const store = createOpenWindowsStore(FILE, memory.io)
    const ids = Array.from({ length: MAX_OPEN_CHANGES_WINDOWS + 1 }, (_, index) => `wt-${index}`)
    // The cast is deliberate: an old caller or hand-written data may contain a non-string entry.
    const withJunk = [...ids, '', 'wt-0', 3] as unknown as readonly string[]
    store.replaceAll(withJunk)
    expect(store.load()).toEqual(ids.slice(0, MAX_OPEN_CHANGES_WINDOWS))
  })

  it(`keeps at most ${MAX_OPEN_CHANGES_WINDOWS} ids when adding`, () => {
    const memory = memoryIo()
    const store = createOpenWindowsStore(FILE, memory.io)
    for (let index = 0; index < MAX_OPEN_CHANGES_WINDOWS + 1; index++) store.add(`wt-${index}`)
    expect(store.load()).toHaveLength(MAX_OPEN_CHANGES_WINDOWS)
    expect(store.load()).not.toContain('wt-0')
  })

  it('writes atomically through a temp file and a rename', () => {
    const memory = memoryIo()
    const store = createOpenWindowsStore(FILE, memory.io)
    store.add('wt-a')
    expect(memory.writes).toEqual([`${FILE}.tmp`])
    expect(memory.renames).toEqual([{ from: `${FILE}.tmp`, to: FILE }])
    expect(memory.files.has(`${FILE}.tmp`)).toBe(false)
    expect(JSON.parse(memory.files.get(FILE) ?? '')).toEqual(['wt-a'])
  })

  it('swallows a failed write and reports it', () => {
    const memory = memoryIo()
    const io: OpenWindowsStoreIo = {
      ...memory.io,
      writeFileSync: () => {
        throw new Error('disk full')
      }
    }
    const store = createOpenWindowsStore(FILE, io)
    expect(() => store.add('wt-a')).not.toThrow()
    expect(() => store.remove('wt-a')).not.toThrow()
    expect(() => store.replaceAll(['wt-a'])).not.toThrow()
    expect(memory.errors).toEqual([
      'open changes windows: save',
      'open changes windows: save',
      'open changes windows: save'
    ])
  })
})
