import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scheduleDebouncedValue } from './useDebouncedValue'

describe('scheduleDebouncedValue', () => {
  beforeEach((): void => { vi.useFakeTimers() })
  afterEach((): void => { vi.useRealTimers() })

  it('applies the value only after the quiet period', (): void => {
    const seen: string[] = []
    scheduleDebouncedValue('query', 120, (value): void => { seen.push(value) })
    vi.advanceTimersByTime(119)
    expect(seen).toEqual([])
    vi.advanceTimersByTime(1)
    expect(seen).toEqual(['query'])
  })

  it('cancels a pending value so a newer change wins', (): void => {
    const seen: string[] = []
    const cancelOld = scheduleDebouncedValue('old', 120, (value): void => { seen.push(value) })
    cancelOld()
    scheduleDebouncedValue('new', 120, (value): void => { seen.push(value) })
    vi.advanceTimersByTime(120)
    expect(seen).toEqual(['new'])
  })

  it('restarts the delay when a change arrives before the deadline', (): void => {
    const seen: string[] = []
    const cancel = scheduleDebouncedValue('first', 120, (value): void => { seen.push(value) })
    vi.advanceTimersByTime(100)
    cancel()
    scheduleDebouncedValue('second', 120, (value): void => { seen.push(value) })
    vi.advanceTimersByTime(100)
    expect(seen).toEqual([])
    vi.advanceTimersByTime(20)
    expect(seen).toEqual(['second'])
  })
})
