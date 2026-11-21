import { describe, expect, it } from 'vitest'
import { MAX_CANDIDATES, detectLinkCandidates } from './detectLinks'

function texts(line: string): string[] {
  return detectLinkCandidates(line).map((candidate) => candidate.text)
}

describe('detectLinkCandidates: URLs', () => {
  it('matches http and https URLs', () => {
    expect(texts('see https://example.com/a/b now')).toEqual(['https://example.com/a/b'])
    expect(texts('http://localhost:3000/')).toEqual(['http://localhost:3000/'])
  })

  it('matches mailto links', () => {
    expect(texts('write to mailto:foo@example.com please')).toEqual(['mailto:foo@example.com'])
  })

  it('excludes trailing sentence punctuation', () => {
    expect(texts('see https://example.com.')).toEqual(['https://example.com'])
    expect(texts('is it https://example.com?')).toEqual(['https://example.com'])
  })

  it('keeps a balanced closing parenthesis (Wikipedia)', () => {
    expect(texts('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual([
      'https://en.wikipedia.org/wiki/Foo_(bar)'
    ])
  })

  it('drops an unbalanced closing parenthesis', () => {
    expect(texts('(see https://x.com)')).toEqual(['https://x.com'])
  })
})

describe('detectLinkCandidates: Windows paths', () => {
  it('matches drive-letter paths with backslashes and forward slashes', () => {
    expect(texts('C:\\Users\\me\\file.txt')).toEqual(['C:\\Users\\me\\file.txt'])
    expect(texts('C:/Users/me/file.txt')).toEqual(['C:/Users/me/file.txt'])
  })

  it('matches UNC paths', () => {
    expect(texts('\\\\server\\share\\file.txt')).toEqual(['\\\\server\\share\\file.txt'])
  })
})

describe('detectLinkCandidates: relative and bare paths', () => {
  it('matches ~/ ./ and ../ paths', () => {
    expect(texts('~/Documents/notes.md')).toEqual(['~/Documents/notes.md'])
    expect(texts('./src/main/index.ts')).toEqual(['./src/main/index.ts'])
    expect(texts('../foo/bar.txt')).toEqual(['../foo/bar.txt'])
  })

  it('matches relative paths with an extension or trailing separator', () => {
    expect(texts('src/main/index.ts')).toEqual(['src/main/index.ts'])
    expect(texts('src\\main\\')).toEqual(['src\\main\\'])
  })

  it('matches bare filenames with an extension', () => {
    expect(texts('edit package.json now')).toEqual(['package.json'])
    expect(texts('README.md')).toEqual(['README.md'])
  })

  it('does not match a/b without extension or trailing separator', () => {
    expect(texts('a/b')).toEqual([])
    expect(texts('src/main')).toEqual([])
    expect(texts('and/or')).toEqual([])
  })
})

describe('detectLinkCandidates: position suffixes', () => {
  it('keeps :12 and :12:5 suffixes', () => {
    expect(texts('src/main/index.ts:12')).toEqual(['src/main/index.ts:12'])
    expect(texts('src/main/index.ts:12:5')).toEqual(['src/main/index.ts:12:5'])
  })

  it('keeps (12) and (12,5) suffixes', () => {
    expect(texts('src/main/index.ts(12)')).toEqual(['src/main/index.ts(12)'])
    expect(texts('src/main/index.ts(12,5)')).toEqual(['src/main/index.ts(12,5)'])
  })

  it('keeps a suffix on a drive path and a bare filename', () => {
    expect(texts('C:\\a\\b.ts:12:5')).toEqual(['C:\\a\\b.ts:12:5'])
    expect(texts('package.json:12')).toEqual(['package.json:12'])
  })
})

describe('detectLinkCandidates: quoted targets with spaces', () => {
  it('matches the inside of a quoted path, without the quotes', () => {
    expect(texts('open "C:\\Program Files\\app.exe" now')).toEqual([
      'C:\\Program Files\\app.exe'
    ])
  })

  it('matches the inside of a backticked path and reports offsets', () => {
    const candidates = detectLinkCandidates('open `src/main/index.ts`')
    expect(candidates).toEqual([{ text: 'src/main/index.ts', start: 6, end: 23 }])
  })

  it('keeps a position suffix inside quotes', () => {
    expect(texts('"src/main/index.ts:12"')).toEqual(['src/main/index.ts:12'])
  })

  it('ignores quoted prose', () => {
    expect(texts('say "hello world"')).toEqual([])
  })
})

describe('detectLinkCandidates: offsets and ordering', () => {
  it('reports start/end offsets relative to the line', () => {
    expect(detectLinkCandidates('src/main/index.ts')).toEqual([
      { text: 'src/main/index.ts', start: 0, end: 17 }
    ])
    expect(detectLinkCandidates('a package.json b')).toEqual([
      { text: 'package.json', start: 2, end: 14 }
    ])
  })

  it('returns multiple candidates in left-to-right order', () => {
    expect(texts('https://a.com and src/main/index.ts')).toEqual([
      'https://a.com',
      'src/main/index.ts'
    ])
  })

  it('does not select a filename inside a URL', () => {
    expect(texts('https://example.com/foo.bar')).toEqual(['https://example.com/foo.bar'])
  })
})

describe('detectLinkCandidates: non-ASCII names (D75)', () => {
  it('keeps accented letters inside a path token', () => {
    expect(texts('C:\\Docs\\Bản_vẽ\\plan.pdf')).toEqual(['C:\\Docs\\Bản_vẽ\\plan.pdf'])
    expect(texts('naïve.txt')).toEqual(['naïve.txt'])
  })

  it('keeps Vietnamese words in a path', () => {
    expect(texts('C:\\Docs\\Báo\\plan.pdf')).toEqual(['C:\\Docs\\Báo\\plan.pdf'])
  })

  it('matches CJK names', () => {
    expect(texts('C:\\Docs\\日本語\\レポート.pdf')).toEqual(['C:\\Docs\\日本語\\レポート.pdf'])
    expect(texts('報告書.txt')).toEqual(['報告書.txt'])
  })

  it('does not treat accented prose as a link', () => {
    expect(texts('café au lait')).toEqual([])
    expect(texts('Báo cáo tháng 10')).toEqual([])
  })
})

describe('detectLinkCandidates: negatives', () => {
  it('ignores version numbers', () => {
    expect(texts('1.2.3')).toEqual([])
    expect(texts('v2.1.285')).toEqual([])
    expect(texts('3.14')).toEqual([])
  })

  it('ignores prose abbreviations', () => {
    expect(texts('e.g. this')).toEqual([])
    expect(texts('i.e. that')).toEqual([])
  })

  it('ignores times', () => {
    expect(texts('12:30:45')).toEqual([])
  })

  it('ignores plain words', () => {
    expect(texts('hello world')).toEqual([])
  })
})

describe('detectLinkCandidates: caps', () => {
  it('returns at most MAX_CANDIDATES candidates', () => {
    const line = Array.from({ length: 80 }, (_, i) => `https://e${i}.com`).join(' ')
    const candidates = detectLinkCandidates(line)
    expect(candidates).toHaveLength(MAX_CANDIDATES)
    expect(candidates[0].text).toBe('https://e0.com')
  })

  it('does not scan past 2000 characters', () => {
    const line = `${' '.repeat(2000)}https://x.com`
    expect(detectLinkCandidates(line)).toEqual([])
  })
})
