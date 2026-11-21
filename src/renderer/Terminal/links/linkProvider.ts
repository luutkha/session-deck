import type { IDisposable, IBufferRange, ILink, ILinkProvider, Terminal } from '@xterm/xterm'
import type { Id } from '../../../shared/types'
import { requestFileView } from '../../viewer/previewBus'
import { detectLinkCandidates, type LinkCandidate } from './detectLinks'
import { chooseLinks, collectResolveTexts } from './linkChoice'
import { createLinkCache, type LinkCache } from './linkCache'
import { decideLinkClick } from './linkClick'
import { readLineText } from './lineCells'
import { detectSpacedPathGroups, hasSpacedPathHint, type SpacedGroup } from './spacedPaths'
import { clearHoveredLink, setHoveredLink, type HoveredLink } from './hoveredLink'

interface Segment {
  /** 1-based buffer row this physical line maps to. */
  readonly y: number
  /** Offset in the joined logical text where this line starts. */
  readonly start: number
  /** Length in characters of this physical line. */
  readonly length: number
  /** Per character of this line: the 1-based column where it starts (wide characters shift later ones). */
  readonly startCells: readonly number[]
  /** Per character of this line: the 1-based column of the last cell it covers (a wide character covers two). */
  readonly endCells: readonly number[]
}

interface WindowedLine {
  readonly text: string
  readonly lines: readonly Segment[]
}

interface Position {
  readonly x: number
  readonly y: number
}

/**
 * Reads the logical line containing `bufferLineNumber` (1-based), joining
 * wrapped continuation lines. Returns `undefined` when the line is missing.
 */
function collectLogicalLine(term: Terminal, bufferLineNumber: number): WindowedLine | undefined {
  const buffer = term.buffer.active
  let first = bufferLineNumber - 1
  if (first < 0) return undefined
  while (first > 0) {
    const line = buffer.getLine(first)
    if (line === undefined || !line.isWrapped) break
    first--
  }
  const lines: Segment[] = []
  let text = ''
  for (let y = first; y < buffer.length; y++) {
    const line = buffer.getLine(y)
    if (line === undefined) break
    if (lines.length > 0 && !line.isWrapped) break
    // Text AND columns come from the cells: a wide (CJK, emoji) character takes two columns, so "offset + 1" is not a column.
    const read = readLineText(line)
    lines.push({ y: y + 1, start: text.length, length: read.text.length, startCells: read.startCells, endCells: read.endCells })
    text += read.text
  }
  if (lines.length === 0) return undefined
  return { text, lines }
}

/** Maps a character offset in the logical text back to a 1-based cell: where it starts, or where it ends (`last`). */
function locate(offset: number, lines: readonly Segment[], last: boolean): Position | null {
  for (const segment of lines) {
    if (offset < segment.start + segment.length) {
      const index = offset - segment.start
      const x = (last ? segment.endCells[index] : segment.startCells[index]) ?? index + 1
      return { x, y: segment.y }
    }
  }
  return null
}

function toRange(candidate: LinkCandidate, lines: readonly Segment[]): IBufferRange | null {
  const start = locate(candidate.start, lines, false)
  const end = locate(candidate.end - 1, lines, true)
  if (start === null || end === null) return null
  return { start, end }
}

function buildLinks(
  term: Terminal,
  candidates: readonly LinkCandidate[],
  lines: readonly Segment[],
  cache: LinkCache,
  sessionId: Id
): ILink[] {
  const links: ILink[] = []
  for (const candidate of candidates) {
    const link = cache.get(candidate.text)
    if (link === undefined || link === null) continue
    const range = toRange(candidate, lines)
    if (range === null) continue
    // D76: the right-click menu acts on the link under the pointer, so the provider records it (and clears it on
    // leave) while xterm tracks the hover. `text` stays exactly as shown; main re-resolves it on every action.
    const hoveredLink: HoveredLink = { sessionId, text: candidate.text, link }
    links.push({
      range,
      text: candidate.text,
      decorations: { underline: true, pointerCursor: true },
      hover: (): void => setHoveredLink(term, hoveredLink),
      leave: (): void => clearHoveredLink(term, hoveredLink),
      activate: (event: MouseEvent, text: string): void => {
        const action = decideLinkClick(link, event)
        // D73: the viewer lives in the side panel of this window; with no listener (no workspace) keep
        // the old behaviour instead of swallowing the click.
        if (action === 'view' && requestFileView({ sessionId, text })) return
        void window.api
          .openLink(sessionId, text, action === 'reveal')
          .then((result) => {
            if (!result.ok) {
              console.error('SessionDeck: opening the link failed', result.error)
            }
          })
          .catch((error: unknown) => {
            console.error('SessionDeck: opening the link failed', error)
          })
      }
    })
  }
  return links
}

/**
 * Registers a link provider on `term` that detects URLs, files and folders in
 * the visible line and confirms them with the main process (batched, cached).
 * A click then follows `decideLinkClick` (D73): Shift+click reveals a file in
 * Explorer, Ctrl/Meta+click opens it with the default app, a plain click on a
 * viewable file goes to the side-panel Preview tab, and everything else opens
 * as before.
 */
export function registerLinkProvider(term: Terminal, sessionId: Id): IDisposable {
  const cache = createLinkCache()

  function resolveAndBuild(
    plain: readonly LinkCandidate[],
    groups: readonly SpacedGroup[],
    lines: readonly Segment[],
    callback: (links: ILink[] | undefined) => void
  ): void {
    // D75: plain candidates first, then the spaced-path alternatives (longest first), so the
    // batch stays inside the main-process limit even on a very long line.
    const uncached: string[] = []
    for (const text of collectResolveTexts(plain, groups)) {
      if (!cache.has(text) && !uncached.includes(text)) {
        uncached.push(text)
      }
    }
    const finish = (): void => {
      const chosen = chooseLinks(plain, groups, (text) => cache.get(text))
      const links = buildLinks(term, chosen, lines, cache, sessionId)
      callback(links.length > 0 ? links : undefined)
    }
    if (uncached.length === 0) {
      finish()
      return
    }
    window.api
      .resolveLinks(sessionId, uncached)
      .then((resolved) => {
        resolved.forEach((value, index) => {
          cache.set(uncached[index], value ?? null)
        })
        finish()
      })
      .catch((error: unknown) => {
        console.error('SessionDeck: resolving terminal links failed', error)
        finish()
      })
  }

  const provider: ILinkProvider = {
    provideLinks(bufferLineNumber, callback): void {
      if (typeof window === 'undefined' || typeof window.api?.resolveLinks !== 'function') {
        callback(undefined)
        return
      }
      const windowed = collectLogicalLine(term, bufferLineNumber)
      if (windowed === undefined) {
        callback(undefined)
        return
      }
      const candidates = detectLinkCandidates(windowed.text)
      // D75: unquoted paths with spaces are verified on disk as alternatives of the plain
      // fragments; the hint keeps the extra work off lines that cannot contain one.
      const groups = hasSpacedPathHint(windowed.text)
        ? detectSpacedPathGroups(windowed.text)
        : []
      if (candidates.length === 0 && groups.length === 0) {
        callback(undefined)
        return
      }
      resolveAndBuild(candidates, groups, windowed.lines, callback)
    }
  }

  return term.registerLinkProvider(provider)
}
