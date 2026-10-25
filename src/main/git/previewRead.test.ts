import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PREVIEW_IMAGE_MAX_BYTES, PREVIEW_TEXT_MAX_BYTES } from '../../shared/types'
import { addWorktree, cleanupTempDirs, makeRepo, makeTempDir } from './testRepo'
import { previewKindFor, readWorktreePreview } from './previewRead'
import type { WorktreeRef } from './worktreeChanges'

let repo = ''
let outsideRoot = ''
let counter = 0

function newWorktree(label: string): WorktreeRef {
  counter++
  const { dir, baseCommit } = addWorktree(repo, `${label}-${counter}`, 'main')
  return { id: `wt-${String(counter)}`, path: dir, baseBranch: 'main', baseCommit }
}

beforeAll(() => {
  repo = makeRepo('preview').repo
  outsideRoot = makeTempDir('preview-outside')
})

afterAll(() => {
  cleanupTempDirs()
})

describe('previewKindFor', () => {
  it('markdown extensions', () => {
    expect(previewKindFor('README.md')).toBe('markdown')
    expect(previewKindFor('notes.markdown')).toBe('markdown')
    expect(previewKindFor('Guide.MD')).toBe('markdown')
  })
  it('raster image extensions (svg deliberately out of v1)', () => {
    expect(previewKindFor('a.png')).toBe('image')
    expect(previewKindFor('b.JPG')).toBe('image')
    expect(previewKindFor('c.jpeg')).toBe('image')
    expect(previewKindFor('d.gif')).toBe('image')
    expect(previewKindFor('e.webp')).toBe('image')
    expect(previewKindFor('f.bmp')).toBe('image')
    expect(previewKindFor('g.svg')).toBeNull()
    expect(previewKindFor('h.pdf')).toBeNull()
  })
  it('no preview for code and extension-less names', () => {
    expect(previewKindFor('src/app.ts')).toBeNull()
    expect(previewKindFor('README')).toBeNull()
    expect(previewKindFor('weird.')).toBeNull()
  })
})

describe('readWorktreePreview', () => {
  it('reads markdown as text', async () => {
    const wt = newWorktree('md')
    writeFileSync(path.join(wt.path, 'README.md'), '# Heading\n\nbody text\n')
    const preview = await readWorktreePreview(wt, 'README.md')
    expect(preview.kind).toBe('markdown')
    expect(preview.content).toBe('# Heading\n\nbody text\n')
    expect(preview.truncated).toBe(false)
    expect(preview.base64).toBe('')
  })

  it('reads an image as base64 with its mime', async () => {
    const wt = newWorktree('img')
    const bytes = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000' + '01f15c4890000000a49444154789c6300010000050001' + '0d0a2db4', 'hex')
    writeFileSync(path.join(wt.path, 'dot.png'), bytes)
    const preview = await readWorktreePreview(wt, 'dot.png')
    expect(preview.kind).toBe('image')
    expect(preview.mime).toBe('image/png')
    expect(Buffer.from(preview.base64, 'base64').equals(bytes)).toBe(true)
    expect(preview.content).toBe('')
    expect(preview.truncated).toBe(false)
  })

  it('refuses paths outside the worktree: traversal, absolute, missing', async () => {
    const wt = newWorktree('traversal')
    writeFileSync(path.join(outsideRoot, 'secret.txt'), 'x')
    writeFileSync(path.join(wt.path, 'README.md'), 'ok\n')
    await expect(readWorktreePreview(wt, '../secret.md')).rejects.toThrow('outside the worktree')
    await expect(readWorktreePreview(wt, path.join(outsideRoot, 'secret.md'))).rejects.toThrow('outside the worktree')
    await expect(readWorktreePreview(wt, 'a/../../secret.md')).rejects.toThrow('outside the worktree')
    await expect(readWorktreePreview(wt, 'missing.md')).rejects.toThrow('File not found')
    await expect(readWorktreePreview(wt, 'README.md')).resolves.toBeTruthy()
  })

  it('refuses a symlink/junction that escapes the worktree', async () => {
    const wt = newWorktree('junction')
    // A junction to a directory outside the worktree works on Windows without admin rights.
    const escapeDir = path.join(outsideRoot, `escape-${String(counter)}`)
    mkdirSync(path.join(escapeDir), { recursive: true })
    writeFileSync(path.join(escapeDir, 'secret.md'), '# secret\n')
    symlinkSync(escapeDir, path.join(wt.path, 'link'), 'junction')
    await expect(readWorktreePreview(wt, 'link/secret.md')).rejects.toThrow('outside the worktree')
  })

  it('cuts oversized markdown at a line break and flags it', async () => {
    const wt = newWorktree('big-md')
    const line = `line ${'x'.repeat(40)}\n`
    const count = Math.ceil((PREVIEW_TEXT_MAX_BYTES + 200) / Buffer.byteLength(line, 'utf8'))
    const lines: string[] = []
    for (let index = 0; index < count; index++) {
      lines.push(`line ${String(index)} ${'x'.repeat(40)}`)
    }
    writeFileSync(path.join(wt.path, 'big.md'), lines.join('\n') + '\n')
    const preview = await readWorktreePreview(wt, 'big.md')
    expect(preview.truncated).toBe(true)
    expect(Buffer.from(preview.content, 'utf8').length).toBeLessThanOrEqual(PREVIEW_TEXT_MAX_BYTES)
    expect(preview.content.endsWith('\n')).toBe(true)
    expect(preview.content).toContain('line 0 ')
  })

  it('refuses an oversized image instead of cutting it', async () => {
    const wt = newWorktree('big-img')
    writeFileSync(path.join(wt.path, 'big.png'), Buffer.alloc(PREVIEW_IMAGE_MAX_BYTES + 1, 7))
    await expect(readWorktreePreview(wt, 'big.png')).rejects.toThrow('too large to preview')
  })

  it('refuses file types with no preview', async () => {
    const wt = newWorktree('no-kind')
    writeFileSync(path.join(wt.path, 'app.ts'), 'export {}')
    await expect(readWorktreePreview(wt, 'app.ts')).rejects.toThrow('no preview')
  })
})
