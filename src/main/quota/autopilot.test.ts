import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Id, QuotaAlert, QuotaAutopilotState, QuotaSettings, RuntimeState, Session, UsageState } from '../../shared/types'
import { createQuotaAutopilot, type QuotaAutopilot } from './autopilot'
import { CONTINUE_ENTER_DELAY_MS, CONTINUE_MAX_WAIT_MS, CONTINUE_QUIET_MS, RESET_GRACE_MS } from './autopilotPolicy'
import { saveAutopilotState } from './autopilotStore'

const NOW_MS = 1_700_000_000_000
const NOW_SEC = NOW_MS / 1000
const RESET_SEC = NOW_SEC + 3600
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
const CRITICAL: QuotaAlert = { window: 'fiveHour', kind: 'critical', percent: 96, resetsAt: RESET_SEC }
const RESET: QuotaAlert = { window: 'fiveHour', kind: 'reset', percent: 0, resetsAt: null }

const dirs: string[] = []

function session(id: Id, overrides: Partial<Session> = {}): Session {
  return { id, name: id, cwd: '/x', groupId: null, statusId: null, order: 0, createdAt: 1, claudeArgs: [], ...overrides }
}

function running(id: Id, overrides: Partial<RuntimeState> = {}): RuntimeState {
  return { sessionId: id, run: 'running', exitCode: null, attention: null, ...overrides }
}

interface WorldInit {
  readonly sessions?: Session[]
  readonly runtime?: Record<Id, Partial<RuntimeState>>
  readonly settings?: Partial<QuotaSettings>
  readonly resetsAt?: number | null
  readonly failSleep?: Id
  readonly failWake?: Id
}

interface Log {
  readonly sleeps: Id[]
  readonly wakes: Id[]
  readonly writes: Array<[Id, string]>
  readonly delivered: QuotaAlert[]
  readonly states: QuotaAutopilotState[]
  readonly continueFailed: Id[]
  readonly errors: Array<[string, unknown]>
}

function makeWorld(init: WorldInit = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'quota-autopilot-svc-'))
  dirs.push(dir)
  const file = path.join(dir, 'quota-autopilot.json')
  let sessions: Session[] = init.sessions ?? [session('a'), session('b')]
  const runtimes = new Map<Id, RuntimeState>(
    sessions.map((s) => [s.id, running(s.id, init.runtime?.[s.id])])
  )
  let settings: QuotaSettings = { ...SETTINGS, ...init.settings }
  let usage: UsageState = {
    account: {
      fiveHour: { usedPercentage: 96, resetsAt: init.resetsAt === undefined ? RESET_SEC : init.resetsAt },
      sevenDay: null,
      updatedAt: NOW_MS
    },
    sessions: []
  }
  const outputListeners = new Set<(id: Id) => void>()
  const log: Log = { sleeps: [], wakes: [], writes: [], delivered: [], states: [], continueFailed: [], errors: [] }

  const autopilot: QuotaAutopilot = createQuotaAutopilot({
    filePath: file,
    now: () => Date.now(),
    getSettings: () => settings,
    getUsage: () => usage,
    listSessions: () => sessions,
    getRuntime: () => runtimes,
    sleepSession: (id) => {
      if (id === init.failSleep) throw new Error('sleep refused')
      log.sleeps.push(id)
      runtimes.set(id, { ...runtimes.get(id), sessionId: id, run: 'exited', exitCode: null, attention: null, sleeping: true })
    },
    wakeSession: (id) => {
      if (id === init.failWake || runtimes.get(id)?.sleeping !== true) return false
      log.wakes.push(id)
      const { sleeping: _sleeping, ...rest } = runtimes.get(id) as RuntimeState
      runtimes.set(id, { ...rest, run: 'running' })
      return true
    },
    writeToSession: (id, data) => log.writes.push([id, data]),
    subscribeOutput: (callback) => {
      outputListeners.add(callback)
      return () => {
        outputListeners.delete(callback)
      }
    },
    deliverAlert: (alert) => log.delivered.push(alert),
    onContinueFailed: (id) => log.continueFailed.push(id),
    onStateChange: (state) => log.states.push(state),
    onError: (where, error) => log.errors.push([where, error])
  })

  return {
    file,
    log,
    runtimes,
    autopilot,
    setSessions(next: Session[]): void {
      sessions = next
    },
    setUsageResetsAt(resetsAt: number | null): void {
      usage = { ...usage, account: usage.account && { ...usage.account, fiveHour: { usedPercentage: 96, resetsAt } } }
    },
    setSettings(next: Partial<QuotaSettings>): void {
      settings = { ...settings, ...next }
    },
    emitOutput(id: Id): void {
      for (const listener of [...outputListeners]) listener(id)
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW_MS)
})

afterEach(() => {
  vi.useRealTimers()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('critical alert', () => {
  it('passes the alert through unchanged when the critical action is nothing', () => {
    const w = makeWorld({ settings: { criticalAction: 'nothing' } })
    expect(w.autopilot.onAlert(CRITICAL)).toEqual(CRITICAL)
    expect(w.log.sleeps).toEqual([])
  })

  it('offers the idle sessions, the one on screen included, when the critical action is ask', () => {
    const w = makeWorld({ runtime: { b: { activity: 'working' } } })
    const result = w.autopilot.onAlert(CRITICAL)
    expect(result).toEqual({ ...CRITICAL, sessionIds: ['a'] })
    expect(w.log.sleeps).toEqual([])
  })

  it('offers no session action when no session is idle', () => {
    const w = makeWorld({ runtime: { a: { activity: 'working' }, b: { activity: 'needs-input' } } })
    const result = w.autopilot.onAlert(CRITICAL)
    expect(result).toEqual(CRITICAL)
    expect(result).not.toHaveProperty('sessionIds')
  })

  it('sleeps the idle sessions and marks the alert as slept when the critical action is sleep', () => {
    const w = makeWorld({ settings: { criticalAction: 'sleep' } })
    const result = w.autopilot.onAlert(CRITICAL)
    expect(result).toEqual({ ...CRITICAL, autoAction: 'slept', sessionIds: ['a', 'b'] })
    expect(w.log.sleeps).toEqual(['a', 'b'])
    expect(w.autopilot.getState()).toEqual({ sleptForQuota: ['a', 'b'], stoppedAtLimit: [], resetsAt: RESET_SEC })
    expect(existsSync(w.file)).toBe(true)
  })

  it('leaves working, waiting, kept-awake, remote, closed and asleep sessions alone', () => {
    const sessions = [
      session('work'),
      session('wait'),
      session('keep', { keepAwake: true }),
      session('remote'),
      session('closed', { closedAt: 5 }),
      session('asleep'),
      session('idle')
    ]
    const w = makeWorld({
      sessions,
      settings: { criticalAction: 'sleep' },
      runtime: {
        work: { activity: 'working' },
        wait: { activity: 'needs-input' },
        remote: { remoteControl: true },
        asleep: { sleeping: true }
      }
    })
    w.autopilot.onAlert(CRITICAL)
    expect(w.log.sleeps).toEqual(['idle'])
  })

  it('returns the alert unchanged when sleeping finds nothing to sleep', () => {
    const w = makeWorld({ settings: { criticalAction: 'sleep' }, runtime: { a: { activity: 'working' }, b: { activity: 'working' } } })
    expect(w.autopilot.onAlert(CRITICAL)).toEqual(CRITICAL)
    expect(w.autopilot.getState().resetsAt).toBeNull()
  })

  it('reports a failing sleep and still sleeps the other sessions', () => {
    const w = makeWorld({ settings: { criticalAction: 'sleep' }, failSleep: 'a' })
    const result = w.autopilot.onAlert(CRITICAL)
    expect(result).toEqual({ ...CRITICAL, autoAction: 'slept', sessionIds: ['b'] })
    expect(w.log.errors[0][0]).toBe('quota autopilot sleep')
  })

  it('passes warnings and seven-day alerts through unchanged', () => {
    const w = makeWorld({ settings: { criticalAction: 'sleep' } })
    const warn: QuotaAlert = { window: 'fiveHour', kind: 'warn', percent: 85, resetsAt: RESET_SEC }
    const weekly: QuotaAlert = { window: 'sevenDay', kind: 'critical', percent: 96, resetsAt: null }
    expect(w.autopilot.onAlert(warn)).toEqual(warn)
    expect(w.autopilot.onAlert(weekly)).toEqual(weekly)
    expect(w.log.sleeps).toEqual([])
  })
})

describe('reset alert', () => {
  it('passes a guard reset through when nothing is held', () => {
    const w = makeWorld()
    expect(w.autopilot.onAlert(RESET)).toEqual(RESET)
  })

  it('offers the held sessions when the guard reports the reset first and the action is ask', () => {
    const w = makeWorld()
    w.autopilot.onUsageLimit('a')
    expect(w.autopilot.onAlert(RESET)).toEqual({ ...RESET, sessionIds: ['a'] })
    expect(w.autopilot.getState().stoppedAtLimit).toEqual(['a'])
  })

  it('wakes the held sessions when the guard reports the reset first and the action is wake', () => {
    const w = makeWorld({ settings: { criticalAction: 'sleep', resetAction: 'wake' } })
    w.autopilot.onAlert(CRITICAL)
    expect(w.autopilot.onAlert(RESET)).toEqual({ ...RESET, autoAction: 'woke', sessionIds: ['a', 'b'] })
    expect(w.log.wakes).toEqual(['a', 'b'])
    expect(w.autopilot.getState()).toEqual({ sleptForQuota: [], stoppedAtLimit: [], resetsAt: null })
    vi.advanceTimersByTime(3_600_000)
    expect(w.log.delivered).toEqual([])
  })

  it('fires RESET_GRACE_MS after the reset and wakes the held sessions when the action is wake', () => {
    const w = makeWorld({ settings: { criticalAction: 'sleep', resetAction: 'wake' } })
    w.autopilot.onAlert(CRITICAL)
    const untilReset = RESET_SEC * 1000 - NOW_MS
    vi.advanceTimersByTime(untilReset + RESET_GRACE_MS - 1)
    expect(w.log.delivered).toEqual([])
    vi.advanceTimersByTime(1)
    expect(w.log.delivered).toEqual([{ ...RESET, autoAction: 'woke', sessionIds: ['a', 'b'] }])
    expect(w.log.wakes).toEqual(['a', 'b'])
  })

  it('offers the wake at the reset and keeps the sessions held when the action is ask', () => {
    const w = makeWorld()
    w.autopilot.onUsageLimit('a')
    vi.advanceTimersByTime((RESET_SEC * 1000 - NOW_MS) + RESET_GRACE_MS)
    expect(w.log.delivered).toEqual([{ ...RESET, sessionIds: ['a'] }])
    expect(w.log.wakes).toEqual([])
    expect(w.autopilot.getState().stoppedAtLimit).toEqual(['a'])
  })

  it('drops the guard copy of a reset that the timer already handled', () => {
    const w = makeWorld()
    w.autopilot.onUsageLimit('a')
    vi.advanceTimersByTime((RESET_SEC * 1000 - NOW_MS) + RESET_GRACE_MS)
    expect(w.autopilot.onAlert(RESET)).toBeNull()
  })

  it('pings the user (onContinueFailed) when a held session could not be woken at the reset', () => {
    const w = makeWorld({ settings: { criticalAction: 'sleep', resetAction: 'wake' }, failWake: 'a' })
    w.autopilot.onAlert(CRITICAL)
    expect(w.autopilot.onAlert(RESET)).toEqual({ ...RESET, autoAction: 'woke', sessionIds: ['b'] })
    expect(w.log.continueFailed).toEqual(['a'])
    expect(w.log.errors).toEqual([]) // the notice is not an error path: it is delivered on purpose
  })

  it('handles a reset once when the guard reports it first, cancelling the timer', () => {
    const w = makeWorld({ settings: { criticalAction: 'sleep', resetAction: 'wake' } })
    w.autopilot.onAlert(CRITICAL)
    w.autopilot.onAlert(RESET)
    vi.advanceTimersByTime(3_600_000)
    expect(w.log.wakes).toEqual(['a', 'b'])
    expect(w.log.delivered).toEqual([])
  })

  it('fires right after load when the persisted reset time has already passed', async () => {
    const w = makeWorld({ settings: { resetAction: 'wake' } })
    saveAutopilotState(w.file, { sleptForQuota: ['a'], stoppedAtLimit: [], resetsAt: NOW_SEC - 60 })
    w.runtimes.set('a', running('a', { sleeping: true, run: 'exited' }))
    await w.autopilot.load()
    vi.advanceTimersByTime(0)
    expect(w.log.wakes).toEqual(['a'])
    expect(w.log.delivered).toEqual([{ ...RESET, autoAction: 'woke', sessionIds: ['a'] }])
  })

  it('reports a corrupt state file and starts empty', async () => {
    const w = makeWorld()
    writeFileSync(w.file, '{ broken', 'utf-8')
    await w.autopilot.load()
    expect(w.log.errors.map(([where]) => where)).toEqual(['quota autopilot load'])
    expect(w.autopilot.getState()).toEqual({ sleptForQuota: [], stoppedAtLimit: [], resetsAt: null })
  })

  it('treats a missing state file as empty without reporting an error', async () => {
    const w = makeWorld()
    await w.autopilot.load()
    expect(w.log.errors).toEqual([])
    expect(w.autopilot.getState().sleptForQuota).toEqual([])
  })

  it('does not wake a held session that was removed meanwhile', () => {
    const w = makeWorld({ settings: { criticalAction: 'sleep', resetAction: 'wake' } })
    w.autopilot.onAlert(CRITICAL)
    w.setSessions([session('b')])
    vi.advanceTimersByTime((RESET_SEC * 1000 - NOW_MS) + RESET_GRACE_MS)
    expect(w.log.wakes).toEqual(['b'])
    expect(w.log.delivered).toEqual([{ ...RESET, autoAction: 'woke', sessionIds: ['b'] }])
  })

  it('delivers nothing when every held session is gone', () => {
    const w = makeWorld({ settings: { criticalAction: 'sleep', resetAction: 'wake' } })
    w.autopilot.onAlert(CRITICAL)
    w.setSessions([])
    vi.advanceTimersByTime((RESET_SEC * 1000 - NOW_MS) + RESET_GRACE_MS)
    expect(w.log.delivered).toEqual([])
    expect(w.autopilot.getState()).toEqual({ sleptForQuota: [], stoppedAtLimit: [], resetsAt: null })
  })

  it('announces only the sessions that could be woken', () => {
    const w = makeWorld({ settings: { criticalAction: 'sleep', resetAction: 'wake' }, failWake: 'a' })
    w.autopilot.onAlert(CRITICAL)
    vi.advanceTimersByTime((RESET_SEC * 1000 - NOW_MS) + RESET_GRACE_MS)
    expect(w.log.delivered).toEqual([{ ...RESET, autoAction: 'woke', sessionIds: ['b'] }])
  })

  it('announces a plain reset when no held session could be woken', () => {
    const w = makeWorld({ sessions: [session('a')], settings: { criticalAction: 'sleep', resetAction: 'wake' }, failWake: 'a' })
    w.autopilot.onAlert(CRITICAL)
    vi.advanceTimersByTime((RESET_SEC * 1000 - NOW_MS) + RESET_GRACE_MS)
    expect(w.log.delivered).toEqual([RESET])
  })

  it('stops the timer on stop()', () => {
    const w = makeWorld({ settings: { criticalAction: 'sleep', resetAction: 'wake' } })
    w.autopilot.onAlert(CRITICAL)
    w.autopilot.stop()
    vi.advanceTimersByTime(3 * 3_600_000)
    expect(w.log.wakes).toEqual([])
  })
})

describe('usage limit and usage changes', () => {
  it('holds a session cut off by the limit until the reset', () => {
    const w = makeWorld()
    w.autopilot.onUsageLimit('a')
    expect(w.autopilot.getState()).toEqual({ sleptForQuota: [], stoppedAtLimit: ['a'], resetsAt: RESET_SEC })
    vi.advanceTimersByTime((RESET_SEC * 1000 - NOW_MS) + RESET_GRACE_MS)
    expect(w.log.delivered).toEqual([{ ...RESET, sessionIds: ['a'] }])
  })

  it('ignores an unknown or closed session', () => {
    const w = makeWorld({ sessions: [session('a'), session('old', { closedAt: 5 })] })
    w.autopilot.onUsageLimit('missing')
    w.autopilot.onUsageLimit('old')
    expect(w.autopilot.getState().stoppedAtLimit).toEqual([])
  })

  it('does not take a reset time that has already passed (stale usage data)', () => {
    const w = makeWorld({ resetsAt: NOW_SEC - 10 })
    w.autopilot.onUsageLimit('a')
    expect(w.autopilot.getState().resetsAt).toBeNull()
    vi.advanceTimersByTime(86_400_000)
    expect(w.log.delivered).toEqual([])
  })

  it('adopts a newer reset time while sessions are held', () => {
    const w = makeWorld()
    w.autopilot.onUsageLimit('a')
    w.setUsageResetsAt(RESET_SEC + 18_000)
    w.autopilot.onUsageChanged()
    expect(w.autopilot.getState().resetsAt).toBe(RESET_SEC + 18_000)
    vi.advanceTimersByTime((RESET_SEC * 1000 - NOW_MS) + RESET_GRACE_MS)
    expect(w.log.delivered).toEqual([])
    vi.advanceTimersByTime(18_000_000)
    expect(w.log.delivered).toHaveLength(1)
  })

  it('does not offer a spent reset again when the hold changes later', () => {
    const w = makeWorld()
    w.autopilot.onUsageLimit('a')
    w.autopilot.onUsageLimit('b')
    vi.advanceTimersByTime((RESET_SEC * 1000 - NOW_MS) + RESET_GRACE_MS)
    expect(w.log.delivered).toHaveLength(1)
    w.autopilot.forget('a')
    vi.advanceTimersByTime(3 * 3_600_000)
    expect(w.log.delivered).toHaveLength(1)
    expect(w.autopilot.getState().resetsAt).toBeNull()
  })

  it('ignores usage changes when nothing is held', () => {
    const w = makeWorld()
    w.setUsageResetsAt(RESET_SEC + 18_000)
    w.autopilot.onUsageChanged()
    expect(w.autopilot.getState().resetsAt).toBeNull()
  })
})

describe('wake', () => {
  it('wakes the sleeping held sessions, clears the hold and returns their ids', () => {
    const w = makeWorld({ settings: { criticalAction: 'sleep' } })
    w.autopilot.onAlert(CRITICAL)
    expect(w.autopilot.wake({ sendContinue: false })).toEqual(['a', 'b'])
    expect(w.log.wakes).toEqual(['a', 'b'])
    expect(w.autopilot.getState()).toEqual({ sleptForQuota: [], stoppedAtLimit: [], resetsAt: null })
  })

  it('types "continue" only into a cut-off session, after output and a quiet period, then Enter', () => {
    const w = makeWorld({ settings: { criticalAction: 'sleep' } })
    w.autopilot.onUsageLimit('a')
    w.autopilot.onAlert(CRITICAL)
    expect(w.autopilot.wake({ sendContinue: true })).toEqual(['a', 'b'])
    expect(w.log.wakes).toEqual(['a', 'b'])
    w.emitOutput('a')
    vi.advanceTimersByTime(CONTINUE_QUIET_MS - 1)
    expect(w.log.writes).toEqual([])
    vi.advanceTimersByTime(1)
    expect(w.log.writes).toEqual([['a', 'continue']])
    vi.advanceTimersByTime(CONTINUE_ENTER_DELAY_MS)
    expect(w.log.writes).toEqual([['a', 'continue'], ['a', '\r']])
  })

  it('types "continue" into a limit-stopped session that kept running and is already quiet', () => {
    const w = makeWorld()
    w.autopilot.onUsageLimit('a')
    expect(w.autopilot.wake({ sendContinue: true })).toEqual(['a'])
    vi.advanceTimersByTime(CONTINUE_MAX_WAIT_MS)
    expect(w.log.writes.map(([, data]) => data)).toEqual(['continue', '\r'])
    expect(w.log.errors).toEqual([])
  })

  it('types nothing when continueOnWake is off', () => {
    const w = makeWorld()
    w.autopilot.onUsageLimit('a')
    expect(w.autopilot.wake({ sendContinue: false })).toEqual([])
    w.emitOutput('a')
    vi.advanceTimersByTime(CONTINUE_MAX_WAIT_MS)
    expect(w.log.writes).toEqual([])
  })

  it('pings the user (onContinueFailed) when "continue" is given up', () => {
    const w = makeWorld({ settings: { continueOnWake: true } })
    w.autopilot.onUsageLimit('a')
    w.runtimes.set('a', running('a', { sleeping: true, run: 'exited' }))
    w.autopilot.wake({ sendContinue: true })
    // A freshly woken session waits for output that never comes: nothing typed, give-up at the max wait.
    vi.advanceTimersByTime(CONTINUE_MAX_WAIT_MS)
    expect(w.log.writes).toEqual([])
    expect(w.log.continueFailed).toEqual(['a'])
    expect(w.log.errors.length).toBe(1) // still logged as an error as before
  })

  it('cancels the pending "continue" of a session that is forgotten', () => {
    const w = makeWorld()
    w.autopilot.onUsageLimit('a')
    w.autopilot.wake({ sendContinue: true })
    w.autopilot.forget('a')
    w.emitOutput('a')
    vi.advanceTimersByTime(CONTINUE_MAX_WAIT_MS * 2)
    expect(w.log.writes).toEqual([])
    expect(w.log.errors).toEqual([])
  })
})

describe('state and persistence', () => {
  it('announces every state change to the app', () => {
    const w = makeWorld({ settings: { criticalAction: 'sleep' } })
    w.autopilot.onAlert(CRITICAL)
    expect(w.log.states.at(-1)).toEqual({ sleptForQuota: ['a', 'b'], stoppedAtLimit: [], resetsAt: RESET_SEC })
  })

  it('forget removes a session from the held lists and disarms when nothing is left', () => {
    const w = makeWorld()
    w.autopilot.onUsageLimit('a')
    w.autopilot.forget('a')
    expect(w.autopilot.getState().stoppedAtLimit).toEqual([])
    vi.advanceTimersByTime(3_600_000 * 2)
    expect(w.log.delivered).toEqual([])
  })
})
