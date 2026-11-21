import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FILE_VIEW_PDF_MAX_BYTES,
  FILE_VIEW_PDF_RANGE_MAX_BYTES,
  FILE_VIEW_PDF_STREAM_MAX_BYTES,
  type FileViewRangeResult
} from '../../shared/types'
import { pdfDeliveryFor, readFileView, readPdfRange } from './index'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sd-pdf-range-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** D75 test bytes: a real header, then a byte at offset i that is i % 251, so every range is recognisable. */
function patternPdf(size: number): Buffer {
  const bytes = Buffer.alloc(size)
  for (let index = 0; index < size; index += 1) bytes[index] = index % 251
  bytes.write('%PDF-1.4\n', 0, 'latin1')
  return bytes
}

function rangeBytes(result: FileViewRangeResult, start: number): Buffer {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(`expected a range: ${result.error}`)
  expect(result.start).toBe(start)
  return Buffer.from(result.base64, 'base64')
}

describe('pdfDeliveryFor', () => {
  it('sends a pdf up to the whole-file cap whole', () => {
    expect(pdfDeliveryFor(0)).toBe('whole')
    expect(pdfDeliveryFor(FILE_VIEW_PDF_MAX_BYTES)).toBe('whole')
  })

  it('streams one byte over the whole-file cap, up to the stream cap', () => {
    expect(pdfDeliveryFor(FILE_VIEW_PDF_MAX_BYTES + 1)).toBe('streamed')
    expect(pdfDeliveryFor(FILE_VIEW_PDF_STREAM_MAX_BYTES)).toBe('streamed')
  })

  it('refuses one byte over the stream cap', () => {
    expect(pdfDeliveryFor(FILE_VIEW_PDF_STREAM_MAX_BYTES + 1)).toBe('refused')
  })
})

describe('readFileView big pdf', () => {
  it('streams a real pdf just over 30 MB without sending its bytes', async () => {
    const size = FILE_VIEW_PDF_MAX_BYTES + 1
    const bytes = patternPdf(size)
    const target = join(dir, 'scanned-book.pdf')
    await writeFile(target, bytes)
    const result = await readFileView(target)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(`expected a streamed view: ${result.error}`)
    expect(result.view.kind).toBe('pdf')
    expect(result.view.streamed).toBe(true)
    expect(result.view.base64).toBe('')
    expect(result.view.size).toBe(size)
    expect(result.view.mime).toBe('application/pdf')
    expect(result.view.content).toBe('')
    expect(result.view.sheets).toEqual([])
    expect(result.view.truncated).toBe(false)
    expect(result.view.name).toBe('scanned-book.pdf')
    expect(result.view.path).toBe(target)
  }, 20000)

  it('refuses a file renamed to .pdf over the limit without the magic', async () => {
    const target = join(dir, 'fake-big.pdf')
    const handle = await open(target, 'w')
    try {
      await handle.write('not a pdf\n')
      await handle.truncate(FILE_VIEW_PDF_MAX_BYTES + 1)
    } finally {
      await handle.close()
    }
    const result = await readFileView(target)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected the read to be refused')
    expect(result.error).toBe('Not a valid PDF file')
  })
})

describe('readPdfRange bytes', () => {
  it('returns exactly the bytes at the start, middle, last bytes and clamps a range crossing the end', async () => {
    const bytes = patternPdf(4096)
    const target = join(dir, 'small.pdf')
    await writeFile(target, bytes)

    expect(rangeBytes(await readPdfRange(target, 0, 16), 0).equals(bytes.subarray(0, 16))).toBe(true)
    expect(rangeBytes(await readPdfRange(target, 2000, 2100), 2000).equals(bytes.subarray(2000, 2100))).toBe(true)
    expect(
      rangeBytes(await readPdfRange(target, bytes.length - 64, bytes.length), bytes.length - 64).equals(
        bytes.subarray(bytes.length - 64)
      )
    ).toBe(true)
    expect(
      rangeBytes(await readPdfRange(target, bytes.length - 10, bytes.length + 5000), bytes.length - 10).equals(
        bytes.subarray(bytes.length - 10)
      )
    ).toBe(true)
  })

  it('refuses a start at or past the end of the file', async () => {
    const bytes = patternPdf(1024)
    const target = join(dir, 'short.pdf')
    await writeFile(target, bytes)
    const result = await readPdfRange(target, bytes.length, bytes.length + 10)
    expect(result).toEqual({ ok: false, error: 'Range outside the file' })
  })

  it('refuses a range larger than the per-request cap', async () => {
    const target = join(dir, 'eight-mb.pdf')
    await writeFile(target, patternPdf(FILE_VIEW_PDF_RANGE_MAX_BYTES + 1024))
    const result = await readPdfRange(target, 0, FILE_VIEW_PDF_RANGE_MAX_BYTES + 1)
    expect(result).toEqual({ ok: false, error: 'Range too large' })
  }, 20000)
})

describe('readPdfRange refusals', () => {
  it('refuses a relative path', async () => {
    const result = await readPdfRange('small.pdf', 0, 10)
    expect(result).toEqual({ ok: false, error: 'Not an absolute path' })
  })

  it('refuses a UNC path without touching the disk', async () => {
    const result = await readPdfRange('\\\\server\\share\\a.pdf', 0, 10)
    expect(result).toEqual({ ok: false, error: 'Network paths are not supported' })
  })

  it('refuses a missing file', async () => {
    const result = await readPdfRange(join(dir, 'gone.pdf'), 0, 10)
    expect(result).toEqual({ ok: false, error: 'File not found or not readable' })
  })

  it('refuses a non-pdf extension', async () => {
    const target = join(dir, 'notes.txt')
    await writeFile(target, 'text')
    const result = await readPdfRange(target, 0, 2)
    expect(result).toEqual({ ok: false, error: 'Not a PDF file' })
  })
})
