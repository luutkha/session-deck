import type { Id, StoreData } from '../../shared/types'
import { SESSION_TAG_MAX_LENGTH, SESSION_TAGS_MAX } from '../../shared/types'
import { findSessionIndex } from './reducers'

/** Trims, collapses inner whitespace and drops a leading '#'; empty results are dropped by the caller. */
function cleanTag(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').replace(/^#/, '').trim()
}

/** Validates and normalizes tags; throws for bad input. Keeps the given order. */
export function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.some((tag) => typeof tag !== 'string')) {
    throw new Error('Invalid tags: must be an array of strings')
  }
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of raw as unknown[]) {
    const tag = cleanTag(item as string)
    if (tag === '') continue
    if (tag.length > SESSION_TAG_MAX_LENGTH) {
      throw new Error(`Invalid tags: "${tag}" is longer than ${SESSION_TAG_MAX_LENGTH} characters`)
    }
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(tag)
  }
  if (result.length > SESSION_TAGS_MAX) {
    throw new Error(`Invalid tags: at most ${SESSION_TAGS_MAX} tags`)
  }
  return result
}

/** Sets (or, for an empty list, removes) the session's tags. Unknown session throws. */
export function setSessionTags(data: StoreData, id: Id, tags: unknown): StoreData {
  const index = findSessionIndex(data, id)
  const normalized = normalizeTags(tags)
  const sessions = data.sessions.map((s, i) => {
    if (i !== index) return s
    const { tags: _tags, ...rest } = s
    return normalized.length === 0 ? rest : { ...rest, tags: normalized }
  })
  return { ...data, sessions }
}
