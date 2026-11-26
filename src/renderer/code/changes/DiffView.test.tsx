// No DOM test environment in this repo: render with react-dom/server (as ChangesPanel.test.tsx does).
// Effects do not run there, so this checks the chunk markup; the observer's mounted-set decision is
// covered by pure tests in diffChunks.test.ts.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FileDiff } from '../../../shared/types'
import type { DiffAnnotation } from './annotations'
import { DiffView, type DiffViewProps } from './DiffView'

function fileDiff(diff: string): FileDiff {
  return { worktreeId: 'w1', path: 'x.txt', diff, binary: false, truncated: false }
}

/** `rows` body rows: one hunk header followed by context lines. Meta lines are filtered out by DiffView. */
function diffWithRows(rows: number): FileDiff {
  const body = Math.max(0, rows - 1)
  return fileDiff([
    'diff --git a/x.txt b/x.txt',
    '--- a/x.txt',
    '+++ b/x.txt',
    `@@ -1,${String(body)} +1,${String(body)} @@`,
    ...Array.from({ length: body }, (_, i) => ` line ${String(i + 1)}`)
  ].join('\n'))
}

/** A hunk header before each listed row; the last short chunk stays unmounted in a long diff. */
function diffWithHunksAt(rows: number, at: readonly number[]): FileDiff {
  const starts = new Set(at)
  const lines = ['diff --git a/x.txt b/x.txt', '--- a/x.txt', '+++ b/x.txt']
  for (let row = 0; row < rows; row += 1) {
    if (starts.has(row)) {
      const count = (at.find((next) => next > row) ?? rows) - row
      lines.push(`@@ -${String(row + 1)},${String(count)} +${String(row + 1)},${String(count)} @@`)
    }
    lines.push(` line ${String(row + 1)}`)
  }
  return fileDiff(lines.join('\n'))
}

/** `pairs` delete/add pairs after the hunk header: pairLines collapses each pair into one split row. */
function diffWithPairs(pairs: number): FileDiff {
  const lines = ['diff --git a/x.txt b/x.txt', '--- a/x.txt', '+++ b/x.txt', `@@ -1,${String(pairs)} +1,${String(pairs)} @@`]
  for (let pair = 1; pair <= pairs; pair += 1) lines.push(`-old ${String(pair)}`, `+new ${String(pair)}`)
  return fileDiff(lines.join('\n'))
}

function annotation(text: string, line: number): DiffAnnotation {
  return { id: text, path: 'x.txt', line, side: 'new', text, createdAt: 1 }
}

function render({ diff, layout, ...rest }: Partial<DiffViewProps> & { readonly diff: FileDiff }): string {
  return renderToStaticMarkup(<DiffView diff={diff} loading={false} error={null} layout={layout} {...rest} />)
}

describe('DiffView states', () => {
  it('shows the empty notice instead of chunks when the diff has no text', () => {
    for (const layout of ['inline', 'split'] as const) {
      const html = render({ diff: fileDiff(''), layout })
      expect(html).toContain('No text changes.')
      expect(html).not.toContain('data-diff-chunk=')
    }
  })

  it('shows a binary notice without a diff layout', () => {
    const html = render({ diff: { ...fileDiff('anything'), binary: true } })
    expect(html).toContain('Binary file, no text diff.')
    expect(html).not.toContain('data-diff-layout=')
    expect(html).not.toContain('data-diff-chunk=')
  })

  it('shows an alert for an error and the loading text while a missing diff loads', () => {
    const error = renderToStaticMarkup(<DiffView diff={fileDiff('')} loading={false} error="boom" />)
    expect(error).toContain('role="alert"')
    expect(error).toContain('boom')
    const loading = renderToStaticMarkup(<DiffView diff={null} loading error={null} />)
    expect(loading).toContain('Loading diff...')
    expect(renderToStaticMarkup(<DiffView diff={null} loading={false} error={null} />)).not.toContain('Loading diff...')
  })
})

describe('DiffView small diffs', () => {
  it('renders every row without a placeholder or observer at the 600-row boundary', () => {
    const html = render({ diff: diffWithRows(600) })
    expect(html).toContain('data-diff-layout="inline"')
    expect(html).toContain('line 599')
    expect(html).not.toContain('data-diff-chunk=')
  })

  it('keeps every discard-hunk button when the diff is small', () => {
    const html = render({ diff: diffWithHunksAt(100, [0, 20, 40, 60, 80]), onDiscardHunk: (): void => undefined })
    expect(html.match(/data-discard-hunk=""/g)?.length).toBe(5)
  })
})

describe('DiffView long diffs', () => {
  it('mounts the first three chunks and holds the rest with height-correct placeholders', () => {
    const html = render({ diff: diffWithRows(800) })
    expect(html).toContain('line 599')
    expect(html).not.toContain('line 600')
    expect(html.match(/data-diff-chunk="/g)?.length).toBe(1)
    expect(html).toContain('data-diff-chunk="3"')
    expect(html).toContain('data-diff-chunk-rows="200"')
    expect(html).toContain('height:3600px')
  })

  it('sizes the trailing short chunk by its real row count', () => {
    const html = render({ diff: diffWithRows(601) })
    expect(html).toContain('data-diff-chunk="3"')
    expect(html).toContain('data-diff-chunk-rows="1"')
    expect(html).toContain('height:18px')
  })

  it('holds two placeholders at 801 rows and leaves the last one-row chunk unmounted', () => {
    const html = render({ diff: diffWithRows(801) })
    expect(html.match(/data-diff-chunk="/g)?.length).toBe(2)
    expect(html).toContain('data-diff-chunk="3"')
    expect(html).toContain('data-diff-chunk="4"')
    expect(html).toContain('data-diff-chunk-rows="1"')
    expect(html).toContain('height:18px')
    expect(html).toContain('line 599')
    expect(html).not.toContain('line 600')
  })

  it('mounts complete chunks in order and stops exactly at the first placeholder', () => {
    const html = render({ diff: diffWithRows(800) })
    for (const row of ['line 1', 'line 200', 'line 400', 'line 599']) expect(html).toContain(row)
    expect(html.indexOf('line 1')).toBeLessThan(html.indexOf('line 200'))
    expect(html.indexOf('line 200')).toBeLessThan(html.indexOf('line 400'))
    expect(html.indexOf('line 400')).toBeLessThan(html.indexOf('line 599'))
    expect(html).not.toContain('line 600')
    expect(html.match(/data-diff-chunk="/g)?.length).toBe(1)
  })

  it('caps a 10,000-line diff at 5,000 rows and holds the remaining 22 chunks', () => {
    const html = render({ diff: diffWithRows(10_000) })
    expect(html).toContain('Showing the first 5000 lines.')
    expect(html.match(/data-diff-chunk="/g)?.length).toBe(22)
    expect(html).toContain('data-diff-chunk="24"')
    expect(html).toContain('data-diff-chunk-rows="200"')
    expect(html).toContain('height:3600px')
    expect(html).toContain('line 599')
    expect(html).not.toContain('line 600')
  })

  it('leaves a discard button only on hunks in mounted chunks', () => {
    const html = render({
      diff: diffWithHunksAt(800, [0, 200, 400, 600]),
      onDiscardHunk: (): void => undefined
    })
    expect(html.match(/data-discard-hunk=""/g)?.length).toBe(3)
    expect(html).toContain('@@ -401,200 +401,200 @@')
    expect(html).not.toContain('@@ -601,200 +601,200 @@')
  })

  it('keeps annotation anchors in order for mounted rows and defers far-away ones', () => {
    const html = render({
      diff: diffWithRows(800),
      annotations: [annotation('near top', 5), annotation('in third chunk', 350), annotation('far down', 700)],
      onAddComment: (): void => undefined
    })
    expect(html).toContain('aria-label="Commented: near top"')
    expect(html).toContain('aria-label="Commented: in third chunk"')
    expect(html).not.toContain('aria-label="Commented: far down"')
    expect(html.indexOf('near top')).toBeLessThan(html.indexOf('in third chunk'))
  })
})

describe('DiffView split layout', () => {
  it('chunks paired rows (not source lines) and keeps the placeholder in the grid', () => {
    const html = render({ diff: diffWithRows(800), layout: 'split' })
    expect(html).toContain('data-diff-layout="split"')
    expect(html.match(/data-diff-chunk="/g)?.length).toBe(1)
    expect(html).toContain('data-diff-chunk="3"')
    expect(html).toContain('class="col-span-2"')
    expect(html).toContain('height:3600px')
    expect(html).not.toContain('line 600')
  })

  it('chunks paired rows, not source lines: a 400-pair diff is one split chunk but five inline chunks', () => {
    const diff = diffWithPairs(400)
    const inline = render({ diff })
    expect(inline.match(/data-diff-chunk="/g)?.length).toBe(2)
    const split = render({ diff, layout: 'split' })
    expect(split).not.toContain('data-diff-chunk=')
    expect(split).toContain('old 400')
    expect(split).toContain('new 400')
  })

  it('renders paired old and new lines with blank cells for unmatched sides', () => {
    const diff = fileDiff([
      'diff --git a/x.txt b/x.txt',
      '--- a/x.txt',
      '+++ b/x.txt',
      '@@ -1,3 +1,3 @@',
      ' shared',
      '-gone',
      '+added a',
      '+added b',
      '-gone too'
    ].join('\n'))
    const html = render({ diff, layout: 'split' })
    expect(html.match(/shared/g)?.length).toBe(2)
    expect(html).toContain('gone too')
    expect(html).toContain('added a')
    expect(html).toContain('added b')
    expect(html.match(/bg-muted\/20/g)?.length).toBe(2)
    expect(html).not.toContain('Comment on this line')
    expect(html).not.toContain('data-diff-chunk=')
  })

  it('has no annotation buttons or comment dots in split layout', () => {
    const props = { annotations: [annotation('note', 1)], onAddComment: (): void => undefined }
    const inline = render({ diff: diffWithRows(3), ...props })
    expect(inline).toContain('aria-label="Comment on this line"')
    expect(inline).toContain('Commented: note')
    const split = render({ diff: diffWithRows(3), layout: 'split', ...props })
    expect(split).toContain('data-diff-layout="split"')
    expect(split).not.toContain('Comment on this line')
    expect(split).not.toContain('Commented: note')
  })

  it('places the split placeholder on paired-row boundaries, with its real row count', () => {
    const html = render({ diff: diffWithPairs(800), layout: 'split' })
    expect(html.match(/data-diff-chunk="/g)?.length).toBe(2)
    expect(html).toContain('data-diff-chunk="3"')
    expect(html).toContain('data-diff-chunk="4"')
    expect(html).toContain('data-diff-chunk-rows="200"')
    expect(html).toContain('height:3600px')
    expect(html).toContain('data-diff-chunk-rows="1"')
    expect(html).toContain('height:18px')
    expect(html).toContain('class="col-span-2"')
    expect(html).toContain('old 599')
    expect(html).not.toContain('old 600')
  })

  it('caps a very long split diff before pairing and holds the rest in chunks', () => {
    const html = render({ diff: diffWithPairs(5000), layout: 'split' })
    expect(html).toContain('Showing the first 5000 lines.')
    expect(html.match(/data-diff-chunk="/g)?.length).toBe(10)
    expect(html).toContain('data-diff-chunk="12"')
    expect(html).toContain('data-diff-chunk-rows="101"')
    expect(html).toContain('height:1818px')
    expect(html).toContain('old 1')
    expect(html).not.toContain('old 2500')
  })
})
