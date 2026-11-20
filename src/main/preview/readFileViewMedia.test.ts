import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FILE_VIEW_IMAGE_MAX_BYTES, type FileView } from '../../shared/types'
import { TINY_PNG_BASE64 } from './fileViewFixtures'
import { readFileView } from './readFileView'

// D75: images and CSV files, the two kinds where "it opens" is not enough — the mime and the delimiter decide
// whether the bytes reach the renderer in a usable shape.
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sd-fileview-media-'))
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

  // D75: the renderer shows every image through `<img src="data:<mime>;base64,...">`, so these formats only need
  // the right mime; SVG is inert in an image context.
  it('returns an svg as image/svg+xml', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>'
    await writeFile(join(dir, 'icon.svg'), svg)
    const view = await viewOf('icon.svg')
    expect(view.kind).toBe('image')
    expect(view.mime).toBe('image/svg+xml')
    expect(view.base64).toBe(Buffer.from(svg, 'utf8').toString('base64'))
  })

  it('accepts an svg behind a BOM, leading whitespace and an xml prolog', async () => {
    const svg = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>'
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`\r\n  ${svg}`, 'utf8')])
    await writeFile(join(dir, 'prolog.svg'), bytes)
    const view = await viewOf('prolog.svg')
    expect(view.mime).toBe('image/svg+xml')
    expect(Buffer.from(view.base64, 'base64').equals(bytes)).toBe(true)
  })

  it('refuses a file named .svg that has no svg root or xml prolog', async () => {
    await writeFile(join(dir, 'fake.svg'), 'just some text, not a drawing\n')
    const result = await readFileView(join(dir, 'fake.svg'))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected the read to be refused')
    expect(result.error).toBe('Not a valid SVG file')
  })

  it('refuses an svg whose root sits past the 2 KB sniff window', async () => {
    await writeFile(join(dir, 'late.svg'), `${' '.repeat(3000)}<svg xmlns="http://www.w3.org/2000/svg"/>`)
    await expectRefused(join(dir, 'late.svg'))
  })

  it('returns an ico and an avif with their mime types', async () => {
    // Only the mime is the viewer's job here; the bytes stay exactly as on disk.
    const ico = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00])
    await writeFile(join(dir, 'favicon.ico'), ico)
    const icoView = await viewOf('favicon.ico')
    expect(icoView.kind).toBe('image')
    expect(icoView.mime).toBe('image/x-icon')
    expect(icoView.base64).toBe(ico.toString('base64'))

    const avif = Buffer.from('0000001c667479706176696600000000617669666d696631', 'hex')
    await writeFile(join(dir, 'photo.avif'), avif)
    const avifView = await viewOf('photo.avif')
    expect(avifView.kind).toBe('image')
    expect(avifView.mime).toBe('image/avif')
    expect(avifView.base64).toBe(avif.toString('base64'))
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

  // D75: Excel exports a .csv with the locale's list separator, so the separator is detected, not assumed.
  it('parses a semicolon csv without splitting decimal commas', async () => {
    await writeFile(join(dir, 'euro.csv'), 'name;price;note\nalpha;1,5;ok\nbeta;2,5;ok\n')
    const view = await viewOf('euro.csv')
    expect(view.mime).toBe('text/csv')
    expect(view.sheets[0].rows).toEqual([
      ['name', 'price', 'note'],
      ['alpha', '1,5', 'ok'],
      ['beta', '2,5', 'ok']
    ])
  })

  it('parses a pipe-separated csv', async () => {
    await writeFile(join(dir, 'pipes.csv'), 'name|score\nalpha|1\nbeta|2\n')
    const view = await viewOf('pipes.csv')
    expect(view.sheets[0].rows).toEqual([
      ['name', 'score'],
      ['alpha', '1'],
      ['beta', '2']
    ])
  })

  it('keeps a tsv on tabs even when the cells hold commas and semicolons', async () => {
    await writeFile(join(dir, 'mixed.tsv'), 'note\tvalue\n"a,b;c"\t1\n')
    const view = await viewOf('mixed.tsv')
    expect(view.sheets[0].rows).toEqual([
      ['note', 'value'],
      ['a,b;c', '1']
    ])
  })
})
