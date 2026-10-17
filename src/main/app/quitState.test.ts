import { describe, it, expect } from 'vitest'
import { isQuitting, markQuitting } from './quitState'

describe('quitState', () => {
  it('is not quitting by default and stays set once marked', () => {
    expect(isQuitting()).toBe(false)
    markQuitting()
    expect(isQuitting()).toBe(true)
    markQuitting()
    expect(isQuitting()).toBe(true)
  })
})
