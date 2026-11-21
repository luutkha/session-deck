import { describe, expect, it } from 'vitest'
import type { ResolvedLink } from '../../../shared/types'
import { linkMenuHeading, linkMenuRows } from './linkMenuRows'

const ids = (link: ResolvedLink): readonly string[] => linkMenuRows(link, 'x').map((row) => row.id)
const labels = (link: ResolvedLink): readonly string[] => linkMenuRows(link, 'x').map((row) => row.label)

describe('linkMenuRows (D76)', () => {
  it('offers Preview first for a file the viewer knows', () => {
    expect(ids({ kind: 'file', target: 'C:\\work\\notes.md' })).toEqual([
      'preview',
      'open',
      'reveal',
      'copyPath'
    ])
    expect(ids({ kind: 'file', target: 'C:\\work\\shot.PNG' })).toEqual([
      'preview',
      'open',
      'reveal',
      'copyPath'
    ])
  })

  it('skips Preview for a file the viewer cannot show', () => {
    for (const target of ['C:\\work\\app.exe', 'C:\\work\\old.xls', 'C:\\work\\letter.doc']) {
      expect(ids({ kind: 'file', target })).toEqual(['open', 'reveal', 'copyPath'])
    }
  })

  it('offers the folder rows for a folder, even one named like a file', () => {
    expect(ids({ kind: 'folder', target: 'C:\\work\\notes.md' })).toEqual(['openFolder', 'copyPath'])
  })

  it('offers the browser rows for a URL', () => {
    expect(ids({ kind: 'url', target: 'https://example.com/docs/notes.md' })).toEqual([
      'openUrl',
      'copyUrl'
    ])
  })

  it('labels the rows exactly', () => {
    expect(labels({ kind: 'file', target: 'C:\\work\\notes.md' })).toEqual([
      'Open in Side Panel',
      'Open in Default App',
      'Show in Explorer',
      'Copy Path'
    ])
    expect(labels({ kind: 'file', target: 'C:\\work\\app.exe' })).toEqual([
      'Open in Default App',
      'Show in Explorer',
      'Copy Path'
    ])
    expect(labels({ kind: 'folder', target: 'C:\\work' })).toEqual(['Open Folder', 'Copy Path'])
    expect(labels({ kind: 'url', target: 'https://example.com' })).toEqual([
      'Open in Browser',
      'Copy Link'
    ])
  })
})

describe('linkMenuHeading (D76)', () => {
  it('shows the file name, spaces and accents kept', () => {
    expect(linkMenuHeading({ kind: 'file', target: 'C:\\Users\\Me\\Báo cáo tháng 10.pdf' }, 'Báo cáo tháng 10.pdf'))
      .toBe('Báo cáo tháng 10.pdf')
    expect(linkMenuHeading({ kind: 'file', target: 'C:/work/docs/My Notes.md' }, 'docs/My Notes.md'))
      .toBe('My Notes.md')
  })

  it('shows the folder name', () => {
    expect(linkMenuHeading({ kind: 'folder', target: 'C:\\work\\My Project' }, 'My Project'))
      .toBe('My Project')
  })

  it('shows the URL host, or the whole link when it has none', () => {
    expect(linkMenuHeading({ kind: 'url', target: 'https://example.com:8443/a/b?q=1' }, 'https://example.com:8443/a/b?q=1'))
      .toBe('example.com:8443')
    expect(linkMenuHeading({ kind: 'url', target: 'mailto:me@example.com' }, 'mailto:me@example.com'))
      .toBe('mailto:me@example.com')
  })

  it('falls back to the link text when the target has no last segment', () => {
    expect(linkMenuHeading({ kind: 'folder', target: 'C:\\' }, 'C:\\')).toBe('C:\\')
  })
})
