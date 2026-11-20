import { describe, expect, it } from 'vitest'
import { resolveRelativeAsset } from './markdownAssets'

const BASE = 'C:\\works\\project\\docs\\README.md'

describe('resolveRelativeAsset: relative references', () => {
  it('resolves a bare name and ./ against the document folder', () => {
    expect(resolveRelativeAsset(BASE, 'pic.png')).toBe('C:\\works\\project\\docs\\pic.png')
    expect(resolveRelativeAsset(BASE, './pic.png')).toBe('C:\\works\\project\\docs\\pic.png')
  })

  it('resolves sub-folders and parent folders', () => {
    expect(resolveRelativeAsset(BASE, 'sub/x.png')).toBe('C:\\works\\project\\docs\\sub\\x.png')
    expect(resolveRelativeAsset(BASE, '../assets/pic.png')).toBe('C:\\works\\project\\assets\\pic.png')
    expect(resolveRelativeAsset(BASE, '../../pic.png')).toBe('C:\\works\\pic.png')
  })

  it('accepts back slashes and mixed slashes, returning backslash paths', () => {
    expect(resolveRelativeAsset(BASE, '.\\img\\pic.png')).toBe('C:\\works\\project\\docs\\img\\pic.png')
    expect(resolveRelativeAsset(BASE, 'sub\\deep/more/pic.png')).toBe(
      'C:\\works\\project\\docs\\sub\\deep\\more\\pic.png'
    )
    expect(resolveRelativeAsset(BASE, '..\\up/one\\pic.png')).toBe('C:\\works\\project\\up\\one\\pic.png')
  })

  it('works when the base path itself uses forward slashes', () => {
    const base = 'C:/works/project/docs/README.md'
    expect(resolveRelativeAsset(base, './pic.png')).toBe('C:\\works\\project\\docs\\pic.png')
    expect(resolveRelativeAsset(base, '../pic.png')).toBe('C:\\works\\project\\pic.png')
  })

  it('never climbs above the drive root', () => {
    const base = 'C:\\docs\\README.md'
    expect(resolveRelativeAsset(base, '../../../../pic.png')).toBe('C:\\pic.png')
    expect(resolveRelativeAsset(base, '..\\..\\..\\..\\..\\pic.png')).toBe('C:\\pic.png')
    expect(resolveRelativeAsset('C:\\README.md', '..\\..\\..\\x.png')).toBe('C:\\x.png')
  })

  it('decodes percent escapes, including spaces and unicode', () => {
    expect(resolveRelativeAsset(BASE, './my%20pic.png')).toBe('C:\\works\\project\\docs\\my pic.png')
    expect(resolveRelativeAsset(BASE, 'my%20pic.png')).toBe('C:\\works\\project\\docs\\my pic.png')
    expect(resolveRelativeAsset(BASE, './%D1%84%D0%BE%D1%82%D0%BE.png')).toBe(
      'C:\\works\\project\\docs\\фото.png'
    )
    expect(resolveRelativeAsset(BASE, './фото.png')).toBe('C:\\works\\project\\docs\\фото.png')
  })

  it('drops ?query and #fragment', () => {
    expect(resolveRelativeAsset(BASE, './pic.png?v=2')).toBe('C:\\works\\project\\docs\\pic.png')
    expect(resolveRelativeAsset(BASE, './pic.png#top')).toBe('C:\\works\\project\\docs\\pic.png')
    expect(resolveRelativeAsset(BASE, './pic.png?a=1#top')).toBe('C:\\works\\project\\docs\\pic.png')
    expect(resolveRelativeAsset(BASE, './pic.png#top?a=1')).toBe('C:\\works\\project\\docs\\pic.png')
  })

  it('trims surrounding whitespace', () => {
    expect(resolveRelativeAsset(BASE, '  ./pic.png  ')).toBe('C:\\works\\project\\docs\\pic.png')
  })
})

describe('resolveRelativeAsset: absolute Windows drive paths', () => {
  it('keeps C:\\x and C:/x as absolute paths, normalized to backslashes', () => {
    expect(resolveRelativeAsset(BASE, 'C:\\other\\pic.png')).toBe('C:\\other\\pic.png')
    expect(resolveRelativeAsset(BASE, 'C:/other/pic.png')).toBe('C:\\other\\pic.png')
    expect(resolveRelativeAsset(BASE, 'D:/pics/x.png')).toBe('D:\\pics\\x.png')
  })

  it('normalizes dot segments inside an absolute path', () => {
    expect(resolveRelativeAsset(BASE, 'C:\\a\\..\\b\\pic.png')).toBe('C:\\b\\pic.png')
    expect(resolveRelativeAsset(BASE, 'C:\\..\\..\\pic.png')).toBe('C:\\pic.png')
  })

  it('keeps the drive letter case the document used', () => {
    expect(resolveRelativeAsset(BASE, 'c:\\x\\pic.png')).toBe('c:\\x\\pic.png')
  })

  it('does not treat a drive-relative reference as a path', () => {
    expect(resolveRelativeAsset(BASE, 'C:pic.png')).toBeNull()
  })
})

describe('resolveRelativeAsset: references that are not plain local paths', () => {
  it('rejects empty and fragment-only references', () => {
    expect(resolveRelativeAsset(BASE, '')).toBeNull()
    expect(resolveRelativeAsset(BASE, '   ')).toBeNull()
    expect(resolveRelativeAsset(BASE, '#only-a-fragment')).toBeNull()
    expect(resolveRelativeAsset(BASE, '#top?x=1')).toBeNull()
    expect(resolveRelativeAsset(BASE, '?x=1')).toBeNull()
  })

  it('rejects every URI scheme', () => {
    const hrefs = [
      'http://example.com/t.gif',
      'https://example.com/t.gif',
      'data:image/png;base64,iVBORw0KGgo=',
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'file:///C:/x/pic.png',
      'mailto:someone@example.com',
      'tel:+15551234',
      'ftp://host/x.png',
      'custom-scheme:value',
      'my.app+x:thing'
    ]
    for (const href of hrefs) expect(resolveRelativeAsset(BASE, href)).toBeNull()
  })

  it('rejects protocol-relative and UNC references', () => {
    expect(resolveRelativeAsset(BASE, '//host/share/pic.png')).toBeNull()
    expect(resolveRelativeAsset(BASE, '\\\\host\\share\\pic.png')).toBeNull()
    expect(resolveRelativeAsset(BASE, '//C:/x/pic.png')).toBeNull()
  })

  it('rejects root-relative references (current drive root is not a plain relative path)', () => {
    expect(resolveRelativeAsset(BASE, '/pic.png')).toBeNull()
    expect(resolveRelativeAsset(BASE, '\\pic.png')).toBeNull()
  })

  it('rejects malformed percent escapes', () => {
    expect(resolveRelativeAsset(BASE, './100%.png')).toBeNull()
    expect(resolveRelativeAsset(BASE, './bad%zz.png')).toBeNull()
    expect(resolveRelativeAsset(BASE, './bad%2.png')).toBeNull()
    expect(resolveRelativeAsset(BASE, './bad%E0%A4%A.png')).toBeNull()
  })

  it('returns null when the base path has no drive letter', () => {
    expect(resolveRelativeAsset('docs/README.md', 'pic.png')).toBeNull()
    expect(resolveRelativeAsset('', 'pic.png')).toBeNull()
  })
})
