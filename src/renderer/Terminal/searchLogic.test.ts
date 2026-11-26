import { decideSearchKey, isSearchShortcut, MATCH_COUNT_CAP, matchLabel } from './searchLogic'

describe('isSearchShortcut', () => {
  it('is Ctrl+Shift+F, with either letter case', () => {
    expect(isSearchShortcut({ key: 'F', ctrlKey: true, shiftKey: true })).toBe(true)
    expect(isSearchShortcut({ key: 'f', ctrlKey: true, shiftKey: true })).toBe(true)
  })

  it('leaves plain Ctrl+F and other Ctrl+Shift combos to the program', () => {
    expect(isSearchShortcut({ key: 'f', ctrlKey: true })).toBe(false)
    expect(isSearchShortcut({ key: 'k', ctrlKey: true, shiftKey: true })).toBe(false)
    expect(isSearchShortcut({ key: 'F', shiftKey: true })).toBe(false)
  })

  it('ignores Alt / Meta variants', () => {
    expect(isSearchShortcut({ key: 'F', ctrlKey: true, shiftKey: true, altKey: true })).toBe(false)
    expect(isSearchShortcut({ key: 'F', ctrlKey: true, shiftKey: true, metaKey: true })).toBe(false)
  })
})

describe('decideSearchKey', () => {
  it('closes on Escape', () => {
    expect(decideSearchKey({ key: 'Escape' })).toBe('close')
  })

  it('cycles forward on Enter and backward on Shift+Enter', () => {
    expect(decideSearchKey({ key: 'Enter' })).toBe('next')
    expect(decideSearchKey({ key: 'Enter', shiftKey: true })).toBe('previous')
  })

  it('leaves typing alone', () => {
    expect(decideSearchKey({ key: 'a' })).toBe('none')
    expect(decideSearchKey({ key: 'Tab' })).toBe('none')
  })
})

describe('matchLabel', () => {
  it('is empty without a query', () => {
    expect(matchLabel('', 0, 0)).toBe('')
  })

  it('says so when nothing matches', () => {
    expect(matchLabel('needle', 0, 0)).toBe('No matches')
  })

  it('shows the 1-based active match and the total', () => {
    expect(matchLabel('needle', 0, 6)).toBe('1/6')
    expect(matchLabel('needle', 2, 6)).toBe('3/6')
  })

  it('shows only the total when the highlight cap reports no active index', () => {
    expect(matchLabel('needle', -1, 6)).toBe('6 matches')
  })

  it('mirrors the addon highlight cap', () => {
    expect(MATCH_COUNT_CAP).toBe(200)
  })

  it('says 200+ instead of claiming the truncated count is the total', () => {
    expect(matchLabel('needle', -1, MATCH_COUNT_CAP)).toBe('200+ matches')
    expect(matchLabel('needle', 2, MATCH_COUNT_CAP)).toBe('3/200+')
    expect(matchLabel('needle', -1, MATCH_COUNT_CAP - 1)).toBe('199 matches')
  })

  it('honours a different cap passed by the caller', () => {
    expect(matchLabel('needle', -1, 50, 50)).toBe('50+ matches')
    expect(matchLabel('needle', 0, 49, 50)).toBe('1/49')
    expect(matchLabel('needle', 3, 50, 50)).toBe('4/50+')
  })
})
