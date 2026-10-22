import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_SETTINGS, type StoreData } from '../../shared/types'
import {
  readContinueOnWake,
  sleepIdleSessions,
  wakeSessions,
  type QuotaActionApi
} from './quotaActions'

function fakeApi(overrides: Partial<QuotaActionApi> = {}): QuotaActionApi {
  return {
    quotaSleepIdle: vi.fn(async (): Promise<readonly string[]> => ['a', 'b']),
    quotaWake: vi.fn(async (): Promise<readonly string[]> => ['a']),
    getStore: vi.fn(async () => ({ data: storeWith(false) })),
    ...overrides
  }
}

function storeWith(continueOnWake: boolean): StoreData {
  return {
    version: 1,
    sessions: [],
    groups: [],
    statuses: [],
    groupOrder: [],
    settings: { ...DEFAULT_APP_SETTINGS, quota: { ...DEFAULT_APP_SETTINGS.quota, continueOnWake } }
  }
}

describe('quota actions', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sleepIdleSessions returns the slept ids on success', async () => {
    const api = fakeApi()
    expect(await sleepIdleSessions(api)).toEqual({ ok: true, ids: ['a', 'b'] })
    expect(api.quotaSleepIdle).toHaveBeenCalledTimes(1)
  })

  it('sleepIdleSessions reports a rejected call in the error text and logs it', async () => {
    const api = fakeApi({ quotaSleepIdle: vi.fn(async (): Promise<readonly string[]> => { throw new Error('boom') }) })
    expect(await sleepIdleSessions(api)).toEqual({ ok: false, message: 'Could not sleep sessions: boom' })
    expect(console.error).toHaveBeenCalled()
  })

  it('sleepIdleSessions turns a missing API method into an error result instead of throwing', async () => {
    const api = {} as unknown as QuotaActionApi
    const result = await sleepIdleSessions(api)
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ message: expect.stringContaining('Could not sleep sessions: ') })
  })

  it('wakeSessions passes sendContinue through and returns the woken ids', async () => {
    const api = fakeApi()
    expect(await wakeSessions(api, true)).toEqual({ ok: true, ids: ['a'] })
    expect(api.quotaWake).toHaveBeenCalledWith({ sendContinue: true })
  })

  it('wakeSessions reports a rejected call in the error text and logs it', async () => {
    const api = fakeApi({ quotaWake: vi.fn(async (): Promise<readonly string[]> => { throw 'plain text' }) })
    expect(await wakeSessions(api, false)).toEqual({ ok: false, message: 'Could not wake sessions: plain text' })
    expect(console.error).toHaveBeenCalled()
  })

  it('treats a non-array answer as no sessions', async () => {
    const api = fakeApi({ quotaSleepIdle: vi.fn(async () => undefined as unknown as readonly string[]) })
    expect(await sleepIdleSessions(api)).toEqual({ ok: true, ids: [] })
  })

  it('readContinueOnWake returns the saved setting', async () => {
    expect(await readContinueOnWake(fakeApi({ getStore: vi.fn(async () => ({ data: storeWith(true) })) }))).toBe(true)
  })

  it('readContinueOnWake falls back to false and logs when the store cannot be read', async () => {
    const api = fakeApi({ getStore: vi.fn(async (): Promise<never> => { throw new Error('no store') }) })
    expect(await readContinueOnWake(api)).toBe(false)
    expect(console.error).toHaveBeenCalled()
  })

  it('readContinueOnWake uses the default (false) when settings are absent', async () => {
    const data: StoreData = { version: 1, sessions: [], groups: [], statuses: [], groupOrder: [] }
    expect(await readContinueOnWake(fakeApi({ getStore: vi.fn(async () => ({ data })) }))).toBe(false)
  })
})
