import { describe, expect, it } from 'vitest'
import { isPreviewable, previewKindFor } from './preview'

describe('previewKindFor', () => {
  it('markdown and raster images', () => {
    expect(previewKindFor('README.md')).toBe('markdown')
    expect(previewKindFor('a/notes.markdown')).toBe('markdown')
    expect(previewKindFor('shot.PNG')).toBe('image')
    expect(previewKindFor('pic.jpg')).toBe('image')
    expect(previewKindFor('pic.jpeg')).toBe('image')
    expect(previewKindFor('pic.gif')).toBe('image')
    expect(previewKindFor('pic.webp')).toBe('image')
    expect(previewKindFor('pic.bmp')).toBe('image')
  })
  it('svg, pdf and code files are not previewable (v1 scope)', () => {
    expect(previewKindFor('vector.svg')).toBeNull()
    expect(previewKindFor('doc.pdf')).toBeNull()
    expect(previewKindFor('app.ts')).toBeNull()
    expect(previewKindFor('archive.tar.gz')).toBeNull()
  })
  it('no extension or a trailing dot is nothing', () => {
    expect(previewKindFor('README')).toBeNull()
    expect(previewKindFor('trailing.')).toBeNull()
  })
})

describe('isPreviewable', () => {
  it('mirrors previewKindFor', () => {
    expect(isPreviewable('doc.md')).toBe(true)
    expect(isPreviewable('a.png')).toBe(true)
    expect(isPreviewable('a.svg')).toBe(false)
    expect(isPreviewable('a.ts')).toBe(false)
  })
})
