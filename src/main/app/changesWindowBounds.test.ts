import { describe, expect, it } from 'vitest'
import {
  changesBoundsFilePath,
  createBoundsStore,
  fitBounds,
  MAX_SAVED_BOUNDS,
  parseBoundsFile,
  type BoundsStoreIo,
  type Rect,
  type SavedBounds
} from './changesWindowBounds'

const AREA: Rect = { x: 0, y: 0, width: 1920, height: 1080 }
const SECOND_AREA: Rect = { x: 1920, y: 0, width: 1280, height: 720 }

function saved(partial: Partial<SavedBounds> = {}): SavedBounds {
  return { x: 100, y: 80, width: 1100, height: 760, ...partial }
}

describe('fitBounds', () => {
  it('uses only the fallback size when nothing was saved (Electron centers it)', () => {
    expect(fitBounds(undefined, [AREA], { width: 1100, height: 760 })).toEqual({ width: 1100, height: 760 })
  })

  it('keeps a window that is on screen exactly where it was', () => {
    const bounds = saved({ x: 150, y: 90 })
    expect(fitBounds(bounds, [AREA, SECOND_AREA], { width: 1100, height: 760 })).toEqual(bounds)
  })

  it('keeps a partially visible window', () => {
    const bounds = saved({ x: -500, y: -300 })
    expect(fitBounds(bounds, [AREA], { width: 1100, height: 760 })).toEqual(bounds)
  })

  it('drops x/y and keeps the size when the monitor is gone', () => {
    expect(fitBounds(saved({ x: 4000, y: 2000 }), [AREA], { width: 1100, height: 760 })).toEqual({ width: 1100, height: 760 })
  })

  it('clamps a too-small saved size to the window minimum', () => {
    expect(fitBounds(saved({ x: 4000, y: 2000, width: 300, height: 200 }), [AREA], { width: 1100, height: 760 })).toEqual({ width: 640, height: 420 })
  })

  it('clamps a saved size to the biggest work area', () => {
    expect(fitBounds(saved({ x: 9000, y: 9000, width: 9000, height: 5000 }), [AREA, SECOND_AREA], { width: 1100, height: 760 })).toEqual({ width: 1920, height: 1080 })
  })

  it('treats a tiny overlap as off screen', () => {
    const bounds = saved({ x: -1050, y: 0 })
    expect(fitBounds(bounds, [AREA], { width: 1100, height: 760 })).toEqual({ width: 1100, height: 760 })
  })
})

interface MemoryIo {
  readonly io: BoundsStoreIo
  readonly files: Map<string, string>
  readonly writes: string[]
  readonly renames: Array<{ readonly from: string; readonly to: string }>
  readonly errors: string[]
}

function memoryIo(initialText?: string): MemoryIo {
  const FILE = changesBoundsFilePath('C:/userData')
  const files = new Map<string, string>()
  if (initialText !== undefined) files.set(FILE, initialText)
  const writes: string[] = []
  const renames: Array<{ readonly from: string; readonly to: string }> = []
  const errors: string[] = []
  const io: BoundsStoreIo = {
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

describe('bounds store', () => {
  it('round-trips bounds through the file', () => {
    const memory = memoryIo()
    const first = createBoundsStore(changesBoundsFilePath('C:/userData'), memory.io)
    first.set('wt-a', saved({ x: 10, y: 20 }))
    const second = createBoundsStore(changesBoundsFilePath('C:/userData'), memory.io)
    expect(second.get('wt-a')).toEqual(saved({ x: 10, y: 20 }))
    expect(second.get('wt-b')).toBeUndefined()
  })

  it('ignores a corrupt file', () => {
    const memory = memoryIo('{not json')
    const store = createBoundsStore(changesBoundsFilePath('C:/userData'), memory.io)
    expect(store.get('wt-a')).toBeUndefined()
    store.set('wt-a', saved())
    expect(store.get('wt-a')).toEqual(saved())
  })

  it('drops bad entries but keeps good ones', () => {
    const file = JSON.stringify({
      good: saved(),
      tiny: saved({ width: 100 }),
      huge: saved({ height: 10001 }),
      fractional: saved({ x: 1.5 }),
      text: 'nope',
      missing: { x: 1, y: 2, width: 800 }
    })
    const parsed = parseBoundsFile(file)
    expect(Object.keys(parsed)).toEqual(['good'])
    expect(parsed.good).toEqual(saved())
  })

  it('never throws on junk', () => {
    expect(parseBoundsFile('')).toEqual({})
    expect(parseBoundsFile('null')).toEqual({})
    expect(parseBoundsFile('[]')).toEqual({})
  })

  it(`keeps at most ${MAX_SAVED_BOUNDS} entries, dropping the oldest`, () => {
    const memory = memoryIo()
    const store = createBoundsStore(changesBoundsFilePath('C:/userData'), memory.io)
    for (let index = 0; index < MAX_SAVED_BOUNDS + 1; index++) store.set(`wt-${index}`, saved())
    const text = memory.files.get(changesBoundsFilePath('C:/userData')) ?? ''
    const parsed = parseBoundsFile(text)
    expect(Object.keys(parsed)).toHaveLength(MAX_SAVED_BOUNDS)
    expect(parsed['wt-0']).toBeUndefined()
    expect(parsed[`wt-${MAX_SAVED_BOUNDS}`]).toEqual(saved())
  })

  it('writes atomically through a temp file and a rename', () => {
    const memory = memoryIo()
    const store = createBoundsStore(changesBoundsFilePath('C:/userData'), memory.io)
    store.set('wt-a', saved())
    const target = changesBoundsFilePath('C:/userData')
    expect(memory.writes).toEqual([`${target}.tmp`])
    expect(memory.renames).toEqual([{ from: `${target}.tmp`, to: target }])
    expect(memory.files.has(`${target}.tmp`)).toBe(false)
    expect(JSON.parse(memory.files.get(target) ?? '')).toEqual({ 'wt-a': saved() })
  })

  it('reports a real read error but stays empty', () => {
    const memory = memoryIo()
    const io: BoundsStoreIo = {
      ...memory.io,
      readFileSync: () => {
        const error = new Error('denied') as NodeJS.ErrnoException
        error.code = 'EACCES'
        throw error
      }
    }
    const store = createBoundsStore(changesBoundsFilePath('C:/userData'), io)
    expect(store.get('wt-a')).toBeUndefined()
    expect(memory.errors).toEqual(['changes window bounds: read'])
  })

  it('does not report a missing file', () => {
    const memory = memoryIo()
    const store = createBoundsStore(changesBoundsFilePath('C:/userData'), memory.io)
    expect(store.get('wt-a')).toBeUndefined()
    expect(memory.errors).toEqual([])
  })
})
