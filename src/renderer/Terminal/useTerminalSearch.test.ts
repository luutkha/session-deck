import { describe, expect, it } from 'vitest'
import { shouldRunSearch } from './useTerminalSearch'

describe('shouldRunSearch', () => {
  it('searches a new query, including the first one', () => {
    expect(shouldRunSearch(null, 'needle')).toBe(true)
    expect(shouldRunSearch('old', 'needle')).toBe(true)
  })

  it('does not re-search an unchanged query when output arrives', () => {
    expect(shouldRunSearch('needle', 'needle')).toBe(false)
  })

  it('does not search an empty query and re-searches after a clear', () => {
    expect(shouldRunSearch(null, '')).toBe(false)
    expect(shouldRunSearch('needle', '')).toBe(false)
    expect(shouldRunSearch('needle', 'needle2')).toBe(true)
  })
})
