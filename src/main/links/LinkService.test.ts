import { describe, expect, it } from 'vitest'
import { createLinkService, MAX_LINK_TEXTS, type LinkServiceDeps, type LinkStat } from './LinkService'

interface Harness {
  readonly deps: LinkServiceDeps
  readonly opened: string[]
  readonly external: string[]
  readonly revealed: string[]
  readonly statCalls: string[]
  readonly setOpenError: (path: string, message: string) => void
}

const CWD = 'C:\\proj'

function file(): LinkStat {
  return { isFile: true, isDirectory: false }
}

function folder(): LinkStat {
  return { isFile: false, isDirectory: true }
}

function harness(files: ReadonlyMap<string, LinkStat>): Harness {
  const opened: string[] = []
  const external: string[] = []
  const revealed: string[] = []
  const statCalls: string[] = []
  const openErrors = new Map<string, string>()
  const deps: LinkServiceDeps = {
    getSessionCwd: (id) => (id === 's1' ? CWD : null),
    stat: async (path) => {
      statCalls.push(path)
      return files.get(path) ?? null
    },
    openPath: async (path) => {
      opened.push(path)
      return openErrors.get(path) ?? ''
    },
    openExternal: async (url) => {
      external.push(url)
    },
    showItemInFolder: (path) => {
      revealed.push(path)
    },
    homedir: () => 'C:\\Users\\me'
  }
  return {
    deps,
    opened,
    external,
    revealed,
    statCalls,
    setOpenError: (path, message) => openErrors.set(path, message)
  }
}

describe('LinkService.resolve', () => {
  it('resolves URLs without touching the filesystem', async () => {
    const h = harness(new Map())
    const service = createLinkService(h.deps)
    expect(await service.resolve('s1', 'https://example.com')).toEqual({ kind: 'url', target: 'https://example.com/' })
    expect(h.statCalls).toEqual([])
  })

  it('resolves a relative file against the session cwd', async () => {
    const h = harness(new Map([['C:\\proj\\src\\a.ts', file()]]))
    const service = createLinkService(h.deps)
    expect(await service.resolve('s1', 'src/a.ts')).toEqual({ kind: 'file', target: 'C:\\proj\\src\\a.ts' })
  })

  it('resolves a folder', async () => {
    const h = harness(new Map([['C:\\proj\\src\\main', folder()]]))
    const service = createLinkService(h.deps)
    expect(await service.resolve('s1', 'src')).toBeNull()
    expect(await service.resolve('s1', 'src/main')).toEqual({ kind: 'folder', target: 'C:\\proj\\src\\main' })
  })

  it('returns null for a missing path', async () => {
    const h = harness(new Map())
    const service = createLinkService(h.deps)
    expect(await service.resolve('s1', 'missing.txt')).toBeNull()
  })

  it('resolves absolute paths even when the session is unknown', async () => {
    const h = harness(new Map([['C:\\x\\y', file()]]))
    const service = createLinkService(h.deps)
    expect(await service.resolve('nope', 'C:/x/y')).toEqual({ kind: 'file', target: 'C:\\x\\y' })
  })

  it('returns null for a relative path when the session is unknown', async () => {
    const h = harness(new Map([['C:\\proj\\src\\a.ts', file()]]))
    const service = createLinkService(h.deps)
    expect(await service.resolve('nope', 'src/a.ts')).toBeNull()
  })

  it('expands home paths against homedir', async () => {
    const h = harness(new Map([['C:\\Users\\me\\notes.md', file()]]))
    const service = createLinkService(h.deps)
    expect(await service.resolve('s1', '~/notes.md')).toEqual({
      kind: 'file',
      target: 'C:\\Users\\me\\notes.md'
    })
  })

  it('keeps line and column from a position suffix', async () => {
    const h = harness(new Map([['C:\\proj\\src\\a.ts', file()]]))
    const service = createLinkService(h.deps)
    expect(await service.resolve('s1', 'src/a.ts:12:5')).toEqual({
      kind: 'file',
      target: 'C:\\proj\\src\\a.ts',
      line: 12,
      column: 5
    })
  })

  it('never resolves UNC paths (stat would contact the remote host)', async () => {
    const share = '\\\\server\\share\\file.txt'
    const h = harness(new Map([[share, file()]]))
    const service = createLinkService(h.deps)
    expect(await service.resolve('s1', share)).toBeNull()
    expect(h.statCalls).toEqual([])
  })
})

describe('LinkService.resolveMany', () => {
  it('returns one result per input and dedupes stat calls', async () => {
    const h = harness(
      new Map([
        ['C:\\proj\\package.json', file()],
        ['C:\\proj\\src\\a.ts', file()]
      ])
    )
    const service = createLinkService(h.deps)
    const results = await service.resolveMany('s1', ['package.json', 'package.json', 'src/a.ts'])
    expect(results).toEqual([
      { kind: 'file', target: 'C:\\proj\\package.json' },
      { kind: 'file', target: 'C:\\proj\\package.json' },
      { kind: 'file', target: 'C:\\proj\\src\\a.ts' }
    ])
    expect(h.statCalls).toHaveLength(2)
  })

  it('nulls out entries past the limit but keeps the array length', async () => {
    const h = harness(new Map([['C:\\proj\\package.json', file()]]))
    const service = createLinkService(h.deps)
    const texts = new Array<string>(MAX_LINK_TEXTS + 1).fill('package.json')
    const results = await service.resolveMany('s1', texts)
    expect(results).toHaveLength(MAX_LINK_TEXTS + 1)
    expect(results[0]).toEqual({ kind: 'file', target: 'C:\\proj\\package.json' })
    expect(results[MAX_LINK_TEXTS]).toBeNull()
  })

  it('handles an empty list', async () => {
    const h = harness(new Map())
    const service = createLinkService(h.deps)
    expect(await service.resolveMany('s1', [])).toEqual([])
  })
})

describe('LinkService.open', () => {
  it('opens a URL externally', async () => {
    const h = harness(new Map())
    const service = createLinkService(h.deps)
    expect(await service.open('s1', 'https://example.com', false)).toEqual({ ok: true, kind: 'url' })
    expect(h.external).toEqual(['https://example.com/'])
  })

  it('never opens a non-http(s)/mailto scheme externally', async () => {
    const h = harness(new Map())
    const service = createLinkService(h.deps)
    expect(await service.open('s1', 'javascript:alert(1)', false)).toEqual({ ok: false, error: 'File not found' })
    expect(h.external).toEqual([])
  })

  it('opens a folder with openPath', async () => {
    const h = harness(new Map([['C:\\proj\\src\\main', folder()]]))
    const service = createLinkService(h.deps)
    expect(await service.open('s1', 'src/main', false)).toEqual({ ok: true, kind: 'folder' })
    expect(h.opened).toEqual(['C:\\proj\\src\\main'])
  })

  it('opens a file with openPath by default', async () => {
    const h = harness(new Map([['C:\\proj\\src\\a.ts', file()]]))
    const service = createLinkService(h.deps)
    expect(await service.open('s1', 'src/a.ts', false)).toEqual({ ok: true, kind: 'file' })
    expect(h.opened).toEqual(['C:\\proj\\src\\a.ts'])
    expect(h.revealed).toEqual([])
  })

  it('reveals a file when reveal is true', async () => {
    const h = harness(new Map([['C:\\proj\\src\\a.ts', file()]]))
    const service = createLinkService(h.deps)
    expect(await service.open('s1', 'src/a.ts', true)).toEqual({ ok: true, kind: 'file', revealed: true })
    expect(h.revealed).toEqual(['C:\\proj\\src\\a.ts'])
    expect(h.opened).toEqual([])
  })

  it('reveals a dangerous extension instead of launching it', async () => {
    const h = harness(new Map([['C:\\proj\\setup.exe', file()]]))
    const service = createLinkService(h.deps)
    expect(await service.open('s1', 'setup.exe', false)).toEqual({ ok: true, kind: 'file', revealed: true })
    expect(h.revealed).toEqual(['C:\\proj\\setup.exe'])
    expect(h.opened).toEqual([])
  })

  it('reports a missing target as File not found', async () => {
    const h = harness(new Map())
    const service = createLinkService(h.deps)
    expect(await service.open('s1', 'missing.txt', false)).toEqual({ ok: false, error: 'File not found' })
  })

  it('surfaces an OS error from openPath', async () => {
    const target = 'C:\\proj\\src\\a.ts'
    const h = harness(new Map([[target, file()]]))
    h.setOpenError(target, 'Access is denied')
    const service = createLinkService(h.deps)
    expect(await service.open('s1', 'src/a.ts', false)).toEqual({ ok: false, error: 'Could not open: Access is denied' })
  })

  it('re-resolves the text instead of trusting the caller', async () => {
    const h = harness(new Map([['C:\\proj\\src\\a.ts', file()]]))
    const service = createLinkService(h.deps)
    // A path that is not a link and a stale absolute path both fail on re-resolve.
    expect(await service.open('s1', 'hello world', false)).toEqual({ ok: false, error: 'File not found' })
    expect(await service.open('nope', 'src/a.ts', false)).toEqual({ ok: false, error: 'File not found' })
  })
})
