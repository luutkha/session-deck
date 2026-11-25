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

function annotation(text: string, line: number): DiffAnnotation {
  return { id: text, path: 'x.txt', line, side: 'new', text, createdAt: 1 }
}

function render({ diff, layout, ...rest }: Partial<DiffViewProps> & { readonly diff: FileDiff }): string {
  return renderToStaticMarkup(<DiffView diff={diff} loading={false} error={null} layout={layout} {...rest} />)
}

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
})
