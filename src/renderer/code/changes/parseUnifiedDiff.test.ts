import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff, type DiffLine } from './parseUnifiedDiff'

const HEADER = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts'
].join('\n')

describe('parseUnifiedDiff', () => {
  it('returns no lines for an empty diff', () => {
    expect(parseUnifiedDiff('')).toEqual([])
  })

  it('marks git header lines as meta with no line numbers', () => {
    const lines = parseUnifiedDiff(HEADER)
    expect(lines.map((line: DiffLine) => line.kind)).toEqual(['meta', 'meta', 'meta', 'meta'])
    expect(lines[0]).toEqual({ kind: 'meta', text: 'diff --git a/src/a.ts b/src/a.ts', oldNo: null, newNo: null })
  })

  it('numbers context, deleted and added lines from the hunk header', () => {
    const diff = `${HEADER}\n@@ -3,3 +3,3 @@\n keep\n-old\n+new\n tail`
    const body = parseUnifiedDiff(diff).slice(4)
    expect(body).toEqual([
      { kind: 'hunk', text: '@@ -3,3 +3,3 @@', oldNo: null, newNo: null },
      { kind: 'context', text: 'keep', oldNo: 3, newNo: 3 },
      { kind: 'del', text: 'old', oldNo: 4, newNo: null },
      { kind: 'add', text: 'new', oldNo: null, newNo: 4 },
      { kind: 'context', text: 'tail', oldNo: 5, newNo: 5 }
    ])
  })

  it('uses a count of 1 when the hunk header has no ",count" part', () => {
    const diff = '@@ -1 +1 @@\n-a\n+b'
    expect(parseUnifiedDiff(diff)).toEqual([
      { kind: 'hunk', text: '@@ -1 +1 @@', oldNo: null, newNo: null },
      { kind: 'del', text: 'a', oldNo: 1, newNo: null },
      { kind: 'add', text: 'b', oldNo: null, newNo: 1 }
    ])
  })

  it('keeps the trailing text after the hunk header', () => {
    const [hunk] = parseUnifiedDiff('@@ -10,2 +10,2 @@ function run() {\n a\n b')
    expect(hunk).toEqual({ kind: 'hunk', text: '@@ -10,2 +10,2 @@ function run() {', oldNo: null, newNo: null })
  })

  it('restarts numbering at each hunk header', () => {
    const diff = '@@ -1,1 +1,2 @@\n-x\n+y\n+z\n@@ -20,2 +21,2 @@\n a\n-b\n+c'
    const numbered = parseUnifiedDiff(diff).filter((line: DiffLine) => line.kind !== 'hunk')
    expect(numbered.map((line: DiffLine) => [line.kind, line.oldNo, line.newNo])).toEqual([
      ['del', 1, null],
      ['add', null, 1],
      ['add', null, 2],
      ['context', 20, 21],
      ['del', 21, null],
      ['add', null, 22]
    ])
  })

  it('treats a removed line that starts with "--" as a deletion inside a hunk', () => {
    const diff = '@@ -1,2 +1,1 @@\n--- old comment\n keep'
    expect(parseUnifiedDiff(diff)[1]).toEqual({ kind: 'del', text: '-- old comment', oldNo: 1, newNo: null })
  })

  it('marks the "No newline at end of file" line as a note', () => {
    const diff = '@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+a\n\\ No newline at end of file'
    const lines = parseUnifiedDiff(diff)
    expect(lines[2]).toEqual({ kind: 'note', text: '\\ No newline at end of file', oldNo: null, newNo: null })
    expect(lines[3]).toEqual({ kind: 'add', text: 'a', oldNo: null, newNo: 1 })
    expect(lines[4].kind).toBe('note')
  })

  it('removes a trailing carriage return from every line (CRLF files)', () => {
    const diff = '@@ -1,2 +1,2 @@\r\n-old\r\n+new\r\n same\r\n'
    expect(parseUnifiedDiff(diff)).toEqual([
      { kind: 'hunk', text: '@@ -1,2 +1,2 @@', oldNo: null, newNo: null },
      { kind: 'del', text: 'old', oldNo: 1, newNo: null },
      { kind: 'add', text: 'new', oldNo: null, newNo: 1 },
      { kind: 'context', text: 'same', oldNo: 2, newNo: 2 }
    ])
  })

  it('shows a rename-only diff as meta lines alone', () => {
    const diff = [
      'diff --git a/old.ts b/new.ts',
      'similarity index 100%',
      'rename from old.ts',
      'rename to new.ts'
    ].join('\n')
    const lines = parseUnifiedDiff(diff)
    expect(lines.every((line: DiffLine) => line.kind === 'meta')).toBe(true)
    expect(lines).toHaveLength(4)
  })

  it('marks mode change and binary notices as meta', () => {
    const diff = 'diff --git a/x.png b/x.png\nold mode 100644\nnew mode 100755\nBinary files a/x.png and b/x.png differ'
    expect(parseUnifiedDiff(diff).every((line: DiffLine) => line.kind === 'meta')).toBe(true)
  })

  it('marks new and deleted file headers as meta and numbers the whole new file', () => {
    const diff = 'diff --git a/n.ts b/n.ts\nnew file mode 100644\n--- /dev/null\n+++ b/n.ts\n@@ -0,0 +1,2 @@\n+one\n+two'
    const lines = parseUnifiedDiff(diff)
    expect(lines.slice(0, 4).every((line: DiffLine) => line.kind === 'meta')).toBe(true)
    expect(lines.slice(5)).toEqual([
      { kind: 'add', text: 'one', oldNo: null, newNo: 1 },
      { kind: 'add', text: 'two', oldNo: null, newNo: 2 }
    ])
  })

  it('drops only the trailing empty line produced by the final newline', () => {
    const lines = parseUnifiedDiff('@@ -1 +1 @@\n-a\n+b\n')
    expect(lines).toHaveLength(3)
  })

  it('treats a line without a diff marker inside a hunk body as meta and keeps the counts', () => {
    const lines = parseUnifiedDiff('@@ -1,2 +1,2 @@\nstray text\n-a')
    expect(lines[1]).toEqual({ kind: 'meta', text: 'stray text', oldNo: null, newNo: null })
    expect(lines[2]).toEqual({ kind: 'del', text: 'a', oldNo: 1, newNo: null })
  })

  it('keeps an empty line inside a hunk body as an empty context line', () => {
    const lines = parseUnifiedDiff('@@ -1,2 +1,2 @@\n\n-a\n+b')
    expect(lines[1]).toEqual({ kind: 'context', text: '', oldNo: 1, newNo: 1 })
  })
})
