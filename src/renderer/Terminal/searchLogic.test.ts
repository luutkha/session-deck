import { decideSearchKey, isSearchShortcut, matchLabel } from './searchLogic'

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
    expect(matchLabel('needle', -1, 1000)).toBe('1000 matches')
  })
})
