import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FILE_VIEW_IMAGE_MAX_BYTES, FILE_VIEW_TEXT_MAX_BYTES, type FileView } from '../../shared/types'
import { readFileView, statFileView } from './readFileView'

// A real 1x1 png, small enough to live inline.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sd-fileview-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function viewOf(name: string): Promise<FileView> {
  const result = await readFileView(join(dir, name))
  if (!result.ok) throw new Error(`expected a view for ${name}: ${result.error}`)
  return result.view
}

async function expectRefused(target: string): Promise<void> {
  const result = await readFileView(target)
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('expected the read to be refused')
  expect(result.error.length).toBeGreaterThan(0)
}

describe('readFileView text', () => {
  it('reads markdown and strips a leading BOM', async () => {
    const body = '# Title\n\nBody\n'
    const bom = Buffer.from([0xef, 0xbb, 0xbf])
    await writeFile(join(dir, 'notes.md'), Buffer.concat([bom, Buffer.from(body, 'utf8')]))
    const view = await viewOf('notes.md')
    expect(view.kind).toBe('markdown')
    expect(view.mime).toBe('text/markdown')
    expect(view.content).toBe(body)
    expect(view.content.charCodeAt(0)).not.toBe(0xfeff)
    expect(view.truncated).toBe(false)
  })

  it('reads a plain text file as-is', async () => {
    await writeFile(join(dir, 'log.txt'), 'plain text\n')
    const view = await viewOf('log.txt')
    expect(view.kind).toBe('text')
    expect(view.mime).toBe('text/plain')
    expect(view.content).toBe('plain text\n')
    expect(view.size).toBe(Buffer.byteLength('plain text\n'))
  })

  it('cuts a text file over the cap at a line break and flags it', async () => {
    const line = `${'x'.repeat(63)}\n`
    const full = line.repeat(Math.ceil((FILE_VIEW_TEXT_MAX_BYTES + 4096) / line.length))
    await writeFile(join(dir, 'big.txt'), full)
    const view = await viewOf('big.txt')
    expect(view.size).toBe(Buffer.byteLength(full))
    expect(view.truncated).toBe(true)
    expect(view.content.length).toBeLessThanOrEqual(FILE_VIEW_TEXT_MAX_BYTES)
    expect(view.content.length).toBeGreaterThan(FILE_VIEW_TEXT_MAX_BYTES - 64)
    expect(view.content.endsWith('\n')).toBe(true)
    expect(full.startsWith(view.content)).toBe(true)
  })
})

describe('readFileView images', () => {
  it('returns a png as base64 with its mime type', async () => {
    const png = Buffer.from(TINY_PNG_BASE64, 'base64')
    await writeFile(join(dir, 'dot.png'), png)
    const view = await viewOf('dot.png')
    expect(view.kind).toBe('image')
    expect(view.mime).toBe('image/png')
    expect(view.base64).toBe(png.toString('base64'))
    expect(view.base64.length).toBeGreaterThan(0)
    expect(view.content).toBe('')
  })

  it('refuses an image over the size cap', async () => {
    await writeFile(join(dir, 'big.png'), Buffer.alloc(FILE_VIEW_IMAGE_MAX_BYTES + 1))
    await expectRefused(join(dir, 'big.png'))
  })
})

describe('readFileView refusals', () => {
  it('refuses a relative path', async () => {
    await expectRefused('notes.md')
  })

  it('refuses a directory', async () => {
    await mkdir(join(dir, 'folder.md'))
    await expectRefused(join(dir, 'folder.md'))
  })

  it('refuses a missing file', async () => {
    await expectRefused(join(dir, 'gone.txt'))
  })

  it('refuses unsupported kinds', async () => {
    await writeFile(join(dir, 'app.exe'), 'MZ')
    await writeFile(join(dir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    await writeFile(join(dir, 'manual.pdf'), '%PDF-1.4\n')
    await expectRefused(join(dir, 'app.exe'))
    await expectRefused(join(dir, 'icon.svg'))
    await expectRefused(join(dir, 'manual.pdf'))
  })

  it('refuses a UNC path without touching the disk', async () => {
    await expectRefused('\\\\server\\share\\a.md')
  })
})

describe('readFileView csv', () => {
  it('returns one sheet with the csv rows', async () => {
    await writeFile(join(dir, 'data.csv'), 'name,score\nalpha,1\nbeta,2\n')
    const view = await viewOf('data.csv')
    expect(view.kind).toBe('csv')
    expect(view.mime).toBe('text/csv')
    expect(view.sheets).toHaveLength(1)
    expect(view.sheets[0].name).toBe('data.csv')
    expect(view.sheets[0].rows).toEqual([
      ['name', 'score'],
      ['alpha', '1'],
      ['beta', '2']
    ])
    expect(view.sheets[0].truncated).toBe(false)
    expect(view.truncated).toBe(false)
  })

  it('parses a tsv with tab delimiters', async () => {
    await writeFile(join(dir, 'data.tsv'), 'name\tscore\nalpha\t1\n')
    const view = await viewOf('data.tsv')
    expect(view.kind).toBe('csv')
    expect(view.mime).toBe('text/tab-separated-values')
    expect(view.sheets).toHaveLength(1)
    expect(view.sheets[0].name).toBe('data.tsv')
    expect(view.sheets[0].rows).toEqual([
      ['name', 'score'],
      ['alpha', '1']
    ])
  })
})

describe('readFileView utf-16', () => {
  it('reads a UTF-16 LE text file written by PowerShell as readable text', async () => {
    const body = 'alpha\r\nbeta\r\n'
    const bom = Buffer.from([0xff, 0xfe])
    await writeFile(join(dir, 'ps.txt'), Buffer.concat([bom, Buffer.from(body, 'utf16le')]))
    const view = await viewOf('ps.txt')
    expect(view.kind).toBe('text')
    expect(view.content).toBe(body)
    expect(view.truncated).toBe(false)
    expect(view.content.charCodeAt(0)).not.toBe(0xfeff)
  })

  it('reads a UTF-16 LE csv (without a BOM) as a table', async () => {
    const csv = 'name,score\r\nalpha,1\r\nbeta,2\r\n'
    await writeFile(join(dir, 'u16.csv'), Buffer.from(csv, 'utf16le'))
    const view = await viewOf('u16.csv')
    expect(view.kind).toBe('csv')
    expect(view.sheets).toHaveLength(1)
    expect(view.sheets[0].rows).toEqual([
      ['name', 'score'],
      ['alpha', '1'],
      ['beta', '2']
    ])
    expect(view.truncated).toBe(false)
  })

  it('cuts a truncated UTF-16 file at a line break and flags it', async () => {
    const line = `${'x'.repeat(63)}\r\n`
    const full = line.repeat(Math.ceil((FILE_VIEW_TEXT_MAX_BYTES + 4096) / (line.length * 2)))
    const bytes = Buffer.from(full, 'utf16le')
    expect(bytes.length).toBeGreaterThan(FILE_VIEW_TEXT_MAX_BYTES)
    await writeFile(join(dir, 'big16.txt'), bytes)
    const view = await viewOf('big16.txt')
    expect(view.size).toBe(bytes.length)
    expect(view.truncated).toBe(true)
    expect(view.content.endsWith('\n')).toBe(true)
    expect(Buffer.byteLength(view.content, 'utf16le')).toBeLessThanOrEqual(FILE_VIEW_TEXT_MAX_BYTES)
    expect(full.startsWith(view.content)).toBe(true)
  })
})

describe('readFileView mtime', () => {
  it("carries the file's modified time from the same stat", async () => {
    const target = join(dir, 'stamp.txt')
    await writeFile(target, 'x\n')
    const info = await stat(target)
    const view = await viewOf('stamp.txt')
    expect(view.mtimeMs).toBe(info.mtimeMs)
    expect(view.size).toBe(info.size)
  })
})

describe('statFileView', () => {
  async function expectStatRefused(target: string): Promise<void> {
    const result = await statFileView(target)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected the stat to be refused')
    expect(result.error.length).toBeGreaterThan(0)
  }

  it('returns mtime and size of a regular file the viewer knows', async () => {
    const target = join(dir, 'plain.txt')
    await writeFile(target, 'abc')
    const info = await stat(target)
    const result = await statFileView(target)
    expect(result).toEqual({ ok: true, mtimeMs: info.mtimeMs, size: 3 })
  })

  it('refuses a relative path', async () => {
    await expectStatRefused('plain.txt')
  })

  it('refuses a directory', async () => {
    await mkdir(join(dir, 'folder.txt'))
    await expectStatRefused(join(dir, 'folder.txt'))
  })

  it('refuses a UNC path without touching the disk', async () => {
    await expectStatRefused('\\\\server\\share\\a.txt')
  })

  it('refuses a missing file', async () => {
    await expectStatRefused(join(dir, 'gone.txt'))
  })

  it('refuses a kind the viewer does not know, like readFileView', async () => {
    await writeFile(join(dir, 'app.exe'), 'MZ')
    await writeFile(join(dir, 'icon.svg'), '<svg/>')
    await expectStatRefused(join(dir, 'app.exe'))
    await expectStatRefused(join(dir, 'icon.svg'))
  })
})
