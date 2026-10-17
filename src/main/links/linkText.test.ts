import { describe, expect, it } from 'vitest'
import { MAX_LINK_TEXT_LENGTH, parseLinkText } from './linkText'

describe('parseLinkText: URLs', () => {
  it('normalizes http and https URLs', () => {
    expect(parseLinkText('https://example.com')).toEqual({ kind: 'url', url: 'https://example.com/' })
    expect(parseLinkText('http://localhost:3000/a/b')).toEqual({ kind: 'url', url: 'http://localhost:3000/a/b' })
  })

  it('accepts an upper-case scheme and lower-cases the host', () => {
    expect(parseLinkText('HTTPS://EXAMPLE.com/Path')).toEqual({ kind: 'url', url: 'https://example.com/Path' })
  })

  it('normalizes mailto links', () => {
    expect(parseLinkText('mailto:foo@example.com')).toEqual({ kind: 'url', url: 'mailto:foo@example.com' })
  })

  it('keeps a balanced closing parenthesis (Wikipedia) and drops trailing punctuation', () => {
    expect(parseLinkText('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual({
      kind: 'url',
      url: 'https://en.wikipedia.org/wiki/Foo_(bar)'
    })
    expect(parseLinkText('https://en.wikipedia.org/wiki/Foo_(bar).')).toEqual({
      kind: 'url',
      url: 'https://en.wikipedia.org/wiki/Foo_(bar)'
    })
  })

  it('strips trailing sentence punctuation from URLs', () => {
    expect(parseLinkText('https://example.com.')).toEqual({ kind: 'url', url: 'https://example.com/' })
    expect(parseLinkText('https://example.com/a?')).toEqual({ kind: 'url', url: 'https://example.com/a' })
    expect(parseLinkText('https://x.com)')).toEqual({ kind: 'url', url: 'https://x.com/' })
  })

  it('rejects unsupported schemes', () => {
    expect(parseLinkText('javascript:alert(1)')).toBeNull()
    expect(parseLinkText('data:text/plain,hi')).toBeNull()
    expect(parseLinkText('ftp://example.com')).toBeNull()
    expect(parseLinkText('vbscript:msgbox(1)')).toBeNull()
  })

  it('rejects a malformed URL that throws', () => {
    expect(parseLinkText('https://')).toBeNull()
  })
})

describe('parseLinkText: file URLs', () => {
  it('converts file:///C:/ paths to a Windows path', () => {
    expect(parseLinkText('file:///C:/x/y')).toEqual({ kind: 'path', path: 'C:/x/y', home: false })
    expect(parseLinkText('file://C:/x/y')).toEqual({ kind: 'path', path: 'C:/x/y', home: false })
  })

  it('decodes %xx escapes', () => {
    expect(parseLinkText('file:///C:/Program%20Files/app.txt')).toEqual({
      kind: 'path',
      path: 'C:/Program Files/app.txt',
      home: false
    })
  })
})

describe('parseLinkText: wrappers', () => {
  it('strips surrounding quotes, backticks and angle brackets', () => {
    expect(parseLinkText('"src/a.ts"')).toEqual({ kind: 'path', path: 'src/a.ts', home: false })
    expect(parseLinkText("'C:\\x\\y'")).toEqual({ kind: 'path', path: 'C:\\x\\y', home: false })
    expect(parseLinkText('`src/a.ts`')).toEqual({ kind: 'path', path: 'src/a.ts', home: false })
    expect(parseLinkText('<https://example.com>')).toEqual({ kind: 'url', url: 'https://example.com/' })
  })

  it('strips one layer of () [] {}', () => {
    expect(parseLinkText('(https://example.com)')).toEqual({ kind: 'url', url: 'https://example.com/' })
    expect(parseLinkText('[C:\\x]')).toEqual({ kind: 'path', path: 'C:\\x', home: false })
    expect(parseLinkText('{src/a.ts}')).toEqual({ kind: 'path', path: 'src/a.ts', home: false })
  })
})

describe('parseLinkText: path forms', () => {
  it('matches absolute Windows paths', () => {
    expect(parseLinkText('C:\\Users\\me\\file.txt')).toEqual({ kind: 'path', path: 'C:\\Users\\me\\file.txt', home: false })
    expect(parseLinkText('C:/Users/me/file.txt')).toEqual({ kind: 'path', path: 'C:/Users/me/file.txt', home: false })
  })

  it('matches UNC paths', () => {
    expect(parseLinkText('\\\\server\\share\\file.txt')).toEqual({
      kind: 'path',
      path: '\\\\server\\share\\file.txt',
      home: false
    })
  })

  it('matches home paths and removes the tilde', () => {
    expect(parseLinkText('~/Documents/notes.md')).toEqual({ kind: 'path', path: '/Documents/notes.md', home: true })
    expect(parseLinkText('~\\Documents\\notes.md')).toEqual({ kind: 'path', path: '\\Documents\\notes.md', home: true })
  })

  it('matches dot-relative paths', () => {
    expect(parseLinkText('./src/main/index.ts')).toEqual({ kind: 'path', path: './src/main/index.ts', home: false })
    expect(parseLinkText('.\\src\\main\\index.ts')).toEqual({ kind: 'path', path: '.\\src\\main\\index.ts', home: false })
    expect(parseLinkText('../foo/bar.txt')).toEqual({ kind: 'path', path: '../foo/bar.txt', home: false })
  })

  it('matches relative paths with a separator', () => {
    expect(parseLinkText('src/a/b.ts')).toEqual({ kind: 'path', path: 'src/a/b.ts', home: false })
    expect(parseLinkText('src\\a\\b.ts')).toEqual({ kind: 'path', path: 'src\\a\\b.ts', home: false })
    expect(parseLinkText('src/main')).toEqual({ kind: 'path', path: 'src/main', home: false })
  })

  it('matches bare filenames with an extension', () => {
    expect(parseLinkText('package.json')).toEqual({ kind: 'path', path: 'package.json', home: false })
    expect(parseLinkText('README.md')).toEqual({ kind: 'path', path: 'README.md', home: false })
  })

  it('rejects paths containing wildcards or quotes', () => {
    expect(parseLinkText('src/*.ts')).toBeNull()
    expect(parseLinkText('C:\\a\\b?.ts')).toBeNull()
    expect(parseLinkText('a|b')).toBeNull()
    expect(parseLinkText('src/<x>')).toBeNull()
    expect(parseLinkText('src/"x"')).toBeNull()
  })
})

describe('parseLinkText: position suffixes', () => {
  it('parses :12 and :12:5', () => {
    expect(parseLinkText('src/a.ts:12')).toEqual({ kind: 'path', path: 'src/a.ts', home: false, line: 12 })
    expect(parseLinkText('src/a.ts:12:5')).toEqual({ kind: 'path', path: 'src/a.ts', home: false, line: 12, column: 5 })
  })

  it('parses (12) and (12,5)', () => {
    expect(parseLinkText('src/a.ts(12)')).toEqual({ kind: 'path', path: 'src/a.ts', home: false, line: 12 })
    expect(parseLinkText('src/a.ts(12,5)')).toEqual({ kind: 'path', path: 'src/a.ts', home: false, line: 12, column: 5 })
  })

  it('treats a drive-letter colon as part of the path, not a position', () => {
    expect(parseLinkText('C:\\a\\b.ts:12:5')).toEqual({
      kind: 'path',
      path: 'C:\\a\\b.ts',
      home: false,
      line: 12,
      column: 5
    })
    expect(parseLinkText('C:\\a\\b')).toEqual({ kind: 'path', path: 'C:\\a\\b', home: false })
  })

  it('rejects times and single-letter drive colons', () => {
    expect(parseLinkText('12:30:45')).toBeNull()
    expect(parseLinkText('C:12')).toBeNull()
  })
})

describe('parseLinkText: negatives and limits', () => {
  it('rejects plain words', () => {
    expect(parseLinkText('hello')).toBeNull()
    expect(parseLinkText('src')).toBeNull()
    expect(parseLinkText('README')).toBeNull()
    expect(parseLinkText('e.g')).toBeNull()
    expect(parseLinkText('1.2.3')).toBeNull()
  })

  it('rejects empty and whitespace-only text', () => {
    expect(parseLinkText('')).toBeNull()
    expect(parseLinkText('   ')).toBeNull()
  })

  it('rejects text longer than the limit', () => {
    expect(parseLinkText(`https://example.com/${'a'.repeat(MAX_LINK_TEXT_LENGTH)}`)).toBeNull()
  })

  it('rejects control characters', () => {
    expect(parseLinkText('src/a.ts\u0000')).toBeNull()
    expect(parseLinkText('src/a\tb.ts')).toBeNull()
  })

  it('rejects a wrapped sentence that is not a single target', () => {
    expect(parseLinkText('(see https://x.com)')).toBeNull()
  })
})
