import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { QuotaAlert, QuotaSettings, UsageState } from '../../shared/types'
import { deliverQuotaAlert, startQuotaWiring, type QuotaWiringDeps } from './quotaWiring'

const SETTINGS: QuotaSettings = {
  enabled: true,
  warnAtPercent: 80,
  criticalAtPercent: 95,
  notifyOnReset: true,
  criticalAction: 'ask',
  resetAction: 'ask',
  continueOnWake: false,
  showOpencodeGo: true
}

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'quota-wiring-'))
  dirs.push(dir)
  return path.join(dir, 'quota-markers.json')
}

function delivery() {
  return {
    sendAlert: vi.fn(),
    playSound: vi.fn(),
    notifyApp: vi.fn(),
    onError: vi.fn()
  }
}

const CRITICAL: QuotaAlert = { window: 'fiveHour', kind: 'critical', percent: 96, resetsAt: 1_700_003_600 }

describe('deliverQuotaAlert', () => {
  it('sends the toast, plays the sound and shows a desktop notice for a critical alert', () => {
    const deps = delivery()
    deliverQuotaAlert(deps, CRITICAL)
    expect(deps.sendAlert).toHaveBeenCalledWith(CRITICAL)
    expect(deps.playSound).toHaveBeenCalledTimes(1)
    expect(deps.notifyApp).toHaveBeenCalledWith('Claude usage critical 96%', expect.any(String))
  })

  it('does not play the sound for a reset', () => {
    const deps = delivery()
    deliverQuotaAlert(deps, { window: 'fiveHour', kind: 'reset', percent: 0, resetsAt: null, sessionIds: ['a'] })
    expect(deps.playSound).not.toHaveBeenCalled()
    expect(deps.sendAlert).toHaveBeenCalledTimes(1)
  })

  it('still shows the notice when the toast fails, and reports the failure', () => {
    const deps = delivery()
    const boom = new Error('renderer gone')
    vi.mocked(deps.sendAlert).mockImplementation(() => {
      throw boom
    })
    deliverQuotaAlert(deps, CRITICAL)
    expect(deps.onError).toHaveBeenCalledWith('quota toast', boom)
    expect(deps.notifyApp).toHaveBeenCalledTimes(1)
    expect(deps.playSound).toHaveBeenCalledTimes(1)
  })

  it('reports a failing sound and notice without throwing', () => {
    const deps = delivery()
    vi.mocked(deps.playSound).mockImplementation(() => {
      throw new Error('no audio')
    })
    vi.mocked(deps.notifyApp).mockImplementation(() => {
      throw new Error('no notifications')
    })
    expect(() => deliverQuotaAlert(deps, CRITICAL)).not.toThrow()
    expect(deps.onError.mock.calls.map(([where]) => where)).toEqual(['quota sound', 'quota notification'])
  })
})

interface GuardHarness {
  readonly emit: (state: UsageState) => void
  readonly deps: QuotaWiringDeps
}

function wiring(overrides: Partial<QuotaWiringDeps> = {}): GuardHarness {
  let listener: ((state: UsageState) => void) | null = null
  const base = delivery()
  const deps: QuotaWiringDeps = {
    usage: {
      onChange(callback) {
        listener = callback
        return () => {
          listener = null
        }
      }
    },
    getSettings: () => SETTINGS,
    markersFile: tempFile(),
    now: () => 1_700_000_000_000,
    ...base,
    ...overrides
  }
  return {
    deps,
    emit(state: UsageState): void {
      listener?.(state)
    }
  }
}

function usageAt(percent: number): UsageState {
  return {
    account: { fiveHour: { usedPercentage: percent, resetsAt: 1_700_003_600 }, sevenDay: null, updatedAt: 0 },
    sessions: []
  }
}

describe('startQuotaWiring with the autopilot', () => {
  it('delivers the alert as it is when there is no autopilot', () => {
    const h = wiring()
    startQuotaWiring(h.deps)
    h.emit(usageAt(96))
    expect(h.deps.sendAlert).toHaveBeenCalledWith(CRITICAL)
  })

  it('delivers the alert the autopilot returns, with its session actions', () => {
    const offered: QuotaAlert = { ...CRITICAL, sessionIds: ['a'] }
    const onAlert = vi.fn(() => offered)
    const h = wiring({ autopilot: { onAlert } })
    startQuotaWiring(h.deps)
    h.emit(usageAt(96))
    expect(onAlert).toHaveBeenCalledWith(CRITICAL)
    expect(h.deps.sendAlert).toHaveBeenCalledWith(offered)
  })

  it('delivers nothing when the autopilot drops the alert', () => {
    const h = wiring({ autopilot: { onAlert: () => null } })
    startQuotaWiring(h.deps)
    h.emit(usageAt(96))
    expect(h.deps.sendAlert).not.toHaveBeenCalled()
    expect(h.deps.playSound).not.toHaveBeenCalled()
    expect(h.deps.notifyApp).not.toHaveBeenCalled()
  })

  it('delivers the original alert and reports when the autopilot fails', () => {
    const boom = new Error('autopilot broke')
    const h = wiring({
      autopilot: {
        onAlert: () => {
          throw boom
        }
      }
    })
    startQuotaWiring(h.deps)
    h.emit(usageAt(96))
    expect(h.deps.onError).toHaveBeenCalledWith('quota autopilot', boom)
    expect(h.deps.sendAlert).toHaveBeenCalledWith(CRITICAL)
  })

  it('does not play the sound for a dropped alert, but does for a delivered warning', () => {
    const h = wiring({ autopilot: { onAlert: (alert) => (alert.kind === 'critical' ? null : alert) } })
    startQuotaWiring(h.deps)
    h.emit(usageAt(82))
    expect(h.deps.playSound).toHaveBeenCalledTimes(1)
    h.emit(usageAt(96))
    expect(h.deps.playSound).toHaveBeenCalledTimes(1)
  })
})
