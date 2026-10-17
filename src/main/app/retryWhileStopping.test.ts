import { describe, expect, it, vi } from 'vitest'
import { retryWhileStopping, STOPPING_ERROR_PREFIX } from './retryWhileStopping'

const noSleep = (): Promise<void> => Promise.resolve()

describe('retryWhileStopping', () => {
  it('returns immediately when the action succeeds', async () => {
    const action = vi.fn()
    await retryWhileStopping(action, { sleep: noSleep })
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('retries while the process is still stopping, then succeeds', async () => {
    const action = vi
      .fn()
      .mockImplementationOnce(() => { throw new Error(`${STOPPING_ERROR_PREFIX}: abc`) })
      .mockImplementationOnce(() => { throw new Error(`${STOPPING_ERROR_PREFIX}: abc`) })
      .mockImplementation(() => undefined)
    const sleep = vi.fn(noSleep)
    await retryWhileStopping(action, { sleep, delayMs: 10 })
    expect(action).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(10)
  })

  it('rethrows any other error at once without retrying', async () => {
    const action = vi.fn(() => { throw new Error('Directory not found: C:\\x') })
    await expect(retryWhileStopping(action, { sleep: noSleep })).rejects.toThrow('Directory not found')
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('gives up after the last attempt and surfaces the stopping error', async () => {
    const action = vi.fn(() => { throw new Error(`${STOPPING_ERROR_PREFIX}: abc`) })
    await expect(retryWhileStopping(action, { attempts: 3, sleep: noSleep })).rejects.toThrow(STOPPING_ERROR_PREFIX)
    expect(action).toHaveBeenCalledTimes(3)
  })

  it('does not retry non-Error throws', async () => {
    const action = vi.fn(() => { throw 'boom' })
    await expect(retryWhileStopping(action, { sleep: noSleep })).rejects.toBe('boom')
    expect(action).toHaveBeenCalledTimes(1)
  })
})
