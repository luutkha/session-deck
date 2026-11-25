import { SESSION_TAG_MAX_LENGTH, SESSION_TAGS_MAX } from '../../shared/types'

/** Chip hues are spread over the full colour wheel; text stays readable on light and dark themes. */
const HUE_COUNT = 360
const CHIP_BACKGROUND_ALPHA = 0.18
const CHIP_BACKGROUND_LIGHTNESS = 50
const CHIP_TEXT_LIGHTNESS = 60

export interface TagCount {
  readonly tag: string
  readonly count: number
}

export interface TagChipStyle {
  readonly backgroundColor: string
  readonly color: string
}

/** Shared tag normalization: trim, collapse inner whitespace and strip one leading '#'. */
function cleanTag(text: string): string {
  return text.trim().replace(/\s+/g, ' ').replace(/^#/, '').trim()
}

/** Splits free-form input on commas/newlines into cleaned, non-empty tags. */
export function parseTagInput(text: string): string[] {
  return text
    .split(/[,\n\r]+/)
    .map(cleanTag)
    .filter((tag) => tag !== '')
}

/**
 * Appends one cleaned tag. Empty, duplicate (case-insensitively), over-long and over-cap tags are
 * ignored; the original array is returned unchanged in every no-op case. Nothing is truncated.
 */
export function addTag(tags: readonly string[], text: string): readonly string[] {
  const tag = cleanTag(text)
  if (tag === '' || tag.length > SESSION_TAG_MAX_LENGTH || tags.length >= SESSION_TAGS_MAX) return tags
  if (tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) return tags
  return [...tags, tag]
}

/** Removes a tag case-insensitively; returns the same array when nothing matched. */
export function removeTag(tags: readonly string[], tag: string): readonly string[] {
  const key = cleanTag(tag).toLowerCase()
  const next = tags.filter((existing) => existing.toLowerCase() !== key)
  return next.length === tags.length ? tags : next
}

/** Stable 0..359 hue from the tag text so a tag always gets the same colour. */
export function tagHue(tag: string): number {
  let hash = 0
  for (let index = 0; index < tag.length; index += 1) {
    hash = (hash * 31 + tag.charCodeAt(index)) % HUE_COUNT
  }
  return hash
}

/** Low-alpha fill plus mid-lightness text works on both the light and dark themes. */
export function tagChipStyle(tag: string): TagChipStyle {
  const hue = tagHue(tag)
  return {
    backgroundColor: `hsl(${hue} 70% ${CHIP_BACKGROUND_LIGHTNESS}% / ${CHIP_BACKGROUND_ALPHA})`,
    color: `hsl(${hue} 75% ${CHIP_TEXT_LIGHTNESS}%)`
  }
}

/** Tags across sessions, merged case-insensitively (first spelling kept), by count desc then name. */
export function allTags(sessions: readonly { tags?: readonly string[] }[]): readonly TagCount[] {
  const counts = new Map<string, TagCount>()
  for (const session of sessions) {
    for (const tag of session.tags ?? []) {
      const key = tag.toLowerCase()
      const found = counts.get(key)
      if (found) {
        counts.set(key, { tag: found.tag, count: found.count + 1 })
      } else {
        counts.set(key, { tag, count: 1 })
      }
    }
  }
  return [...counts.values()].sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count
    const left = a.tag.toLowerCase()
    const right = b.tag.toLowerCase()
    return left < right ? -1 : left > right ? 1 : 0
  })
}

/** True when every selected tag is present on the session (case-insensitive). */
export function matchesTagFilter(session: { tags?: readonly string[] }, selected: readonly string[]): boolean {
  if (selected.length === 0) return true
  const present = new Set((session.tags ?? []).map((tag) => tag.toLowerCase()))
  return selected.every((tag) => present.has(tag.toLowerCase()))
}

/** True when the cleaned query is a case-insensitive substring of any tag. */
export function tagsMatchQuery(session: { tags?: readonly string[] }, query: string): boolean {
  const needle = cleanTag(query).toLowerCase()
  if (needle === '') return false
  return (session.tags ?? []).some((tag) => tag.toLowerCase().includes(needle))
}
