import { describe, expect, it } from 'vitest'
import { SESSION_TAG_MAX_LENGTH, SESSION_TAGS_MAX } from '../../shared/types'
import {
  addTag,
  allTags,
  matchesTagFilter,
  parseTagInput,
  removeTag,
  tagChipStyle,
  tagHue,
  tagsMatchQuery
} from './tagLogic'

describe('parseTagInput', () => {
  it('splits on commas and newlines, trims and strips a leading hash', () => {
    expect(parseTagInput('one, #two\n three,\rfour')).toEqual(['one', 'two', 'three', 'four'])
  })

  it('returns an empty array for empty or separator-only input', () => {
    expect(parseTagInput('')).toEqual([])
    expect(parseTagInput(' , \n # , ')).toEqual([])
  })

  it('collapses inner whitespace like the main-side normalizer', () => {
    expect(parseTagInput('  hello   world  ')).toEqual(['hello world'])
  })
})

describe('addTag', () => {
  it('appends a cleaned tag immutably', () => {
    const tags = ['one']
    const next = addTag(tags, '  #Two Words  ')
    expect(next).toEqual(['one', 'Two Words'])
    expect(next).not.toBe(tags)
    expect(tags).toEqual(['one'])
  })

  it('ignores empty tags without copying the array', () => {
    const tags = ['one']
    expect(addTag(tags, '')).toBe(tags)
    expect(addTag(tags, '  #  ')).toBe(tags)
  })

  it('ignores duplicates case-insensitively', () => {
    const tags = ['Work', 'home']
    expect(addTag(tags, 'work')).toBe(tags)
    expect(addTag(tags, '# WORK')).toBe(tags)
  })

  it('accepts exactly 24 characters and ignores 25 without truncating', () => {
    const atLimit = 'a'.repeat(SESSION_TAG_MAX_LENGTH)
    expect(addTag([], atLimit)).toEqual([atLimit])
    const tooLong = 'b'.repeat(SESSION_TAG_MAX_LENGTH + 1)
    const tags = ['one']
    expect(addTag(tags, tooLong)).toBe(tags)
    expect(addTag([], tooLong)).toEqual([])
  })

  it('ignores a tag when the list is already at the cap', () => {
    const tags = Array.from({ length: SESSION_TAGS_MAX }, (_, index) => `tag${index}`)
    expect(addTag(tags, 'extra')).toBe(tags)
    expect(addTag(tags.slice(0, SESSION_TAGS_MAX - 1), 'extra')).toHaveLength(SESSION_TAGS_MAX)
  })
})

describe('removeTag', () => {
  it('removes a tag case-insensitively, including all copies', () => {
    expect(removeTag(['Work', 'home', 'WORK'], 'work')).toEqual(['home'])
  })

  it('returns the same array when nothing matched', () => {
    const tags = ['Work']
    expect(removeTag(tags, 'home')).toBe(tags)
    expect(removeTag([], 'home')).toEqual([])
  })
})

describe('tagHue / tagChipStyle', () => {
  it('returns a stable integer in 0..359 across calls', () => {
    const first = tagHue('work')
    expect(first).toBe(tagHue('work'))
    expect(first).toBe(tagHue('work'))
    expect(Number.isInteger(first)).toBe(true)
    expect(first).toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThan(360)
    expect(tagHue('')).toBe(0)
  })

  it('gives different tags different hues', () => {
    expect(tagHue('alpha')).not.toBe(tagHue('beta'))
  })

  it('builds an hsl style with a low-alpha fill and matching text hue', () => {
    const style = tagChipStyle('work')
    const hue = tagHue('work')
    expect(style.backgroundColor).toContain(`hsl(${hue}`)
    expect(style.backgroundColor).toContain('/ 0.18)')
    expect(style.color).toContain(`hsl(${hue}`)
    expect(style.color).not.toContain('/')
    expect(tagChipStyle('work')).toEqual(style)
  })
})

describe('allTags', () => {
  it('returns an empty list when nothing is tagged', () => {
    expect(allTags([])).toEqual([])
    expect(allTags([{}, { tags: [] }])).toEqual([])
  })

  it('merges tags case-insensitively and keeps the first spelling', () => {
    expect(allTags([{ tags: ['Work'] }, { tags: ['work', 'WORK', 'home'] }])).toEqual([
      { tag: 'Work', count: 3 },
      { tag: 'home', count: 1 }
    ])
  })

  it('sorts by count desc, then by name case-insensitively', () => {
    const sessions = [{ tags: ['b', 'a', 'c', 'B'] }, { tags: ['a', 'C'] }, { tags: ['c'] }]
    expect(allTags(sessions)).toEqual([
      { tag: 'c', count: 3 },
      { tag: 'a', count: 2 },
      { tag: 'b', count: 2 }
    ])
  })
})

describe('matchesTagFilter', () => {
  it('matches everything for an empty selection', () => {
    expect(matchesTagFilter({}, [])).toBe(true)
    expect(matchesTagFilter({ tags: ['work'] }, [])).toBe(true)
  })

  it('requires every selected tag, case-insensitively', () => {
    const session = { tags: ['Work', 'Home'] }
    expect(matchesTagFilter(session, ['work'])).toBe(true)
    expect(matchesTagFilter(session, ['WORK', 'home'])).toBe(true)
    expect(matchesTagFilter(session, ['work', 'missing'])).toBe(false)
    expect(matchesTagFilter({}, ['work'])).toBe(false)
  })
})

describe('tagsMatchQuery', () => {
  it('matches a case-insensitive substring of any tag', () => {
    const session = { tags: ['Work stuff', 'home'] }
    expect(tagsMatchQuery(session, 'WORK')).toBe(true)
    expect(tagsMatchQuery(session, 'stuff')).toBe(true)
    expect(tagsMatchQuery(session, 'missing')).toBe(false)
  })

  it('trims and strips a leading hash from the query', () => {
    expect(tagsMatchQuery({ tags: ['work'] }, '  #Work  ')).toBe(true)
  })

  it('returns false for an empty query or an untagged session', () => {
    expect(tagsMatchQuery({ tags: ['work'] }, '')).toBe(false)
    expect(tagsMatchQuery({ tags: ['work'] }, ' # ')).toBe(false)
    expect(tagsMatchQuery({}, 'work')).toBe(false)
  })
})
