import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AwaySummary } from '../../shared/types'
import { fetchLastAwaySummary, openAwayRow } from './awayState'

const SUMMARY: AwaySummary = {
  since: 0,
  until: 300_000,
  sessions: [
    {
      sessionId: 's1',
      name: 'API',
      finished: 1,
      needsYou: false,
      hitLimit: false,
      slept: false,
      costUsd: null,
      lastPrompt: 'Add tests',
      lastAt: 300_000
    }
  ],
  totals: { finished: 1, needsYou: 0, slept: 0, hitLimit: 0, costUsd: 0 }
}

describe('fetchLastAwaySummary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation((): void => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the summary main has kept', async () => {
    expect(await fetchLastAwaySummary((): Promise<AwaySummary | null> => Promise.resolve(SUMMARY))).toEqual(SUMMARY)
  })

  it('returns null when there was no summary in this app run', async () => {
    expect(await fetchLastAwaySummary((): Promise<AwaySummary | null> => Promise.resolve(null))).toBeNull()
  })

  it('returns null and logs when the call rejects', async () => {
    const result = await fetchLastAwaySummary((): Promise<AwaySummary | null> => Promise.reject(new Error('ipc')))
    expect(result).toBeNull()
    expect(console.error).toHaveBeenCalled()
  })

  it('returns null and logs when the call throws synchronously', async () => {
    const result = await fetchLastAwaySummary((): Promise<AwaySummary | null> => {
      throw new Error('no bridge')
    })
    expect(result).toBeNull()
    expect(console.error).toHaveBeenCalled()
  })
})

describe('openAwayRow', () => {
  it('opens the session before it closes the dialog', () => {
    const calls: string[] = []
    openAwayRow(
      's1',
      (id: string): void => {
        calls.push(`open:${id}`)
      },
      (): void => {
        calls.push('close')
      }
    )
    expect(calls).toEqual(['open:s1', 'close'])
  })
})
