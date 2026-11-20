import { describe, expect, it } from 'vitest'
import { VIEWER_FALLBACK_TITLE, viewerTitle } from './viewerTitle'

describe('viewerTitle', () => {
  it('shows the base name of a Windows path', () => {
    expect(viewerTitle('C:\\work\\docs\\notes.md')).toBe('notes.md')
  })

  it('shows the base name of a forward-slash path', () => {
    expect(viewerTitle('C:/work/docs/report.docx')).toBe('report.docx')
  })

  it('drops a trailing line and column suffix', () => {
    expect(viewerTitle('C:\\work\\src\\main.ts:12')).toBe('main.ts')
    expect(viewerTitle('C:\\work\\src\\main.ts:12:5')).toBe('main.ts')
  })

  it('keeps a bare file name untouched', () => {
    expect(viewerTitle('plan.md')).toBe('plan.md')
  })

  it('keeps spaces in the name', () => {
    expect(viewerTitle('C:\\Users\\John Smith\\My Notes.md')).toBe('My Notes.md')
  })

  it('falls back when there is no name to show', () => {
    expect(viewerTitle('')).toBe(VIEWER_FALLBACK_TITLE)
    expect(viewerTitle('C:\\work\\')).toBe(VIEWER_FALLBACK_TITLE)
  })
})
