import { describe, it, expect, vi } from 'vitest'
import { createUserPresence } from './userPresence'

const AWAY_MS = 15 * 60_000

function setup(awayAfterMs: number | null = AWAY_MS, start = 1_000_000) {
  const clock = { t: start }
  const onReturn = vi.fn()
  const onError = vi.fn()
  let awayValue = awayAfterMs
  const presence = createUserPresence({
    now: () => clock.t,
    getAwayAfterMs: () => awayValue,
    onReturn,
    onError
  })
  return {
    presence,
    onReturn,
    onError,
    clock,
    setAwayAfterMs: (value: number | null) => {
      awayValue = value
    }
  }
}

describe('createUserPresence', () => {
  it('starts with the last input at the time of creation', () => {
    const { presence } = setup(AWAY_MS, 5_000)
    expect(presence.lastInputAt()).toBe(5_000)
  })

  it('a quick input after the previous one does not report a return', () => {
    const { presence, onReturn, clock } = setup()
    clock.t += 60_000
    presence.noteInput()
    expect(onReturn).not.toHaveBeenCalled()
    expect(presence.lastInputAt()).toBe(1_000_000 + 60_000)
  })

  it('an input after a long gap reports the gap as [since, until]', () => {
    const { presence, onReturn, clock } = setup()
    clock.t += AWAY_MS + 5_000
    presence.noteInput()
    expect(onReturn).toHaveBeenCalledTimes(1)
    expect(onReturn).toHaveBeenCalledWith(1_000_000, 1_000_000 + AWAY_MS + 5_000)
  })

  it('exactly at the threshold counts as away', () => {
    const { presence, onReturn, clock } = setup()
    clock.t += AWAY_MS
    presence.noteInput()
    expect(onReturn).toHaveBeenCalledTimes(1)
    expect(onReturn).toHaveBeenCalledWith(1_000_000, 1_000_000 + AWAY_MS)
  })

  it('one millisecond short of the threshold does not count as away', () => {
    const { presence, onReturn, clock } = setup()
    clock.t += AWAY_MS - 1
    presence.noteInput()
    expect(onReturn).not.toHaveBeenCalled()
  })

  it('when the feature is off (null) onReturn is never called, but input is still recorded', () => {
    const { presence, onReturn, clock } = setup(null)
    clock.t += 10 * AWAY_MS
    presence.noteInput()
    expect(onReturn).not.toHaveBeenCalled()
    expect(presence.lastInputAt()).toBe(1_000_000 + 10 * AWAY_MS)
  })

  it('reads the threshold on each input, so a change in settings applies at once', () => {
    const { presence, onReturn, clock, setAwayAfterMs } = setup(null)
    clock.t += AWAY_MS
    presence.noteInput()
    expect(onReturn).not.toHaveBeenCalled()

    setAwayAfterMs(AWAY_MS)
    clock.t += AWAY_MS
    presence.noteInput()
    expect(onReturn).toHaveBeenCalledTimes(1)
  })

  it('each return starts a new gap measured from the previous input', () => {
    const { presence, onReturn, clock } = setup()
    clock.t += AWAY_MS
    presence.noteInput()
    clock.t += 1_000
    presence.noteInput()
    clock.t += AWAY_MS
    presence.noteInput()
    expect(onReturn).toHaveBeenCalledTimes(2)
    expect(onReturn.mock.calls[1]).toEqual([1_000_000 + AWAY_MS + 1_000, 1_000_000 + 2 * AWAY_MS + 1_000])
  })

  it('a failing onReturn is reported through onError and the input is still recorded', () => {
    const { presence, onReturn, onError, clock } = setup()
    const failure = new Error('boom')
    onReturn.mockImplementation(() => {
      throw failure
    })
    clock.t += AWAY_MS
    expect(() => presence.noteInput()).not.toThrow()
    expect(onError).toHaveBeenCalledWith('user presence', failure)
    expect(presence.lastInputAt()).toBe(1_000_000 + AWAY_MS)
  })

  it('a failing threshold read is reported through onError, not thrown', () => {
    const failure = new Error('settings gone')
    const onError = vi.fn()
    const presence = createUserPresence({
      now: () => 0,
      getAwayAfterMs: () => {
        throw failure
      },
      onReturn: vi.fn(),
      onError
    })
    expect(() => presence.noteInput()).not.toThrow()
    expect(onError).toHaveBeenCalledWith('user presence', failure)
  })
})
