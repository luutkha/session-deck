import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { checkZip, ZIP_MAX_ENTRIES, ZIP_MAX_UNCOMPRESSED_BYTES } from './zipGuard'

async function zipOf(files: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip()
  for (const [name, body] of Object.entries(files)) zip.file(name, body)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

describe('checkZip', () => {
  it('accepts an ordinary small document and reports what it holds', async () => {
    const result = checkZip(await zipOf({ 'a.xml': '<a/>', 'c.xml': '<c>hello</c>' }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.entries).toBe(2)
      expect(result.uncompressedBytes).toBe('<a/>'.length + '<c>hello</c>'.length)
    }
  })

  it('refuses a decompression bomb from its directory alone (tiny zip, huge inflated size)', async () => {
    const bomb = await zipOf({ 'xl/worksheets/sheet1.xml': Buffer.alloc(ZIP_MAX_UNCOMPRESSED_BYTES + 1024 * 1024, 0x41) })
    expect(bomb.length).toBeLessThan(1024 * 1024) // it really is tiny
    const result = checkZip(bomb)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/expands to more than 64 MB/)
  })

  it('adds up several parts: many medium ones can also exceed the limit', async () => {
    const part = Buffer.alloc(20 * 1024 * 1024, 0x42)
    const result = checkZip(await zipOf({ 'one.xml': part, 'two.xml': part, 'three.xml': part, 'four.xml': part }))
    expect(result.ok).toBe(false)
  })

  it('refuses a file with too many parts', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i <= ZIP_MAX_ENTRIES; i += 1) files[`p${String(i)}.xml`] = '<x/>'
    const result = checkZip(await zipOf(files))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/parts/)
  })

  it('says "not a zip" for text, an empty buffer and a cut-off zip', async () => {
    expect(checkZip(Buffer.from('this is not a zip file at all, just text')).ok).toBe(false)
    expect(checkZip(Buffer.alloc(0)).ok).toBe(false)
    const good = await zipOf({ 'a.xml': '<a>some content to make it longer</a>' })
    expect(checkZip(good.subarray(0, good.length - 10)).ok).toBe(false)
  })

  it('finds the directory when the zip ends with a comment', async () => {
    const zip = new JSZip()
    zip.file('a.xml', '<a/>')
    const bytes = await zip.generateAsync({ type: 'nodebuffer', comment: 'a trailing archive comment' })
    expect(checkZip(bytes).ok).toBe(true)
  })

  it('refuses a directory whose offset points outside the file instead of reading past the buffer', async () => {
    const good = Buffer.from(await zipOf({ 'a.xml': '<a/>' }))
    const end = good.length - 22
    good.writeUInt32LE(good.length + 1000, end + 16)
    expect(checkZip(good).ok).toBe(false)
  })

  it('refuses a zip64 marker rather than guessing sizes', async () => {
    const good = Buffer.from(await zipOf({ 'a.xml': '<a/>' }))
    const end = good.length - 22
    good.writeUInt16LE(0xffff, end + 10)
    expect(checkZip(good).ok).toBe(false)
  })
})
