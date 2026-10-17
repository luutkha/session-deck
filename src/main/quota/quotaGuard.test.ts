import { describe, it, expect, vi } from 'vitest'
import type { AccountUsage, QuotaAlert, QuotaSettings, UsageState, UsageWindow } from '../../shared/types'
import {
  EMPTY_QUOTA_MARKER,
  emptyQuotaMarkers,
  evaluateQuota,
  createQuotaGuard,
  type QuotaMarkers,
  type QuotaGuardDeps
} from './quotaGuard'

const SETTINGS: QuotaSettings = { enabled: true, warnAtPercent: 80, criticalAtPercent: 95, notifyOnReset: true }
const NOW_SEC = 1_700_000_000
const R1 = NOW_SEC + 3600
const R2 = R1 + 18000

function win(percent: number, resetsAt: number | null = R1): UsageWindow {
  return { usedPercentage: percent, resetsAt }
}

function account(fiveHour: UsageWindow | null, sevenDay: UsageWindow | null = null): AccountUsage {
  return { fiveHour, sevenDay, updatedAt: 0 }
}

function run(
  acc: AccountUsage | null,
  markers: QuotaMarkers,
  settings: QuotaSettings = SETTINGS
): ReturnType<typeof evaluateQuota> {
  return evaluateQuota({ settings, account: acc, markers, nowSec: NOW_SEC })
}

describe('evaluateQuota', () => {
  it('starts with empty markers and no alerts when there is no account data', () => {
    const result = run(null, emptyQuotaMarkers())
    expect(result.alerts).toEqual([])
    expect(result.markers).toEqual(emptyQuotaMarkers())
  })

  it('fires one warn alert when the window passes the warn threshold', () => {
    const first = run(account(win(82)), emptyQuotaMarkers())
    expect(first.alerts).toEqual([{ window: 'fiveHour', kind: 'warn', percent: 82, resetsAt: R1 }])
    expect(first.markers.fiveHour).toEqual({ resetsAt: R1, level: 'warn', percent: 82 })
  })

  it('does not repeat the warn alert while the percent keeps rising in the same window', () => {
    const first = run(account(win(82)), emptyQuotaMarkers())
    const second = run(account(win(88)), first.markers)
    expect(second.alerts).toEqual([])
    expect(second.markers.fiveHour.level).toBe('warn')
    expect(second.markers.fiveHour.percent).toBe(88)
  })

  it('fires a critical alert after warn, once', () => {
    const warned = run(account(win(85)), emptyQuotaMarkers())
    const critical = run(account(win(96)), warned.markers)
    expect(critical.alerts).toEqual([{ window: 'fiveHour', kind: 'critical', percent: 96, resetsAt: R1 }])
    expect(critical.markers.fiveHour.level).toBe('critical')
    const again = run(account(win(99)), critical.markers)
    expect(again.alerts).toEqual([])
  })

  it('fires only the critical alert when the first observation is already critical', () => {
    const result = run(account(win(96)), emptyQuotaMarkers())
    expect(result.alerts).toEqual([{ window: 'fiveHour', kind: 'critical', percent: 96, resetsAt: R1 }])
    expect(result.markers.fiveHour.level).toBe('critical')
  })

  it('fires the warn alert on the first observation past the threshold (no persisted marker)', () => {
    const result = run(account(win(81)), emptyQuotaMarkers())
    expect(result.alerts).toHaveLength(1)
    expect(result.alerts[0]?.kind).toBe('warn')
  })

  it('does not alert below the warn threshold', () => {
    const result = run(account(win(79.9)), emptyQuotaMarkers())
    expect(result.alerts).toEqual([])
    expect(result.markers.fiveHour).toEqual({ resetsAt: R1, level: 'none', percent: 79.9 })
  })

  it('treats a new resetsAt as a new window: reset alert after an alerted window, then the new window restarts', () => {
    const warned = run(account(win(85)), emptyQuotaMarkers())
    const next = run(account(win(10, R2)), warned.markers)
    expect(next.alerts).toEqual([{ window: 'fiveHour', kind: 'reset', percent: 10, resetsAt: R2 }])
    expect(next.markers.fiveHour).toEqual({ resetsAt: R2, level: 'none', percent: 10 })
  })

  it('re-arms warn and critical in the new window', () => {
    const warned = run(account(win(85)), emptyQuotaMarkers())
    const next = run(account(win(85, R2)), warned.markers)
    expect(next.alerts.map((a) => a.kind)).toEqual(['reset', 'warn'])
    expect(next.markers.fiveHour.level).toBe('warn')
  })

  it('sends no reset alert when notifyOnReset is off, but still restarts the markers', () => {
    const settings: QuotaSettings = { ...SETTINGS, notifyOnReset: false }
    const warned = run(account(win(85)), emptyQuotaMarkers(), settings)
    const next = run(account(win(10, R2)), warned.markers, settings)
    expect(next.alerts).toEqual([])
    expect(next.markers.fiveHour).toEqual({ resetsAt: R2, level: 'none', percent: 10 })
  })

  it('does not send a reset alert for a quiet window (spam guard)', () => {
    const quiet = run(account(win(30)), emptyQuotaMarkers())
    const next = run(account(win(5, R2)), quiet.markers)
    expect(next.alerts).toEqual([])
    expect(next.markers.fiveHour).toEqual({ resetsAt: R2, level: 'none', percent: 5 })
  })

  it('a brand-new window with no earlier marker never sends a reset alert', () => {
    const result = run(account(win(20, R2)), emptyQuotaMarkers())
    expect(result.alerts).toEqual([])
  })

  it('sends a reset alert when the percent drops back below warn after a larger value (same resetsAt)', () => {
    const warned = run(account(win(85)), emptyQuotaMarkers())
    const dropped = run(account(win(40)), warned.markers)
    expect(dropped.alerts).toEqual([{ window: 'fiveHour', kind: 'reset', percent: 40, resetsAt: R1 }])
    expect(dropped.markers.fiveHour).toEqual({ resetsAt: R1, level: 'none', percent: 40 })
  })

  it('re-arms the warn alert after a drop below warn in the same window', () => {
    const warned = run(account(win(85)), emptyQuotaMarkers())
    const dropped = run(account(win(40)), warned.markers)
    const again = run(account(win(81)), dropped.markers)
    expect(again.alerts).toEqual([{ window: 'fiveHour', kind: 'warn', percent: 81, resetsAt: R1 }])
  })

  it('does not send a reset alert for a drop that stays at or above warn', () => {
    const warned = run(account(win(90)), emptyQuotaMarkers())
    const lower = run(account(win(82)), warned.markers)
    expect(lower.alerts).toEqual([])
    expect(lower.markers.fiveHour.level).toBe('warn')
    expect(lower.markers.fiveHour.percent).toBe(82)
  })

  it('does not send a reset alert for a drop that was never alerted', () => {
    const quiet = run(account(win(60)), emptyQuotaMarkers())
    const lower = run(account(win(20)), quiet.markers)
    expect(lower.alerts).toEqual([])
  })

  it('drop reset with notifyOnReset off restarts the markers without an alert', () => {
    const settings: QuotaSettings = { ...SETTINGS, notifyOnReset: false }
    const warned = run(account(win(85)), emptyQuotaMarkers(), settings)
    const dropped = run(account(win(40)), warned.markers, settings)
    expect(dropped.alerts).toEqual([])
    expect(dropped.markers.fiveHour.level).toBe('none')
  })

  it('tracks markers but sends no alerts while disabled', () => {
    const settings: QuotaSettings = { ...SETTINGS, enabled: false }
    const result = run(account(win(99)), emptyQuotaMarkers(), settings)
    expect(result.alerts).toEqual([])
    expect(result.markers.fiveHour).toEqual({ resetsAt: R1, level: 'critical', percent: 99 })
  })

  it('does not alert for a threshold that was crossed while disabled', () => {
    const settings: QuotaSettings = { ...SETTINGS, enabled: false }
    const disabled = run(account(win(99)), emptyQuotaMarkers(), settings)
    const enabled = run(account(win(99)), disabled.markers)
    expect(enabled.alerts).toEqual([])
  })

  it('does not send reset alerts while disabled', () => {
    const warned = run(account(win(85)), emptyQuotaMarkers())
    const settings: QuotaSettings = { ...SETTINGS, enabled: false }
    const next = run(account(win(10, R2)), warned.markers, settings)
    expect(next.alerts).toEqual([])
    expect(next.markers.fiveHour.resetsAt).toBe(R2)
  })

  it('skips a window whose usedPercentage is null and keeps its marker', () => {
    const warned = run(account(win(85)), emptyQuotaMarkers())
    const broken = { usedPercentage: null, resetsAt: R1 } as unknown as UsageWindow
    const result = run(account(broken), warned.markers)
    expect(result.alerts).toEqual([])
    expect(result.markers).toBe(warned.markers)
  })

  it('skips a window whose usedPercentage is absent', () => {
    const broken = { resetsAt: R1 } as unknown as UsageWindow
    const result = run(account(broken), emptyQuotaMarkers())
    expect(result.alerts).toEqual([])
    expect(result.markers).toEqual(emptyQuotaMarkers())
  })

  it('skips a window whose usedPercentage is NaN', () => {
    const result = run(account(win(Number.NaN)), emptyQuotaMarkers())
    expect(result.alerts).toEqual([])
    expect(result.markers.fiveHour).toEqual(EMPTY_QUOTA_MARKER)
  })

  it('evaluates each window independently', () => {
    const result = run(account(win(85), win(96, R2)), emptyQuotaMarkers())
    expect(result.alerts).toEqual([
      { window: 'fiveHour', kind: 'warn', percent: 85, resetsAt: R1 },
      { window: 'sevenDay', kind: 'critical', percent: 96, resetsAt: R2 }
    ])
  })

  it('leaves a missing window untouched', () => {
    const warned = run(account(win(85), null), emptyQuotaMarkers())
    const next = run(account(win(85), null), warned.markers)
    expect(next.markers.sevenDay).toBe(warned.markers.sevenDay)
  })

  it('does not alert on a persisted marker for the same resetsAt that already alerted', () => {
    const persisted: QuotaMarkers = {
      fiveHour: { resetsAt: R1, level: 'warn', percent: 85 },
      sevenDay: EMPTY_QUOTA_MARKER
    }
    const result = run(account(win(86)), persisted)
    expect(result.alerts).toEqual([])
  })

  it('still alerts critical on a persisted warn marker for the same resetsAt', () => {
    const persisted: QuotaMarkers = {
      fiveHour: { resetsAt: R1, level: 'warn', percent: 85 },
      sevenDay: EMPTY_QUOTA_MARKER
    }
    const result = run(account(win(97)), persisted)
    expect(result.alerts.map((a) => a.kind)).toEqual(['critical'])
  })

  it('sends a reset alert for a persisted warn marker whose window has since changed', () => {
    const persisted: QuotaMarkers = {
      fiveHour: { resetsAt: R1, level: 'warn', percent: 85 },
      sevenDay: EMPTY_QUOTA_MARKER
    }
    const result = run(account(win(3, R2)), persisted)
    expect(result.alerts).toEqual([{ window: 'fiveHour', kind: 'reset', percent: 3, resetsAt: R2 }])
  })

  it('skips a window that has already ended (resetsAt in the past) without alerting', () => {
    const result = run(account(win(99, NOW_SEC - 10)), emptyQuotaMarkers())
    expect(result.alerts).toEqual([])
    expect(result.markers.fiveHour).toEqual(EMPTY_QUOTA_MARKER)
  })

  it('returns the same markers object when nothing changed', () => {
    const warned = run(account(win(85)), emptyQuotaMarkers())
    const again = run(account(win(85)), warned.markers)
    expect(again.markers).toBe(warned.markers)
  })

  it('accepts a null resetsAt and treats it as one window instance', () => {
    const first = run(account(win(85, null)), emptyQuotaMarkers())
    expect(first.alerts.map((a) => a.kind)).toEqual(['warn'])
    expect(first.alerts[0]?.resetsAt).toBeNull()
    const second = run(account(win(88, null)), first.markers)
    expect(second.alerts).toEqual([])
  })
})

interface FakeUsage {
  readonly subscribe: (cb: (state: UsageState) => void) => () => void
  readonly emit: (state: UsageState) => void
  readonly listenerCount: () => number
}

function fakeUsage(): FakeUsage {
  const listeners = new Set<(state: UsageState) => void>()
  return {
    subscribe(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    emit(state) {
      for (const cb of listeners) cb(state)
    },
    listenerCount: () => listeners.size
  }
}

function state(acc: AccountUsage | null): UsageState {
  return { account: acc, sessions: [] }
}

function makeDeps(overrides: Partial<QuotaGuardDeps> = {}): {
  deps: QuotaGuardDeps
  usage: FakeUsage
  notify: ReturnType<typeof vi.fn<(alert: QuotaAlert) => void>>
  saveMarkers: ReturnType<typeof vi.fn<(markers: QuotaMarkers) => void>>
  setNow: (ms: number) => void
} {
  const usage = fakeUsage()
  const notify = vi.fn<(alert: QuotaAlert) => void>()
  const saveMarkers = vi.fn<(markers: QuotaMarkers) => void>()
  let nowMs = NOW_SEC * 1000
  const deps: QuotaGuardDeps = {
    usage: { onChange: usage.subscribe },
    getSettings: () => SETTINGS,
    notify,
    now: () => nowMs,
    loadMarkers: () => emptyQuotaMarkers(),
    saveMarkers,
    ...overrides
  }
  return { deps, usage, notify, saveMarkers, setNow: (ms) => { nowMs = ms } }
}

describe('createQuotaGuard', () => {
  it('subscribes to usage and notifies each alert', () => {
    const { deps, usage, notify } = makeDeps()
    createQuotaGuard(deps)
    expect(usage.listenerCount()).toBe(1)
    usage.emit(state(account(win(85))))
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith({ window: 'fiveHour', kind: 'warn', percent: 85, resetsAt: R1 })
  })

  it('saves markers only when they changed', () => {
    const { deps, usage, saveMarkers } = makeDeps()
    createQuotaGuard(deps)
    usage.emit(state(account(win(50))))
    // The first observation records the window's resetsAt, which is a tracked change.
    expect(saveMarkers).toHaveBeenCalledTimes(1)
    usage.emit(state(account(win(50))))
    expect(saveMarkers).toHaveBeenCalledTimes(1)
    usage.emit(state(account(win(55))))
    expect(saveMarkers).toHaveBeenCalledTimes(2)
    usage.emit(state(account(win(85))))
    expect(saveMarkers).toHaveBeenCalledTimes(3)
    expect(saveMarkers.mock.calls[2]?.[0].fiveHour.level).toBe('warn')
    usage.emit(state(account(win(86))))
    expect(saveMarkers).toHaveBeenCalledTimes(4)
    usage.emit(state(account(win(86))))
    expect(saveMarkers).toHaveBeenCalledTimes(4)
  })

  it('does not repeat alerts across a restart when the saved markers are loaded', () => {
    const first = makeDeps()
    createQuotaGuard(first.deps)
    first.usage.emit(state(account(win(85))))
    const saved = first.saveMarkers.mock.calls[0]?.[0] ?? emptyQuotaMarkers()

    const second = makeDeps({ loadMarkers: () => saved })
    createQuotaGuard(second.deps)
    second.usage.emit(state(account(win(86))))
    expect(second.notify).not.toHaveBeenCalled()
  })

  it('uses the injected clock (ms) to decide stale windows', () => {
    const { deps, usage, notify, setNow } = makeDeps()
    setNow((R1 + 1) * 1000)
    createQuotaGuard(deps)
    usage.emit(state(account(win(99, R1))))
    expect(notify).not.toHaveBeenCalled()
  })

  it('keeps the markers and saves them even when notify throws, and reports the error', () => {
    const onError = vi.fn<(where: string, error: unknown) => void>()
    const notify = vi.fn<(alert: QuotaAlert) => void>(() => {
      throw new Error('boom')
    })
    const { deps, usage, saveMarkers } = makeDeps({ notify, onError })
    const guard = createQuotaGuard(deps)
    usage.emit(state(account(win(85))))
    expect(saveMarkers).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(guard.markers().fiveHour.level).toBe('warn')
  })

  it('reports a save failure and keeps running', () => {
    const onError = vi.fn<(where: string, error: unknown) => void>()
    const saveMarkers = vi.fn<(markers: QuotaMarkers) => void>(() => {
      throw new Error('disk full')
    })
    const { deps, usage, notify } = makeDeps({ saveMarkers, onError })
    createQuotaGuard(deps)
    usage.emit(state(account(win(85))))
    expect(notify).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('stop() unsubscribes from usage', () => {
    const { deps, usage, notify } = makeDeps()
    const guard = createQuotaGuard(deps)
    guard.stop()
    expect(usage.listenerCount()).toBe(0)
    usage.emit(state(account(win(99))))
    expect(notify).not.toHaveBeenCalled()
  })
})
