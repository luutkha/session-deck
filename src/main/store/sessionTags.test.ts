import { describe, expect, it } from 'vitest'
import type { Session, StoreData } from '../../shared/types'
import { SESSION_TAG_MAX_LENGTH, SESSION_TAGS_MAX } from '../../shared/types'
import { emptyStore } from './reducers'
import { normalizeTags, setSessionTags } from './sessionTags'

function session(id: string, extra: Partial<Session> = {}): Session {
  return {
    id,
    name: id,
    cwd: '/x',
    groupId: null,
    statusId: null,
    order: 0,
    createdAt: 1,
    claudeArgs: [],
    ...extra
  }
}

function storeWith(...sessions: Session[]): StoreData {
  return { ...emptyStore(), sessions }
}

function tagsOfCount(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `tag${index}`)
}

describe('normalizeTags', () => {
  it('accepts an empty array', () => {
    expect(normalizeTags([])).toEqual([])
  })

  it('trims, collapses inner whitespace and removes a leading hash', () => {
    expect(normalizeTags(['  #hello   world  ', '# alpha', '##beta', 'a\tb\nc'])).toEqual([
      'hello world',
      'alpha',
      '#beta',
      'a b c'
    ])
  })

  it('keeps the given order', () => {
    expect(normalizeTags(['zulu', 'alpha', 'mike'])).toEqual(['zulu', 'alpha', 'mike'])
  })

  it('drops empty and whitespace-only tags, including a bare hash', () => {
    expect(normalizeTags(['', '   ', '#', '#   ', 'ok'])).toEqual(['ok'])
  })

  it('deduplicates case-insensitively, keeping the first spelling', () => {
    expect(normalizeTags(['Work', 'work', 'WORK', 'other'])).toEqual(['Work', 'other'])
  })

  it('accepts a tag of exactly 24 characters', () => {
    const tag = 'a'.repeat(SESSION_TAG_MAX_LENGTH)
    expect(normalizeTags([tag])).toEqual([tag])
  })

  it('rejects a tag longer than 24 characters, quoting the cleaned tag', () => {
    const tag = 'a'.repeat(SESSION_TAG_MAX_LENGTH + 1)
    expect(() => normalizeTags([tag])).toThrow(
      `Invalid tags: "${tag}" is longer than ${SESSION_TAG_MAX_LENGTH} characters`
    )
    expect(() => normalizeTags([' #' + tag + ' '])).toThrow(
      `Invalid tags: "${tag}" is longer than ${SESSION_TAG_MAX_LENGTH} characters`
    )
  })

  it('accepts exactly 10 tags and rejects 11', () => {
    expect(normalizeTags(tagsOfCount(SESSION_TAGS_MAX))).toHaveLength(SESSION_TAGS_MAX)
    expect(() => normalizeTags(tagsOfCount(SESSION_TAGS_MAX + 1))).toThrow(
      `Invalid tags: at most ${SESSION_TAGS_MAX} tags`
    )
  })

  it('counts distinct tags after dedupe, not raw entries', () => {
    const raw = [...tagsOfCount(SESSION_TAGS_MAX), 'TAG0', '']
    expect(normalizeTags(raw)).toHaveLength(SESSION_TAGS_MAX)
  })

  it.each([null, undefined, 'tag', {}, 42, ['tag', 7], ['tag', null]])('rejects non-string-array input %j', (raw) => {
    expect(() => normalizeTags(raw)).toThrow('Invalid tags: must be an array of strings')
  })
})

describe('setSessionTags', () => {
  it('sets tags immutably', () => {
    const before = storeWith(session('s1'))
    const after = setSessionTags(before, 's1', [' #Work ', 'work', 'home'])
    expect(after).not.toBe(before)
    expect(after.sessions[0].tags).toEqual(['Work', 'home'])
    expect(before.sessions[0].tags).toBeUndefined()
  })

  it('replaces existing tags', () => {
    const data = storeWith(session('s1', { tags: ['old'] }))
    expect(setSessionTags(data, 's1', ['new']).sessions[0].tags).toEqual(['new'])
  })

  it('removes the field for an empty result', () => {
    const data = storeWith(session('s1', { tags: ['old'] }))
    expect(setSessionTags(data, 's1', []).sessions[0]).not.toHaveProperty('tags')
    expect(setSessionTags(data, 's1', ['', '#']).sessions[0]).not.toHaveProperty('tags')
  })

  it('throws for an unknown session', () => {
    expect(() => setSessionTags(storeWith(session('s1')), 'nope', ['x'])).toThrow('Unknown session: nope')
  })

  it('throws for invalid tags without changing the original data', () => {
    const data = storeWith(session('s1', { tags: ['old'] }))
    expect(() => setSessionTags(data, 's1', ['x'.repeat(25)])).toThrow('Invalid tags')
    expect(data.sessions[0].tags).toEqual(['old'])
  })

  it('leaves other sessions untouched (same references)', () => {
    const other = session('s2', { tags: ['keep'] })
    const data = storeWith(session('s1'), other)
    const after = setSessionTags(data, 's1', ['x'])
    expect(after.sessions[1]).toBe(other)
  })
})
