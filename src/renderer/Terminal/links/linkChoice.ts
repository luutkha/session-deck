/**
 * Chooses the final link candidates of one line (D75): plain detections plus the spaced-path
 * alternatives that main confirmed on disk. The longest resolving alternative of a group wins
 * and suppresses every candidate whose range overlaps it.
 */
import type { ResolvedLink } from '../../../shared/types'
import type { LinkCandidate } from './detectLinks'
import type { SpacedGroup } from './spacedPaths'

/** Mirrors `MAX_LINK_TEXTS` in `src/main/links/LinkService.ts`; a larger batch is rejected there. */
export const MAX_RESOLVE_TEXTS = 200

/** `null`/`undefined` both mean "not a link" (failed, not cached, or past the batch cap). */
export type LinkResolution = (text: string) => ResolvedLink | null | undefined

function overlaps(a: LinkCandidate, b: LinkCandidate): boolean {
  return a.start < b.end && b.start < a.end
}

/**
 * Returns the plain candidates minus those suppressed by a group winner, plus the winners.
 * Groups are handled left to right; an alternative that overlaps an earlier winner is skipped,
 * so two groups never produce overlapping links.
 */
export function chooseLinks(
  plain: readonly LinkCandidate[],
  groups: readonly SpacedGroup[],
  resolve: LinkResolution
): readonly LinkCandidate[] {
  const winners: LinkCandidate[] = []
  for (const group of groups) {
    for (const alternative of group.alternatives) {
      if (winners.some((winner) => overlaps(alternative, winner))) continue
      const resolved = resolve(alternative.text)
      if (resolved === null || resolved === undefined) continue
      winners.push(alternative)
      break
    }
  }
  if (winners.length === 0) return plain
  const kept = plain.filter((candidate) => !winners.some((winner) => overlaps(candidate, winner)))
  return [...kept, ...winners].sort((a, b) => a.start - b.start || a.end - b.end)
}

/**
 * Texts to resolve in one batch: plain candidates first, then group alternatives (already
 * longest first), deduplicated and capped so the call stays inside the main-process limit.
 */
export function collectResolveTexts(
  plain: readonly LinkCandidate[],
  groups: readonly SpacedGroup[],
  limit = MAX_RESOLVE_TEXTS
): readonly string[] {
  const texts: string[] = []
  const add = (text: string): void => {
    if (texts.length < limit && !texts.includes(text)) texts.push(text)
  }
  for (const candidate of plain) add(candidate.text)
  for (const group of groups) {
    for (const alternative of group.alternatives) add(alternative.text)
  }
  return texts
}
