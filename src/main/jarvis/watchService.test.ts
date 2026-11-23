import { describe, expect, it, vi } from 'vitest'
import {
  createWatchService,
  findWatchItems,
  formatWatchMessage,
  WATCH_MAX_CHARS,
  WATCH_STUCK_MIN_MS,
  WATCH_WAITING_MIN_MS,
  type WatchItem,
  type WatchRow,
  type WatchServiceDeps
} from './watchService'

const NOW = 1_700_000_000_000
const MIN = 60_000

function row(extra: Partial<WatchRow> & { readonly id: string }): WatchRow {
  return { name: extra.id, waiting: false, working: false, since: NOW - MIN, question: null, ...extra }
}

interface FakeTimer {
  readonly id: number
  readonly ms: number
  readonly callback: () => void
}

/** Every dependency is a fake: the timer, the clock, the fleet, the digest and the delivery. */
function setup(overrides: Partial<WatchServiceDeps> = {}) {
  let clock = NOW
  let rows: readonly WatchRow[] = []
  let deliverFailures = 0
  const timers = new Map<number, FakeTimer>()
  let nextTimer = 1
  const settings = { enabled: true, everyMinutes: 10 }
  const delivered: string[] = []
  const digests: boolean[] = []
  const errors: unknown[] = []

  const deps: WatchServiceDeps = {
    settings: () => settings,
    rows: () => rows,
    digest: async (onlyNeedingAttention) => {
      digests.push(onlyNeedingAttention)
      return 'Fleet digest: 1 session(s) need you.'
    },
    deliver: async (message) => {
      if (deliverFailures > 0) {
        deliverFailures -= 1
        throw new Error('deliver failed')
      }
      delivered.push(message)
    },
    now: () => clock,
    setInterval: (callback, ms) => {
      const id = nextTimer
      nextTimer += 1
      timers.set(id, { id, ms, callback })
      return id as unknown as ReturnType<typeof setInterval>
    },
    clearInterval: (timer) => {
      timers.delete(timer as unknown as number)
    },
    onError: (_where, error) => {
      errors.push(error)
    },
    log: vi.fn(),
    ...overrides
  }

  const svc = createWatchService(deps)
  return {
    svc,
    settings,
    timers,
    delivered,
    digests,
    errors,
    setRows: (next: readonly WatchRow[]) => {
      rows = next
    },
    failDeliver: (times: number) => {
      deliverFailures = times
    },
    at: (value: number) => {
      clock = value
    },
    advance: (ms: number) => {
      clock += ms
    },
    clock: () => clock
  }
}

// ---------- the pure rules

describe('findWatchItems (pure)', () => {
  it('waits for 3 minutes and reports an episode once, keyed by id and since', () => {
    const rows = [row({ id: 'api', waiting: true, since: NOW - 2 * MIN, question: 'Allow npm?' })]
    expect(findWatchItems(rows, NOW, new Set())).toEqual([])
    const items = findWatchItems([row({ id: 'api', waiting: true, since: NOW - 4 * MIN })], NOW, new Set())
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ key: `api:waiting:${NOW - 4 * MIN}`, sessionName: 'api', kind: 'waiting' })
    expect(items[0]?.detail).toBe('')
    const asking = [row({ id: 'api', waiting: true, since: NOW - 4 * MIN, question: 'Allow npm?' })]
    expect(findWatchItems(asking, NOW, new Set())[0]?.detail).toBe('Allow npm?')
    expect(findWatchItems(asking, NOW, new Set([`api:waiting:${NOW - 4 * MIN}`]))).toEqual([])
    // A new episode (different since) is a new item.
    const next = [row({ id: 'api', waiting: true, since: NOW - 3 * MIN })]
    expect(findWatchItems(next, NOW, new Set([`api:waiting:${NOW - 4 * MIN}`]))).toHaveLength(1)
  })

  it('reports a session working 20+ minutes as stuck, ignores unknown time, and sorts waiting first', () => {
    expect(findWatchItems([row({ id: 'w', working: true, since: NOW - 19 * MIN })], NOW, new Set())).toEqual([])
    expect(findWatchItems([row({ id: 'w', working: true, since: NOW - 25 * MIN })], NOW, new Set())[0])
      .toMatchObject({ key: `w:stuck:${NOW - 25 * MIN}`, kind: 'stuck' })
    expect(findWatchItems([row({ id: 'x', waiting: true, since: null })], NOW, new Set())).toEqual([])
    const items = findWatchItems(
      [
        row({ id: 'stuck', working: true, since: NOW - 30 * MIN }),
        row({ id: 'waiting-new', waiting: true, since: NOW - 4 * MIN }),
        row({ id: 'waiting-old', waiting: true, since: NOW - 9 * MIN })
      ],
      NOW,
      new Set()
    )
    expect(items.map((item) => item.sessionName)).toEqual(['waiting-old', 'waiting-new', 'stuck'])
  })

  it('has the documented thresholds', () => {
    expect(WATCH_WAITING_MIN_MS).toBe(3 * MIN)
    expect(WATCH_STUCK_MIN_MS).toBe(20 * MIN)
  })
})

describe('formatWatchMessage (pure)', () => {
  const item = (extra: Partial<WatchItem> = {}): WatchItem => ({
    key: 'k1',
    sessionName: 'API',
    kind: 'waiting',
    since: NOW - 4 * MIN,
    detail: 'Allow npm install?',
    ...extra
  })

  it('starts with the summary, lists each episode and ends with the instruction', () => {
    const message = formatWatchMessage([item(), item({ key: 'k2', sessionName: 'Worker', kind: 'stuck', detail: '' })], 'Fleet digest: body.', NOW)
    expect(message.startsWith(`[Watch] 1 session needs you, 1 looks stuck\n`)).toBe(true)
    expect(message).toContain('- "API" — waiting for you for 4 min: Allow npm install?')
    expect(message).toContain('- "Worker" — looks stuck for 4 min')
    expect(message).toContain('Fleet digest: body.')
    expect(message).toContain('Do not restart or close anything without asking.')
    expect(message.trimEnd().endsWith('Do not restart or close anything without asking.')).toBe(true)
  })

  it('pluralises the summary and clips a long detail to 160 characters', () => {
    const message = formatWatchMessage([item({ detail: 'q'.repeat(400) }), item({ key: 'k2', detail: 'r'.repeat(400) })], '', NOW)
    expect(message.startsWith(`[Watch] 2 sessions need you\n`)).toBe(true)
    expect(message).not.toContain('q'.repeat(161))
    expect(message).toContain(`${'q'.repeat(159)}…`)
  })

  it('caps the whole message at 7000 characters, giving the digest up first, and hard-caps a huge list', () => {
    const few = [item(), item({ key: 'k2', sessionName: 'Worker', kind: 'stuck' })]
    const message = formatWatchMessage(few, 'digest '.repeat(5000), NOW)
    expect(message.length).toBe(WATCH_MAX_CHARS)
    expect(message).toContain('Do not restart or close anything without asking.')
    const many = Array.from({ length: 60 }, (_value, index) => item({
      key: `k${index}`,
      sessionName: 'name'.repeat(40),
      detail: 'detail '.repeat(40)
    }))
    expect(formatWatchMessage(many, 'digest '.repeat(5000), NOW)).toHaveLength(WATCH_MAX_CHARS)
  })
})

// ---------- the service

describe('createWatchService', () => {
  it('does nothing at all while the Settings toggle is off', async () => {
    const h = setup()
    h.settings.enabled = false
    h.setRows([row({ id: 'api', waiting: true, since: NOW - 30 * MIN })])
    h.svc.start()
    expect(h.timers.size).toBe(0)
    await h.svc.tick()
    expect(h.digests).toEqual([])
    expect(h.delivered).toEqual([])
    expect(h.svc.status()).toMatchObject({ enabled: false, lastCheckAt: null, reported: 0 })
  })

  it('sends nothing and reads no digest when every session is idle or fresh', async () => {
    const h = setup()
    h.setRows([row({ id: 'idle', since: NOW - 2 * 60 * MIN }), row({ id: 'fresh-work', working: true, since: NOW - MIN })])
    await h.svc.tick()
    expect(h.digests).toEqual([])
    expect(h.delivered).toEqual([])
    expect(h.errors).toEqual([])
    expect(h.svc.status().lastCheckAt).toBe(NOW)
  })

  it('ignores a session waiting 2 minutes; reports it at 4 once, and again only for a new episode', async () => {
    const h = setup()
    const firstSince = NOW - 2 * MIN
    h.setRows([row({ id: 'api', waiting: true, since: firstSince, question: 'Allow npm?' })])
    await h.svc.tick()
    expect(h.delivered).toEqual([])
    h.advance(2 * MIN)
    await h.svc.tick()
    expect(h.delivered).toHaveLength(1)
    expect(h.digests).toEqual([true])
    expect(h.delivered[0]).toContain('1 session needs you')
    expect(h.svc.status()).toMatchObject({ lastMessageAt: h.clock(), reported: 1 })
    await h.svc.tick()
    h.advance(30 * MIN)
    await h.svc.tick()
    expect(h.delivered).toHaveLength(1)
    // The user answered, then a new question came 4 minutes ago: a new episode.
    h.setRows([row({ id: 'api', waiting: false, since: h.clock() - MIN })])
    await h.svc.tick()
    expect(h.svc.status().reported).toBe(0)
    h.setRows([row({ id: 'api', waiting: true, since: h.clock() - 4 * MIN, question: 'Allow tests?' })])
    await h.svc.tick()
    expect(h.delivered).toHaveLength(2)
  })

  it('reports a session stuck for 25 minutes and asks for the full digest then', async () => {
    const h = setup()
    h.setRows([row({ id: 'worker', name: 'Worker', working: true, since: NOW - 25 * MIN })])
    await h.svc.tick()
    expect(h.digests).toEqual([false])
    expect(h.delivered).toHaveLength(1)
    expect(h.delivered[0]).toContain('[Watch] 1 looks stuck')
    expect(h.delivered[0]).toContain('looks stuck for 25 min')
  })

  it('retries a failed delivery on the next tick and remembers only after it resolved', async () => {
    const h = setup()
    h.setRows([row({ id: 'api', waiting: true, since: NOW - 5 * MIN })])
    h.failDeliver(1)
    await h.svc.tick()
    expect(h.delivered).toEqual([])
    expect(h.errors).toHaveLength(1)
    expect(h.svc.status().reported).toBe(0)
    await h.svc.tick()
    expect(h.delivered).toHaveLength(1)
    expect(h.svc.status().reported).toBe(1)
  })

  it('never runs two ticks at once', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let digestCalls = 0
    const h = setup({
      digest: async () => {
        digestCalls += 1
        await gate
        return 'Fleet digest: late.'
      }
    })
    h.setRows([row({ id: 'api', waiting: true, since: NOW - 5 * MIN })])
    const first = h.svc.tick()
    await h.svc.tick()
    expect(digestCalls).toBe(1)
    release()
    await first
    expect(h.delivered).toHaveLength(1)
  })

  it('creates one timer, restarts it when the interval changes and clears it (forgetting episodes) when turned off', async () => {
    const h = setup()
    h.setRows([row({ id: 'api', waiting: true, since: NOW - 5 * MIN })])
    h.svc.start()
    expect([...h.timers.values()].map((timer) => timer.ms)).toEqual([10 * MIN])
    const startTimer = [...h.timers.values()][0]
    h.svc.refresh()
    expect([...h.timers.values()].map((timer) => timer.id)).toEqual([startTimer?.id])
    h.settings.everyMinutes = 15
    h.svc.refresh()
    expect(h.timers.size).toBe(1)
    expect([...h.timers.values()].map((timer) => timer.ms)).toEqual([15 * MIN])
    expect([...h.timers.values()][0]?.id).not.toBe(startTimer?.id)
    await h.svc.tick()
    expect(h.svc.status().reported).toBe(1)
    h.settings.enabled = false
    h.svc.refresh()
    expect(h.timers.size).toBe(0)
    expect(h.svc.status()).toMatchObject({ enabled: false, everyMinutes: 15, reported: 0 })
    h.settings.enabled = true
    h.svc.start()
    expect(h.timers.size).toBe(1)
    h.svc.stop()
    expect(h.timers.size).toBe(0)
  })

  it('runs a tick from the timer and keeps the reported set at 500 at most', async () => {
    const h = setup()
    h.setRows(Array.from({ length: 600 }, (_value, index) =>
      row({ id: `s${index}`, name: `Session ${index}`, waiting: true, since: NOW - 6 * MIN })))
    h.svc.start()
    const timer = [...h.timers.values()][0]
    expect(timer).toBeDefined()
    timer?.callback()
    await vi.waitFor(() => {
      expect(h.delivered).toHaveLength(1)
    })
    expect(h.svc.status().reported).toBe(500)
  })
})
