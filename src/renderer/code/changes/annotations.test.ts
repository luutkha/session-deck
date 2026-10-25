import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ANNOTATION_MAX_TEXT,
  ANNOTATIONS_MAX_PER_WORKTREE,
  addAnnotation,
  annotationForLine,
  annotationText,
  annotationsStorageKey,
  formatAnnotationMessage,
  parseAnnotations,
  readStoredAnnotations,
  removeAnnotation,
  sameComment,
  serializeAnnotations,
  storeAnnotations,
  type DiffAnnotation
} from './annotations'

const NOW = 1792900000000

function annotation(overrides: Partial<DiffAnnotation> = {}): DiffAnnotation {
  return {
    id: 'a1',
    path: 'src/app.ts',
    line: 42,
    side: 'new',
    text: 'don\u2019t cache this',
    createdAt: NOW,
    ...overrides
  }
}

describe('annotationText', () => {
  it('trims and keeps useful text', () => {
    expect(annotationText('  hello \n')).toBe('hello')
  })
  it('caps at ANNOTATION_MAX_TEXT', () => {
    expect(annotationText('x'.repeat(600))?.length).toBe(ANNOTATION_MAX_TEXT)
  })
  it('whitespace-only is nothing', () => {
    expect(annotationText('   ')).toBeNull()
  })
})

describe('addAnnotation', () => {
  const input = { id: 'n1', path: 'src/app.ts', line: 42, side: 'new' as const, text: 'comment' }

  it('appends with the given time', () => {
    const list = addAnnotation([], input, NOW)
    expect(list).toEqual([{ ...input, text: 'comment', createdAt: NOW }])
  })
  it('the exact same comment is ignored (dedupe)', () => {
    const first = addAnnotation([], input, NOW)
    const second = addAnnotation(first, { ...input, id: 'n2' }, NOW + 5)
    expect(second).toEqual(first)
  })
  it('the same text on another line or file is a new comment', () => {
    const first = addAnnotation([], input, NOW)
    expect(addAnnotation(first, { ...input, line: 43 }, NOW)).toHaveLength(2)
    expect(addAnnotation(first, { ...input, path: 'other.ts' }, NOW)).toHaveLength(2)
    expect(addAnnotation(first, { ...input, side: 'old' }, NOW)).toHaveLength(2)
  })
  it('blank text adds nothing', () => {
    expect(addAnnotation([], { ...input, text: '  ' }, NOW)).toEqual([])
  })
  it('the cap drops the oldest comments', () => {
    let list: readonly DiffAnnotation[] = []
    for (let i = 0; i < ANNOTATIONS_MAX_PER_WORKTREE + 3; i++) {
      list = addAnnotation(list, { ...input, id: `n${String(i)}`, line: i }, NOW + i)
    }
    expect(list).toHaveLength(ANNOTATIONS_MAX_PER_WORKTREE)
    expect(list[0]?.line).toBe(3)
    expect(list.at(-1)?.line).toBe(ANNOTATIONS_MAX_PER_WORKTREE + 2)
  })
})

describe('sameComment', () => {
  it('compares path, side, line and text only', () => {
    const a = annotation()
    expect(sameComment(a, { path: a.path, side: a.side, line: a.line, text: a.text })).toBe(true)
    expect(sameComment(a, { path: a.path, side: a.side, line: a.line, text: 'other' })).toBe(false)
  })
})

describe('removeAnnotation', () => {
  it('removes by id and keeps the rest', () => {
    const list = [annotation({ id: 'a' }), annotation({ id: 'b' })]
    expect(removeAnnotation(list, 'a').map((x) => x.id)).toEqual(['b'])
    expect(removeAnnotation(list, 'ghost')).toEqual(list)
  })
})

describe('annotationForLine', () => {
  it('context/add lines anchor on the new side (newNo)', () => {
    const list = [annotation({ side: 'new', line: 42 })]
    expect(annotationForLine(list, 'src/app.ts', { kind: 'add', oldNo: null, newNo: 42 })).toEqual(list[0])
    expect(annotationForLine(list, 'src/app.ts', { kind: 'context', oldNo: 40, newNo: 42 })).toEqual(list[0])
  })
  it('del lines anchor on the old side (oldNo)', () => {
    const list = [annotation({ side: 'old', line: 17 })]
    expect(annotationForLine(list, 'src/app.ts', { kind: 'del', oldNo: 17, newNo: null })).toEqual(list[0])
    // The new-side comment does not light up for a deletion at the same number.
    expect(annotationForLine([annotation({ side: 'new', line: 17 })], 'src/app.ts', { kind: 'del', oldNo: 17, newNo: null })).toBeNull()
  })
  it('another path or a numberless line matches nothing', () => {
    expect(annotationForLine([annotation()], 'other.ts', { kind: 'add', oldNo: null, newNo: 42 })).toBeNull()
    expect(annotationForLine([annotation()], 'src/app.ts', { kind: 'hunk', oldNo: null, newNo: null })).toBeNull()
  })
})

describe('formatAnnotationMessage', () => {
  it('formats the ready-to-apply prompt with the footer', () => {
    const message = formatAnnotationMessage([
      annotation({ path: 'src/renderer/App.tsx', line: 42, text: 'don\u2019t cache this, it breaks after restart' }),
      annotation({ path: 'src/main/index.ts', line: 17, text: 'extract this into a helper' })
    ])
    expect(message).toBe([
      'Review comments on the current changes (file — line):',
      '- src/renderer/App.tsx:42 — don\u2019t cache this, it breaks after restart',
      '- src/main/index.ts:17 — extract this into a helper',
      'Please apply these fixes.'
    ].join('\n'))
  })
  it('a del-side comment keeps the OLD line number', () => {
    const message = formatAnnotationMessage([annotation({ side: 'old', line: 17 })])
    expect(message).toContain('- src/app.ts:17 —')
  })
  it('null for an empty list', () => {
    expect(formatAnnotationMessage([])).toBeNull()
  })
  it('a numberless line shows ? instead of a number', () => {
    expect(formatAnnotationMessage([annotation({ line: null })])).toContain('- src/app.ts:? —')
  })
})

describe('serialize/parse roundtrip', () => {
  it('roundtrips a list', () => {
    const list = [annotation(), annotation({ side: 'old', line: null })]
    expect(parseAnnotations(serializeAnnotations(list))).toEqual(list)
  })
  it('malformed JSON, non-arrays and wrong shapes give null', () => {
    expect(parseAnnotations(null)).toBeNull()
    expect(parseAnnotations('')).toBeNull()
    expect(parseAnnotations('not json')).toBeNull()
    expect(parseAnnotations('{"a":1}')).toBeNull()
    expect(parseAnnotations('[{"id":1}]')).toBeNull()
    expect(parseAnnotations('[{"id":"a","path":"p","side":"middle","line":1,"text":"t","createdAt":1}]')).toBeNull()
    expect(parseAnnotations('[{"id":"a","path":"p","side":"new","line":"42","text":"t","createdAt":1}]')).toBeNull()
  })
  it('an empty stored array parses to []', () => {
    expect(parseAnnotations('[]')).toEqual([])
  })
})

describe('localStorage helpers', () => {
  const storage = new Map<string, string>()

  afterEach(() => {
    vi.unstubAllGlobals()
    storage.clear()
  })

  function installStorage(): void {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key)
    })
    vi.stubGlobal('window', { localStorage: undefined })
  }

  it('key is namespaced per worktree', () => {
    expect(annotationsStorageKey('wt1')).toBe('sessiondeck.annotate.v1.wt1')
  })
  it('stores and reads back one worktree\u2019s drafts', () => {
    installStorage()
    storeAnnotations('wt1', [annotation()])
    expect(readStoredAnnotations('wt1')).toEqual([annotation()])
    expect(readStoredAnnotations('wt2')).toEqual([])
  })
  it('malformed stored JSON degrades to []', () => {
    installStorage()
    storage.set(annotationsStorageKey('wt1'), 'garbage')
    expect(readStoredAnnotations('wt1')).toEqual([])
  })
  it('no localStorage (node tests) never throws', () => {
    expect(readStoredAnnotations('wt1')).toEqual([])
    expect(() => storeAnnotations('wt1', [annotation()])).not.toThrow()
  })
})
