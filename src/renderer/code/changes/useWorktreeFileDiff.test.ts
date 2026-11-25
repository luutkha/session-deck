import { describe, expect, it } from 'vitest'
import { shouldRefreshOnFocus } from './useWorktreeFileDiff'

describe('shouldRefreshOnFocus', () => {
  it('refreshes the open diff when the window has not just been refreshed', () => {
    expect(shouldRefreshOnFocus(1_000, 0)).toBe(true)
    expect(shouldRefreshOnFocus(1_250, 1_000)).toBe(true)
  })

  it('ignores the second event of a focus/visibilitychange pair', () => {
    expect(shouldRefreshOnFocus(1_001, 1_000)).toBe(false)
    expect(shouldRefreshOnFocus(1_249, 1_000)).toBe(false)
  })
})
