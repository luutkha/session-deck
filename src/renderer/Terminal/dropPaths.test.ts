import { describe, expect, it } from 'vitest'
import { formatDroppedPath, formatDroppedPaths } from './dropPaths'

describe('formatDroppedPath', () => {
  it('leaves a plain path unquoted', () => {
    expect(formatDroppedPath('C:\\Users\\me\\shot.png')).toBe('C:\\Users\\me\\shot.png')
  })
  it('quotes a path with spaces', () => {
    expect(formatDroppedPath('C:\\My Pictures\\a b.png')).toBe('"C:\\My Pictures\\a b.png"')
  })
  it('quotes shell-special characters and strips embedded quotes', () => {
    expect(formatDroppedPath('C:\\a&b.png')).toBe('"C:\\a&b.png"')
    expect(formatDroppedPath('C:\\a"b c.png')).toBe('"C:\\ab c.png"')
  })
})

describe('formatDroppedPaths', () => {
  it('joins several paths with spaces and a trailing space', () => {
    expect(formatDroppedPaths(['C:\\a.png', 'C:\\b c.png'])).toBe('C:\\a.png "C:\\b c.png" ')
  })
  it('returns empty text when no file has a path', () => {
    expect(formatDroppedPaths([])).toBe('')
    expect(formatDroppedPaths(['', '  '])).toBe('')
  })
})
