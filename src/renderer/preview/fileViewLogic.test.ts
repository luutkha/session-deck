import { describe, expect, it } from 'vitest'
import type { Config } from 'dompurify'
import type { FileView, FileViewSheet } from '../../shared/types'
import {
  columnLabel,
  formatBytes,
  imageSrc,
  kindLabel,
  sanitizeDocxHtml,
  visibleSheet
} from './fileViewLogic'

function sheet(name: string, rows: readonly (readonly string[])[], truncated = false): FileViewSheet {
  return { name, rows, truncated }
}

function view(overrides: Partial<FileView> = {}): FileView {
  return {
    path: 'C:/work/book.xlsx',
    name: 'book.xlsx',
    kind: 'sheet',
    size: 2048,
    content: '',
    base64: '',
    mime: '',
    sheets: [],
    truncated: false,
    mtimeMs: 0,
    ...overrides
  }
}

describe('columnLabel', () => {
  it('maps spreadsheet column indexes to letters', () => {
    expect(columnLabel(0)).toBe('A')
    expect(columnLabel(1)).toBe('B')
    expect(columnLabel(25)).toBe('Z')
    expect(columnLabel(26)).toBe('AA')
    expect(columnLabel(27)).toBe('AB')
    expect(columnLabel(51)).toBe('AZ')
    expect(columnLabel(52)).toBe('BA')
    expect(columnLabel(701)).toBe('ZZ')
    expect(columnLabel(702)).toBe('AAA')
  })

  it('gives no label for a value that cannot be a column', () => {
    expect(columnLabel(-1)).toBe('')
    expect(columnLabel(Number.NaN)).toBe('')
    expect(columnLabel(Number.POSITIVE_INFINITY)).toBe('')
  })
})

describe('formatBytes', () => {
  it('shows plain bytes below 1 KB', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1)).toBe('1 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('steps through KB, MB, GB and TB with one decimal below 100', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(150 * 1024)).toBe('150 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(12.34 * 1024 * 1024)).toBe('12.3 MB')
    expect(formatBytes(5.5 * 1024 * 1024 * 1024)).toBe('5.5 GB')
    expect(formatBytes(3 * 1024 * 1024 * 1024 * 1024)).toBe('3.0 TB')
  })

  it('never shows a negative or broken size', () => {
    expect(formatBytes(-5)).toBe('0 B')
    expect(formatBytes(Number.NaN)).toBe('0 B')
  })
})

describe('kindLabel', () => {
  it('names every kind for the footer', () => {
    expect(kindLabel('markdown')).toBe('Markdown')
    expect(kindLabel('text')).toBe('Text')
    expect(kindLabel('image')).toBe('Image')
    expect(kindLabel('csv')).toBe('CSV')
    expect(kindLabel('sheet')).toBe('Spreadsheet')
    expect(kindLabel('docx')).toBe('Word document')
    expect(kindLabel('pdf')).toBe('PDF document')
  })
})

describe('imageSrc', () => {
  it('builds a data URL from the mime and the base64 bytes', () => {
    expect(imageSrc(view({ kind: 'image', mime: 'image/png', base64: 'iVBORw0KGgo=' }))).toBe(
      'data:image/png;base64,iVBORw0KGgo='
    )
  })

  it('falls back to a generic mime when main sent none', () => {
    expect(imageSrc(view({ kind: 'image', mime: '', base64: 'AAAA' }))).toBe('data:application/octet-stream;base64,AAAA')
  })

  it('gives an empty src when there are no bytes', () => {
    expect(imageSrc(view({ kind: 'image', mime: 'image/png', base64: '' }))).toBe('')
  })
})

describe('visibleSheet', () => {
  const first = sheet('First', [['a']])
  const second = sheet('Second', [['b']])

  it('returns the sheet at the index', () => {
    expect(visibleSheet(view({ sheets: [first, second] }), 1)).toBe(second)
  })

  it('clamps an index that no longer exists to the last sheet', () => {
    expect(visibleSheet(view({ sheets: [first, second] }), 7)).toBe(second)
  })

  it('clamps a negative or broken index to the first sheet', () => {
    expect(visibleSheet(view({ sheets: [first, second] }), -3)).toBe(first)
    expect(visibleSheet(view({ sheets: [first, second] }), Number.NaN)).toBe(first)
  })

  it('returns null when the file has no sheets', () => {
    expect(visibleSheet(view({ sheets: [] }), 0)).toBeNull()
  })
})

describe('sanitizeDocxHtml', () => {
  it('asks the purifier for the strict allow-list', () => {
    const seen: { config: Config | null } = { config: null }
    sanitizeDocxHtml('<p>x</p>', (html: string, config: Config): string => {
      seen.config = config
      return html
    })
    const config = seen.config
    if (config === null) throw new Error('the purifier was not called with a config')
    const tags = config.ALLOWED_TAGS ?? []
    expect(tags).toContain('p')
    expect(tags).toContain('table')
    expect(tags).toContain('strong')
    expect(tags).not.toContain('script')
    expect(tags).not.toContain('style')
    expect(tags).not.toContain('img')
    expect(tags).not.toContain('iframe')
    expect(config.ALLOWED_ATTR).toEqual(['href', 'colspan', 'rowspan'])
    expect(config.ALLOW_DATA_ATTR).toBe(false)
  })

  it('removes script blocks with their content', () => {
    const clean = sanitizeDocxHtml('<p>hi</p><script>alert(1)</script>')
    expect(clean).toBe('<p>hi</p>')
    expect(clean).not.toContain('alert')
  })

  it('removes style, onclick and every attribute except the allowed ones', () => {
    expect(sanitizeDocxHtml('<p onclick="steal()" style="color:red" class="x">hi</p>')).toBe('<p>hi</p>')
  })

  it('drops images and other non-text tags but keeps the prose around them', () => {
    expect(sanitizeDocxHtml('<p>a<img src="x" onerror="steal()" />b</p>')).toBe('<p>ab</p>')
    expect(sanitizeDocxHtml('<div><p>text</p></div>')).toBe('<p>text</p>')
    expect(sanitizeDocxHtml('<iframe src="https://x.test"></iframe><p>ok</p>')).toBe('<p>ok</p>')
  })

  it('keeps the text of a link but not a javascript: href', () => {
    expect(sanitizeDocxHtml('<a href="javascript:alert(1)">bad</a>')).toBe('<a>bad</a>')
    expect(sanitizeDocxHtml('<a href="java\tscript:alert(1)">bad</a>')).toBe('<a>bad</a>')
  })

  it('keeps http(s) and relative links, plus table spans', () => {
    expect(sanitizeDocxHtml('<a href="https://example.com/x?y=1" target="_blank">ok</a>')).toBe(
      '<a href="https://example.com/x?y=1">ok</a>'
    )
    expect(sanitizeDocxHtml('<a href="#top">top</a>')).toBe('<a href="#top">top</a>')
    expect(sanitizeDocxHtml('<table><tr><td colspan="2" rowspan="3">x</td></tr></table>')).toBe(
      '<table><tr><td colspan="2" rowspan="3">x</td></tr></table>'
    )
    expect(sanitizeDocxHtml('<td colspan="0" rowspan="two">x</td>')).toBe('<td>x</td>')
  })

  it('keeps the common text tags and drops comments', () => {
    const html =
      '<h1>T</h1><!-- note --><ul><li><strong>b</strong> <em>i</em></li></ul><blockquote><p>q</p></blockquote><pre><code>c</code></pre>'
    expect(sanitizeDocxHtml(html)).toBe(
      '<h1>T</h1><ul><li><strong>b</strong> <em>i</em></li></ul><blockquote><p>q</p></blockquote><pre><code>c</code></pre>'
    )
  })

  it('keeps an escaped quote inside the href (it cannot end the attribute)', () => {
    expect(sanitizeDocxHtml('<a href="https://x.test/a&quot;onmouseover=&quot;steal()">x</a>')).toBe(
      '<a href="https://x.test/a&quot;onmouseover=&quot;steal()">x</a>'
    )
  })

  it('leaves empty input empty', () => {
    expect(sanitizeDocxHtml('')).toBe('')
  })
})
