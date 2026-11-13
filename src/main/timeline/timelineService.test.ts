import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { HookEvent, TimelineTurn } from '../../shared/types'
import { TIMELINE_MAX_AGE_DAYS, TIMELINE_MAX_TURNS_PER_SESSION } from '../../shared/types'
import { createTimelineService, type TimelineService, type TimelineServiceDeps } from './timelineService'
import { COST_SETTLE_MS } from './timelineState'
import { serializeTimelineFile, parseTimelineFile } from './timelineFile'

const NOW = 1_700_000_000_000
const DAY_MS = 86_400_000

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'timeline-service-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

interface Clock {
  t: number
}

interface CostBox {
  value: number | null
}

interface Harness {
  readonly service: TimelineService
  readonly clock: Clock
  readonly cost: CostBox
  readonly timers: Map<number, () => void>
  readonly onChange: ReturnType<typeof vi.fn>
  readonly onError: ReturnType<typeof vi.fn>
  readonly filePath: string
  readonly dir: string
}

/** Builds a service with a fake clock, a fake cost source and fake save timers. */
function makeService(
  filePath: string,
  clock: Clock,
  cost: CostBox,
  overrides: Partial<TimelineServiceDeps> = {}
): {
  service: TimelineService
  timers: Map<number, () => void>
  onChange: ReturnType<typeof vi.fn>
  onError: ReturnType<typeof vi.fn>
} {
  const timers = new Map<number, () => void>()
  let handle = 0
  const onChange = vi.fn()
  const onError = vi.fn()
  const service = createTimelineService({
    filePath,
    now: () => clock.t,
    getSessionCost: () => cost.value,
    onChange,
    onError,
    saveDelayMs: 2000,
    setTimeout: (callback) => {
      handle += 1
      timers.set(handle, callback)
      return handle
    },
    clearTimeout: (id) => {
      timers.delete(id as number)
    },
    ...overrides
  })
  return { service, timers, onChange, onError }
}

function harness(initialCost: number | null = 0): Harness {
  const dir = tempDir()
  const filePath = path.join(dir, 'timeline.json')
  const clock: Clock = { t: NOW }
  const cost: CostBox = { value: initialCost }
  const made = makeService(filePath, clock, cost)
  return { ...made, clock, cost, filePath, dir }
}

function prompt(service: TimelineService, sessionId: string, text?: string): void {
  const event: HookEvent = {
    sessionId,
    event: 'UserPromptSubmit',
    ...(text !== undefined ? { prompt: text } : {})
  }
  service.onHook(event)
}

function fireSaveTimers(timers: Map<number, () => void>): void {
  for (const [id, callback] of [...timers]) {
    timers.delete(id)
    callback()
  }
}

describe('onHook UserPromptSubmit', () => {
  it('starts a running turn with the prompt, the start time and no end', () => {
    const h = harness()
    prompt(h.service, 's1', 'fix the login bug')
    const [turn] = h.service.get('s1')
    expect(turn).toMatchObject({
      sessionId: 's1',
      prompt: 'fix the login bug',
      startedAt: NOW,
      endedAt: null,
      end: null,
      neededYou: false
    })
    expect(turn.id.startsWith(`${NOW}-`)).toBe(true)
  })

  it('uses an empty prompt when the event carries none', () => {
    const h = harness()
    prompt(h.service, 's1')
    expect(h.service.get('s1')[0].prompt).toBe('')
  })

  it('a new prompt finishes the running turn first, at the new prompt time', () => {
    const h = harness()
    prompt(h.service, 's1', 'first')
    h.clock.t += 5_000
    prompt(h.service, 's1', 'second')
    const [newest, older] = h.service.get('s1')
    expect(newest).toMatchObject({ prompt: 'second', end: null })
    expect(older).toMatchObject({ prompt: 'first', end: 'finished', endedAt: NOW + 5_000 })
  })

  it('gives every turn of a session a distinct id, even when started in the same millisecond', () => {
    const h = harness()
    prompt(h.service, 's1', 'a')
    prompt(h.service, 's1', 'b')
    prompt(h.service, 's1', 'c')
    const ids = new Set(h.service.get('s1').map((t) => t.id))
    expect(ids.size).toBe(3)
  })

  it('reports the change with the session id', () => {
    const h = harness()
    prompt(h.service, 's1', 'x')
    expect(h.onChange).toHaveBeenCalledWith('s1')
  })

  it('keeps only the newest TIMELINE_MAX_TURNS_PER_SESSION turns', () => {
    const h = harness()
    const total = TIMELINE_MAX_TURNS_PER_SESSION + 1
    for (let i = 0; i < total; i += 1) {
      h.clock.t += 1
      prompt(h.service, 's1', `p${i}`)
    }
    const turns = h.service.get('s1')
    expect(turns).toHaveLength(TIMELINE_MAX_TURNS_PER_SESSION)
    expect(turns[0].prompt).toBe(`p${total - 1}`)
    expect(turns[turns.length - 1].prompt).toBe('p1')
  })
})

describe('onHook Notification', () => {
  it('marks the running turn as one where the user was needed', () => {
    const h = harness()
    prompt(h.service, 's1', 'x')
    h.service.onHook({ sessionId: 's1', event: 'Notification', message: 'needs permission' })
    expect(h.service.get('s1')[0].neededYou).toBe(true)
    expect(h.service.get('s1')[0].end).toBeNull()
  })

  it('does nothing and reports no change when no turn is running', () => {
    const h = harness()
    h.service.onHook({ sessionId: 's1', event: 'Notification' })
    expect(h.service.get('s1')).toEqual([])
    expect(h.onChange).not.toHaveBeenCalled()
  })
})

describe('onHook Stop', () => {
  it('ends the running turn as finished at the stop time', () => {
    const h = harness()
    prompt(h.service, 's1', 'x')
    h.clock.t += 3_000
    h.service.onHook({ sessionId: 's1', event: 'Stop' })
    expect(h.service.get('s1')[0]).toMatchObject({ end: 'finished', endedAt: NOW + 3_000 })
  })

  it('without a running turn does nothing and reports no change', () => {
    const h = harness()
    h.service.onHook({ sessionId: 's1', event: 'Stop' })
    expect(h.service.get('s1')).toEqual([])
    expect(h.onChange).not.toHaveBeenCalled()
  })
})

describe('onHook AgentSession', () => {
  it('is ignored by the timeline', () => {
    const h = harness()
    h.service.onHook({ sessionId: 's1', event: 'AgentSession', message: 'ses_abc12345' })
    expect(h.service.get('s1')).toEqual([])
    expect(h.onChange).not.toHaveBeenCalled()
  })
})

describe('onSessionEnded', () => {
  it.each(['closed', 'exited', 'slept'] as const)('ends the running turn with %s', (end) => {
    const h = harness()
    prompt(h.service, 's1', 'x')
    h.service.onSessionEnded('s1', end)
    expect(h.service.get('s1')[0]).toMatchObject({ end, endedAt: NOW })
  })

  it('a slept session records the sleep time even when no turn was running', () => {
    const h = harness()
    h.clock.t += 500
    h.service.onSessionEnded('s1', 'slept')
    expect(h.service.lastSleptAt('s1')).toBe(NOW + 500)
    expect(h.service.get('s1')).toEqual([])
    expect(h.onChange).toHaveBeenCalledWith('s1')
  })

  it('a closed session does not record a sleep time', () => {
    const h = harness()
    h.service.onSessionEnded('s2', 'closed')
    expect(h.service.lastSleptAt('s2')).toBeNull()
  })

  it('with no running turn and no sleep does nothing and reports no change', () => {
    const h = harness()
    h.service.onSessionEnded('s1', 'exited')
    expect(h.onChange).not.toHaveBeenCalled()
  })
})

describe('onUsageLimit', () => {
  it('ends the running turn as limit', () => {
    const h = harness()
    prompt(h.service, 's1', 'x')
    h.service.onUsageLimit('s1')
    expect(h.service.get('s1')[0].end).toBe('limit')
  })

  it('is a no-op when no turn is running', () => {
    const h = harness()
    h.service.onUsageLimit('s1')
    expect(h.onChange).not.toHaveBeenCalled()
  })
})

describe('cost of a turn', () => {
  it('is the session cost delta since the turn started', () => {
    const h = harness(10)
    prompt(h.service, 's1', 'x')
    h.cost.value = 12.5
    h.service.onCostChanged('s1')
    expect(h.service.get('s1')[0].costUsd).toBeCloseTo(2.5)
  })

  it('is clamped to 0 when the session cost goes down', () => {
    const h = harness(5)
    prompt(h.service, 's1', 'x')
    h.cost.value = 3
    h.service.onCostChanged('s1')
    expect(h.service.get('s1')[0].costUsd).toBe(0)
  })

  it('stays null when the cost is unknown at the start', () => {
    const h = harness(null)
    prompt(h.service, 's1', 'x')
    h.cost.value = 4
    h.service.onCostChanged('s1')
    expect(h.service.get('s1')[0].costUsd).toBeNull()
  })

  it('becomes null when the cost is unknown now', () => {
    const h = harness(1)
    prompt(h.service, 's1', 'x')
    h.cost.value = null
    h.service.onCostChanged('s1')
    expect(h.service.get('s1')[0].costUsd).toBeNull()
  })

  it('still updates within COST_SETTLE_MS after the turn ended', () => {
    const h = harness(1)
    prompt(h.service, 's1', 'x')
    h.cost.value = 1.5
    h.service.onHook({ sessionId: 's1', event: 'Stop' })
    h.clock.t += 60_000
    h.cost.value = 2
    h.service.onCostChanged('s1')
    expect(h.service.get('s1')[0].costUsd).toBeCloseTo(1)
  })

  it('no longer updates after COST_SETTLE_MS after the turn ended', () => {
    const h = harness(1)
    prompt(h.service, 's1', 'x')
    h.service.onHook({ sessionId: 's1', event: 'Stop' })
    h.clock.t += COST_SETTLE_MS + 1
    h.cost.value = 9
    h.service.onCostChanged('s1')
    expect(h.service.get('s1')[0].costUsd).toBe(0)
  })

  it('a late cost after the next prompt stays on the old turn until its Stop, then the new turn starts from the cursor', () => {
    const h = harness(1)
    prompt(h.service, 's1', 'A')
    h.cost.value = 2
    h.clock.t += 1000
    prompt(h.service, 's1', 'B')
    // The old turn's final cost is reported after the new prompt.
    h.clock.t += 1000
    h.cost.value = 4
    h.service.onCostChanged('s1')
    let [b, a] = h.service.get('s1')
    expect(a.costUsd).toBeCloseTo(3)
    expect(b.costUsd).toBeNull()

    // A's Stop arrives: it settles A (no new cost) and B becomes the cost target from the current total.
    h.clock.t += 1000
    h.service.onHook({ sessionId: 's1', event: 'Stop' })
    ;[b, a] = h.service.get('s1')
    expect(a.costUsd).toBeCloseTo(3)
    expect(b.endedAt).toBeNull()
    h.cost.value = 6
    h.service.onCostChanged('s1')
    ;[b, a] = h.service.get('s1')
    expect(a.costUsd).toBeCloseTo(3)
    expect(b.costUsd).toBeCloseTo(2)
  })

  it('a late Stop ends the old turn (not the new one) at the Stop arrival', () => {
    const h = harness(0)
    prompt(h.service, 's1', 'A')
    h.clock.t += 1000
    const aStarted = h.service.get('s1')[0].startedAt
    prompt(h.service, 's1', 'B')
    expect(h.service.get('s1')[0].endedAt).toBeNull()
    expect(h.service.get('s1')[1].endedAt).toBe(NOW + 1000)
    h.clock.t += 5000
    h.service.onHook({ sessionId: 's1', event: 'Stop' })
    const [b, a] = h.service.get('s1')
    expect(a.endedAt).toBe(NOW + 6000)
    expect(a.startedAt).toBe(aStarted)
    expect(b.endedAt).toBeNull()
    expect(b.end).toBeNull()
  })

  it('two out-of-order Stops settle in prompt order and leave the newest turn running', () => {
    const h = harness(0)
    prompt(h.service, 's1', 'A')
    h.clock.t += 1000
    prompt(h.service, 's1', 'B')
    h.clock.t += 1000
    prompt(h.service, 's1', 'C')
    h.clock.t += 1000
    h.service.onHook({ sessionId: 's1', event: 'Stop' })
    let [c, b, a] = h.service.get('s1')
    expect(a.endedAt).toBe(NOW + 3000)
    expect(b.endedAt).toBe(NOW + 2000)
    expect(c.endedAt).toBeNull()
    h.clock.t += 1000
    h.service.onHook({ sessionId: 's1', event: 'Stop' })
    ;[c, b, a] = h.service.get('s1')
    expect(b.endedAt).toBe(NOW + 4000)
    expect(c.endedAt).toBeNull()
    h.clock.t += 1000
    h.service.onHook({ sessionId: 's1', event: 'Stop' })
    expect(h.service.get('s1')[0].endedAt).toBe(NOW + 5000)
  })

  it('a cost read that throws is reported and the cost becomes null', () => {
    const h = harness(0)
    const failure = new Error('cost read failed')
    const clock: Clock = { t: NOW }
    const failing = makeService(path.join(h.dir, 'other.json'), clock, { value: 0 }, {
      getSessionCost: () => {
        throw failure
      }
    })
    prompt(failing.service, 's1', 'x')
    expect(failing.onError).toHaveBeenCalledWith('timeline cost', failure)
    expect(failing.service.get('s1')[0].costUsd).toBeNull()
  })
})

describe('get / all / forget', () => {
  it('get returns one session newest first and all() returns every session newest first', () => {
    const h = harness()
    prompt(h.service, 's1', 'one')
    h.clock.t += 10
    prompt(h.service, 's2', 'two')
    h.clock.t += 10
    prompt(h.service, 's1', 'three')
    expect(h.service.get('s1').map((t) => t.prompt)).toEqual(['three', 'one'])
    expect(h.service.all().map((t) => t.prompt)).toEqual(['three', 'two', 'one'])
  })

  it('forget drops the session turns and its sleep time and reports the change', () => {
    const h = harness()
    prompt(h.service, 's1', 'x')
    h.service.onSessionEnded('s1', 'slept')
    h.onChange.mockClear()
    h.service.forget('s1')
    expect(h.service.get('s1')).toEqual([])
    expect(h.service.lastSleptAt('s1')).toBeNull()
    expect(h.onChange).toHaveBeenCalledWith('s1')
  })

  it('forget of an unknown session is a no-op', () => {
    const h = harness()
    h.service.forget('nobody')
    expect(h.onChange).not.toHaveBeenCalled()
  })
})

describe('load', () => {
  it('loads the turns saved in the file', async () => {
    const h = harness()
    writeFileSync(
      h.filePath,
      serializeTimelineFile([
        { id: 'a', sessionId: 's1', prompt: 'old', startedAt: NOW - 1000, endedAt: NOW - 500, end: 'finished', costUsd: 0.1, neededYou: false }
      ]),
      'utf-8'
    )
    await h.service.load()
    expect(h.service.get('s1').map((t) => t.prompt)).toEqual(['old'])
    expect(h.onError).not.toHaveBeenCalled()
  })

  it('a sleep recorded before a restart is still known (away summary input)', async () => {
    const h = harness()
    await h.service.load()
    h.service.onSessionEnded('s1', 'slept')
    const sleptAt = h.service.lastSleptAt('s1')
    expect(sleptAt).toBe(NOW)
    await h.service.flush()

    // A second service instance over the same file (the app was restarted).
    const restarted = makeService(h.filePath, h.clock, h.cost)
    await restarted.service.load()
    expect(restarted.service.lastSleptAt('s1')).toBe(NOW)
    expect(restarted.onError).not.toHaveBeenCalled()
  })

  it('a turn saved while running comes back as exited', async () => {
    const h = harness(0)
    await h.service.load()
    prompt(h.service, 's1', 'mid run')
    await h.service.flush()

    const clock: Clock = { t: NOW + 99_999 }
    const restarted = makeService(h.filePath, clock, { value: 0 })
    await restarted.service.load()
    const [turn] = restarted.service.get('s1')
    expect(turn).toMatchObject({ prompt: 'mid run', end: 'exited', endedAt: NOW })
  })

  it('drops turns older than TIMELINE_MAX_AGE_DAYS on load', async () => {
    const h = harness()
    const old = NOW - (TIMELINE_MAX_AGE_DAYS + 1) * DAY_MS
    writeFileSync(
      h.filePath,
      serializeTimelineFile([
        { id: 'old', sessionId: 's1', prompt: 'old', startedAt: old, endedAt: old + 1, end: 'finished', costUsd: null, neededYou: false },
        { id: 'new', sessionId: 's1', prompt: 'new', startedAt: NOW - 1000, endedAt: NOW - 500, end: 'finished', costUsd: null, neededYou: false }
      ]),
      'utf-8'
    )
    await h.service.load()
    expect(h.service.get('s1').map((t) => t.id)).toEqual(['new'])
  })

  it('a corrupt file loads as an empty timeline and reports the error', async () => {
    const h = harness()
    writeFileSync(h.filePath, '{ broken', 'utf-8')
    await h.service.load()
    expect(h.service.all()).toEqual([])
    expect(h.onError).toHaveBeenCalledWith('timeline load', expect.any(Error))
  })

  it('a missing file loads as an empty timeline without an error', async () => {
    const h = harness()
    await h.service.load()
    expect(h.service.all()).toEqual([])
    expect(h.onError).not.toHaveBeenCalled()
  })

  it('does not report loaded turns as changes', async () => {
    const h = harness()
    writeFileSync(h.filePath, serializeTimelineFile([]), 'utf-8')
    await h.service.load()
    expect(h.onChange).not.toHaveBeenCalled()
  })

  it('does not write the file before it was loaded (flush is a no-op)', async () => {
    const h = harness()
    prompt(h.service, 's1', 'x')
    await h.service.flush()
    expect(existsSync(h.filePath)).toBe(false)
  })
})

describe('saving', () => {
  it('schedules a debounced save: a burst of changes leaves one pending timer', async () => {
    const h = harness()
    await h.service.load()
    prompt(h.service, 's1', 'a')
    prompt(h.service, 's1', 'b')
    prompt(h.service, 's1', 'c')
    expect(h.timers.size).toBe(1)
    expect(existsSync(h.filePath)).toBe(false)

    fireSaveTimers(h.timers)
    await h.service.flush()
    const saved = parseTimelineFile(JSON.parse(readFileSync(h.filePath, 'utf-8')), NOW)
    expect(saved?.map((t) => t.prompt).sort()).toEqual(['a', 'b', 'c'])
  })

  it('flush writes now and clears the pending timer', async () => {
    const h = harness()
    await h.service.load()
    prompt(h.service, 's1', 'now')
    expect(h.timers.size).toBe(1)
    await h.service.flush()
    expect(h.timers.size).toBe(0)
    expect(existsSync(h.filePath)).toBe(true)
  })

  it('a cost refresh that changes nothing schedules no save and reports no change', async () => {
    const h = harness(2)
    await h.service.load()
    prompt(h.service, 's1', 'x')
    await h.service.flush()
    expect(h.timers.size).toBe(0)
    h.onChange.mockClear()

    h.service.onCostChanged('s1')

    expect(h.timers.size).toBe(0)
    expect(h.onChange).not.toHaveBeenCalled()
  })

  it('a save failure is reported through onError and does not throw', async () => {
    const h = harness()
    await h.service.load()
    const blocker = path.join(h.dir, 'blocker')
    writeFileSync(blocker, 'a file, not a folder', 'utf-8')
    const blocked = makeService(path.join(blocker, 'timeline.json'), { t: NOW }, { value: 0 })
    await blocked.service.load()
    prompt(blocked.service, 's1', 'x')
    await expect(blocked.service.flush()).resolves.toBeUndefined()
    expect(blocked.onError).toHaveBeenCalledWith('timeline save', expect.any(Error))
  })

  it('a failing onChange is reported and the change is still kept', () => {
    const h = harness()
    const failure = new Error('listener broke')
    const failing = makeService(path.join(h.dir, 'x.json'), { t: NOW }, { value: 0 }, {
      onChange: () => {
        throw failure
      }
    })
    expect(() => prompt(failing.service, 's1', 'kept')).not.toThrow()
    expect(failing.onError).toHaveBeenCalledWith('timeline change', failure)
    expect(failing.service.get('s1').map((t: TimelineTurn) => t.prompt)).toEqual(['kept'])
  })
})
