import { describe, it, expect, beforeEach } from 'vitest'
import { createNotifier, type Notifier } from './Notifier'

describe('Notifier', () => {
  let notifier: Notifier
  let beepCalls: number
  let beepArgs: Array<{ id: string; reason: string }>
  let flashCalls: boolean[]
  let windowFocused: boolean
  let time: number

  beforeEach(() => {
    beepCalls = 0
    beepArgs = []
    flashCalls = []
    windowFocused = false
    time = 1000

    notifier = createNotifier({
      beep: (id, reason) => {
        beepCalls++
        beepArgs.push({ id, reason })
      },
      flash: (on) => { flashCalls.push(on) },
      isWindowFocused: () => windowFocused,
      minGapMs: 1500,
      now: () => time
    })
  })

  it('passes the session id and reason to beep', () => {
    notifier.notify('session-7', 'done')
    expect(beepArgs).toEqual([{ id: 'session-7', reason: 'done' }])
  })

  it('does not call beep when debounced, so the renderer gets no extra event', () => {
    notifier.notify('session-1', 'permission')
    time += 100
    notifier.notify('session-2', 'idle')
    expect(beepArgs).toEqual([{ id: 'session-1', reason: 'permission' }])
  })

  it('beeps on notify when sound enabled', () => {
    notifier.notify('session-1', 'permission')
    expect(beepCalls).toBe(1)
  })

  it('does not beep when sound disabled', () => {
    notifier.setSoundEnabled(false)
    notifier.notify('session-1', 'permission')
    expect(beepCalls).toBe(0)
  })

  it('debounces sound by minGapMs', () => {
    notifier.notify('session-1', 'permission')
    expect(beepCalls).toBe(1)

    time += 1000 // less than minGapMs
    notifier.notify('session-1', 'done')
    expect(beepCalls).toBe(1)

    time += 600 // total 1600 > 1500
    notifier.notify('session-1', 'idle')
    expect(beepCalls).toBe(2)
  })

  it('flashes when window not focused', () => {
    windowFocused = false
    notifier.notify('session-1', 'permission')
    expect(flashCalls).toEqual([true])
  })

  it('does not flash when window focused', () => {
    windowFocused = true
    notifier.notify('session-1', 'permission')
    expect(flashCalls).toHaveLength(0)
  })

  it('does not flash again if already flashing', () => {
    windowFocused = false
    notifier.notify('session-1', 'permission')
    notifier.notify('session-1', 'done')
    expect(flashCalls).toEqual([true]) // only first notify triggers flash
  })

  it('stopFlash turns off flash', () => {
    windowFocused = false
    notifier.notify('session-1', 'permission')
    expect(flashCalls).toEqual([true])

    notifier.stopFlash()
    expect(flashCalls).toEqual([true, false])
  })

  it('stopFlash is idempotent', () => {
    notifier.stopFlash()
    notifier.stopFlash()
    expect(flashCalls).toHaveLength(0)
  })

  it('setSoundEnabled toggles sound', () => {
    notifier.notify('session-1', 'permission')
    expect(beepCalls).toBe(1)

    notifier.setSoundEnabled(false)
    time += 2000
    notifier.notify('session-1', 'done')
    expect(beepCalls).toBe(1)

    notifier.setSoundEnabled(true)
    time += 2000
    notifier.notify('session-1', 'idle')
    expect(beepCalls).toBe(2)
  })

  it('sound debounce resets after minGapMs even across reasons', () => {
    notifier.notify('session-1', 'permission')
    expect(beepCalls).toBe(1)

    time += 1400
    notifier.notify('session-1', 'done')
    expect(beepCalls).toBe(1)

    time += 200
    notifier.notify('session-1', 'idle')
    expect(beepCalls).toBe(2)
  })

  it('flash only depends on window focus, not sound', () => {
    notifier.setSoundEnabled(false)
    windowFocused = false
    notifier.notify('session-1', 'permission')
    expect(flashCalls).toEqual([true])
    expect(beepCalls).toBe(0)
  })
})