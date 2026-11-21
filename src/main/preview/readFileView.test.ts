import { mkdir, mkdtemp, open, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FILE_VIEW_PDF_MAX_BYTES,
  FILE_VIEW_TEXT_MAX_BYTES,
  type FileView
} from '../../shared/types'
import { tinyPdf } from './fileViewFixtures'
import { readFileView, statFileView } from './readFileView'

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


describe('readFileView pdf', () => {
  it('returns a whole valid pdf as base64 with the pdf mime', async () => {
    const pdf = tinyPdf()
    await writeFile(join(dir, 'manual.pdf'), pdf)
    const view = await viewOf('manual.pdf')
    expect(view.kind).toBe('pdf')
    expect(view.mime).toBe('application/pdf')
    expect(view.content).toBe('')
    expect(view.sheets).toEqual([])
    expect(view.truncated).toBe(false)
    expect(view.size).toBe(pdf.length)
    expect(view.base64.length).toBeGreaterThan(0)
    expect(Buffer.from(view.base64, 'base64').equals(pdf)).toBe(true)
  })

  it('refuses a file named .pdf that has no magic', async () => {
    const target = join(dir, 'renamed.pdf')
    await writeFile(target, 'just some text, not a pdf\n')
    const result = await readFileView(target)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected the read to be refused')
    expect(result.error).toBe('Not a valid PDF file')
  })

  it('accepts a pdf whose magic sits at byte 200 after junk', async () => {
    const pdf = tinyPdf()
    const bytes = Buffer.concat([Buffer.alloc(200, 0x20), pdf])
    await writeFile(join(dir, 'junk.pdf'), bytes)
    const view = await viewOf('junk.pdf')
    expect(view.kind).toBe('pdf')
    expect(view.size).toBe(bytes.length)
    expect(Buffer.from(view.base64, 'base64').equals(bytes)).toBe(true)
  })

  it('streams a pdf over the size cap without sending its bytes', async () => {
    const target = join(dir, 'huge.pdf')
    // A sparse file just over the cap: only its first 1024 bytes are read for the magic check, so this stays fast.
    const handle = await open(target, 'w')
    try {
      await handle.write('%PDF-1.4\n')
      await handle.truncate(FILE_VIEW_PDF_MAX_BYTES + 1)
    } finally {
      await handle.close()
    }
    const result = await readFileView(target)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(`expected a streamed view: ${result.error}`)
    expect(result.view.streamed).toBe(true)
    expect(result.view.base64).toBe('')
    expect(result.view.size).toBe(FILE_VIEW_PDF_MAX_BYTES + 1)
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
    await expectRefused(join(dir, 'app.exe'))
  })

  it('refuses a UNC path without touching the disk', async () => {
    await expectRefused('\\\\server\\share\\a.md')
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

  it('returns mtime and size of a pdf (kind pdf)', async () => {
    const target = join(dir, 'watched.pdf')
    const pdf = tinyPdf()
    await writeFile(target, pdf)
    const info = await stat(target)
    const result = await statFileView(target)
    expect(result).toEqual({ ok: true, mtimeMs: info.mtimeMs, size: pdf.length })
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
    await expectStatRefused(join(dir, 'app.exe'))
  })
})
