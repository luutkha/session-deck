import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeState, Session, StoreData, TimelineTurn } from '../../shared/types'
import type { JarvisToolDeps } from './jarvisTools'
import type { ToolContext } from './appTools'
import { readUncommittedPaths } from '../git'
import {
  clipToEnd,
  collectFleetDigest,
  createDigestTools,
  DIGEST_MAX_CHARS,
  formatFleetDigest,
  timeInState,
  type FleetDigestRow
} from './digestTools'

// The digest is read-only, but it does ask git for the uncommitted count. The fake keeps unit tests free of processes.
vi.mock('../git', () => ({ readUncommittedPaths: vi.fn(async () => new Set<string>()) }))

const NOW = 1_700_000_000_000
const MIN = 60_000
const HOUR = 60 * MIN

function row(name: string, extra: Partial<FleetDigestRow> = {}): FleetDigestRow {
  return {
    name,
    agent: 'claude',
    state: 'running, idle',
    since: NOW - MIN,
    waiting: false,
    question: null,
    lastPrompt: null,
    reply: '',
    costTodayUsd: null,
    uncommitted: null,
    working: false,
    queued: 0,
    ...extra
  }
}

// ---------- the pure formatter

describe('formatFleetDigest (pure)', () => {
  it('has a message for an empty fleet and for "nothing needs you"', () => {
    expect(formatFleetDigest({ now: NOW, rows: [] })).toBe('No sessions to report.')
    expect(formatFleetDigest({ now: NOW, rows: [row('API')], onlyNeedingAttention: true }))
      .toBe('Nothing needs the user right now: every session is running or idle.')
  })

  it('orders needs-you first, then working, then idle: the most stuck first, idle freshest first', () => {
    const text = formatFleetDigest({
      now: NOW,
      rows: [
        row('idle-old', { since: NOW - 900_000 }),
        row('working-new', { working: true, since: NOW - MIN }),
        row('waiting-new', { waiting: true, since: NOW - MIN }),
        row('waiting-old', { waiting: true, since: NOW - 10 * MIN }),
        row('working-old', { working: true, since: NOW - 10 * MIN }),
        row('idle-new', { since: NOW - MIN })
      ]
    })
    const order = ['waiting-old', 'waiting-new', 'working-old', 'working-new', 'idle-new', 'idle-old']
    const positions = order.map((name) => text.indexOf(`"${name}"`))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(text.split('\n')[0]).toBe('Fleet digest: 6 session(s) · 2 need you · 2 working · 2 idle')
  })

  it('shows the state with its duration, the pending question once, and the last prompt', () => {
    const text = formatFleetDigest({
      now: NOW,
      rows: [row('Web', {
        waiting: true,
        state: 'running, WAITING FOR AN ANSWER',
        question: 'Claude needs your permission to use Bash',
        since: NOW - 3 * MIN,
        lastPrompt: 'fix the login'
      })]
    })
    expect(text).toContain('"Web" (claude) · running, WAITING FOR AN ANSWER for 3 min')
    expect(text).toContain('needs you: "Claude needs your permission to use Bash"')
    expect(text.match(/needs your permission/g)).toHaveLength(1)
    expect(text).toContain('last prompt: "fix the login"')
  })

  it('clips the question and the prompt to their limits', () => {
    const text = formatFleetDigest({
      now: NOW,
      rows: [row('A', { waiting: true, question: 'q'.repeat(400), lastPrompt: 'p'.repeat(400) })]
    })
    const question = /needs you: "(.*)"/.exec(text)?.[1] ?? ''
    const prompt = /last prompt: "(.*)"/.exec(text)?.[1] ?? ''
    expect(question).toHaveLength(160)
    expect(question.endsWith('…')).toBe(true)
    expect(prompt).toHaveLength(120)
    expect(prompt.endsWith('…')).toBe(true)
  })

  it('keeps the END of the last reply, at most 240 characters, flattened', () => {
    const text = formatFleetDigest({
      now: NOW,
      rows: [row('A', { reply: `${'r'.repeat(600)}\n\n  ALL 214 TESTS PASS  ` })]
    })
    const reply = /reply: (.*)/.exec(text)?.[1] ?? ''
    expect(reply).toHaveLength(240)
    expect(reply.startsWith('…')).toBe(true)
    expect(reply.endsWith('ALL 214 TESTS PASS')).toBe(true)
  })

  it('adds the cost today, uncommitted files and the queue when known', () => {
    const line = formatFleetDigest({
      now: NOW,
      rows: [row('A', { costTodayUsd: 0.42, uncommitted: 3, queued: 2 })]
    }).split('\n')[1]
    expect(line).toBe('"A" (claude) · running, idle for 1 min · 2 queued · $0.42 today · 3 uncommitted')
  })

  it('only shows sessions that need the user when asked', () => {
    const text = formatFleetDigest({
      now: NOW,
      rows: [row('Waiting', { waiting: true }), row('Busy', { working: true }), row('Quiet')],
      onlyNeedingAttention: true
    })
    expect(text.split('\n')[0]).toBe('Fleet digest: 1 session(s) need you.')
    expect(text).toContain('"Waiting"')
    expect(text).not.toContain('"Busy"')
    expect(text).not.toContain('"Quiet"')
  })

  it('honours the limit and says how many it left out', () => {
    const rows = ['a', 'b', 'c', 'd', 'e', 'f'].map((name, i) => row(name, { since: NOW - (i + 1) * MIN }))
    const text = formatFleetDigest({ now: NOW, rows, limit: 2 })
    expect((text.match(/^"/gm) ?? [])).toHaveLength(2)
    expect(text).toContain('(4 more session(s) not shown; the limit is 2.')
  })

  it('caps the whole answer at 6000 characters and reports the cut count', () => {
    const rows = Array.from({ length: 120 }, (_, i) => row(`session-${i}`, {
      since: NOW - i * MIN,
      lastPrompt: 'p'.repeat(400),
      reply: 'r'.repeat(800)
    }))
    const text = formatFleetDigest({ now: NOW, rows })
    expect(text.length).toBeLessThanOrEqual(DIGEST_MAX_CHARS)
    const cut = Number(/\((\d+) more session\(s\) not shown/.exec(text)?.[1] ?? 0)
    const shown = (text.match(/^"/gm) ?? []).length
    expect(cut).toBeGreaterThan(0)
    expect(shown + cut).toBe(120)
    expect(text).toContain(`the digest stops at ${DIGEST_MAX_CHARS} characters`)
  })
})

describe('timeInState / clipToEnd', () => {
  it('reads like a person wrote it', () => {
    expect(timeInState(0)).toBe('under a minute')
    expect(timeInState(-5_000)).toBe('under a minute')
    expect(timeInState(12 * MIN + 30_000)).toBe('12 min')
    expect(timeInState(3 * HOUR + 20 * MIN)).toBe('3 h 20 min')
    expect(timeInState(24 * HOUR)).toBe('24 h')
    expect(timeInState(48 * HOUR)).toBe('2 days')
  })

  it('clips from the start, never past the limit', () => {
    expect(clipToEnd('  short\ttext ', 100)).toBe('short text')
    const clipped = clipToEnd(`${'x'.repeat(500)}END`, 240)
    expect(clipped).toHaveLength(240)
    expect(clipped.startsWith('…')).toBe(true)
    expect(clipped.endsWith('END')).toBe(true)
  })
})

// ---------- collecting from the app

const session = (id: string, name: string, extra: Partial<Session> = {}): Session => ({
  id, name, cwd: `C:/${id}`, groupId: null, statusId: null, order: 0, createdAt: 0, claudeArgs: [], ...extra
})

const running = (id: string, extra: Partial<RuntimeState> = {}): RuntimeState => ({
  sessionId: id, run: 'running', exitCode: null, attention: null, ...extra
})

const turn = (sessionId: string, startedAt: number, costUsd: number | null, prompt = ''): TimelineTurn => ({
  id: `${sessionId}-${startedAt}`, sessionId, prompt, startedAt, endedAt: startedAt + 1000, end: 'finished', costUsd, neededYou: false
})

interface FakeFleet {
  readonly sessions: readonly Session[]
  readonly runtime?: readonly RuntimeState[]
  readonly turns?: readonly TimelineTurn[]
  readonly answers?: Readonly<Record<string, string>>
  readonly screens?: Readonly<Record<string, string>>
  readonly starts?: Readonly<Record<string, number>>
  readonly outputs?: Readonly<Record<string, number>>
}

function depsOf(fake: FakeFleet): JarvisToolDeps {
  const states = new Map((fake.runtime ?? []).map((state) => [state.sessionId, state]))
  return {
    getData: () => ({ sessions: fake.sessions, groups: [], groupOrder: [], statuses: [] } as unknown as StoreData),
    getRuntime: (id: string) => states.get(id),
    timeline: (id: string) => (fake.turns ?? []).filter((t) => t.sessionId === id),
    allTurns: () => fake.turns ?? [],
    lastAnswer: async (s: Session) => fake.answers?.[s.id] ?? null,
    screenText: async (id: string) => fake.screens?.[id] ?? '',
    now: () => NOW,
    startedAt: (id: string) => fake.starts?.[id] ?? 0,
    lastOutputAt: (id: string) => fake.outputs?.[id] ?? 0
  } as unknown as JarvisToolDeps
}

describe('collectFleetDigest', () => {
  it('collects one block per session, leaves Jarvis out, and counts only today\'s known costs', async () => {
    const midnight = new Date(NOW).setHours(0, 0, 0, 0)
    const deps = depsOf({
      sessions: [session('a', 'API'), session('j', 'Jarvis', { role: 'jarvis' })],
      runtime: [running('a', { activity: 'working', activityAt: NOW - 12 * MIN })],
      turns: [turn('a', midnight - HOUR, 5, 'yesterday'), turn('a', NOW - 10 * MIN, 0.25, 'run the tests')],
      answers: { a: 'All green: 214 tests pass.' },
      starts: { a: NOW - HOUR }
    })
    const text = await collectFleetDigest(deps, {}, async () => 3)
    expect(text.split('\n')[0]).toBe('Fleet digest: 1 session(s) · 0 need you · 1 working · 0 idle')
    expect(text).not.toContain('Jarvis')
    expect(text).toContain('"API" (claude) · running, working on a turn for 12 min · $0.25 today · 3 uncommitted')
    expect(text).toContain('last prompt: "run the tests"')
    expect(text).toContain('reply: All green: 214 tests pass.')
  })

  it('marks a real question as needing the user once, and keeps the idle reminder out of it', async () => {
    const asking = await collectFleetDigest(depsOf({
      sessions: [session('a', 'Web')],
      runtime: [running('a', { activity: 'needs-input', activityMessage: 'Claude needs your permission to use Bash', attention: 'permission', attentionAt: NOW - 3 * MIN })]
    }), {}, async () => null)
    expect(asking).toContain('running, WAITING FOR AN ANSWER for 3 min')
    expect(asking).toContain('needs you: "Claude needs your permission to use Bash"')
    expect(asking.match(/needs your permission/g)).toHaveLength(1)

    const idle = await collectFleetDigest(depsOf({
      sessions: [session('a', 'Web')],
      runtime: [running('a', { activity: 'needs-input', activityMessage: 'Claude is waiting for your input' })]
    }), {}, async () => null)
    expect(idle).toContain('"Web" (claude) · running, idle')
    expect(idle).not.toContain('needs you:')
    expect(idle.split('\n')[0]).toBe('Fleet digest: 1 session(s) · 0 need you · 0 working · 1 idle')
  })

  it('shows a closed session as closed, asleep/stopped ones by their quiet time', async () => {
    const text = await collectFleetDigest(depsOf({
      sessions: [session('c', 'Closed', { closedAt: NOW - 3 * 24 * HOUR }), session('s', 'Asleep')],
      runtime: [running('s', { sleeping: true })],
      outputs: { s: NOW - 20 * MIN }
    }), {}, async () => null)
    expect(text).toContain('"Closed" (claude) · closed for 3 days')
    expect(text).toContain('"Asleep" (claude) · sleeping for 20 min')
  })

  it('falls back to the screen for OpenCode, shell and a Claude session without a saved conversation', async () => {
    const text = await collectFleetDigest(depsOf({
      sessions: [session('o', 'OpenCode one', { agent: 'opencode' }), session('h', 'Shell one', { agent: 'shell' }), session('c', 'Claude one')],
      runtime: [running('o', { activity: 'finished' }), running('h'), running('c', { activity: 'finished' })],
      screens: { o: 'old question\nDone: 3 files changed', h: '$ npm test\nall green', c: 'Claude screen tail' }
    }), {}, async () => null)
    expect(text).toContain('"OpenCode one" (opencode)')
    expect(text).toContain('reply: old question Done: 3 files changed')
    expect(text).toContain('"Shell one" (shell)')
    expect(text).toContain('reply: $ npm test all green')
    expect(text).toContain('reply: Claude screen tail')
  })

  it('says nothing about uncommitted files when the folder is not a git repository', async () => {
    const text = await collectFleetDigest(depsOf({ sessions: [session('a', 'API')] }), {}, async () => {
      throw new Error('Not a git repository: C:/a')
    })
    expect(text).toContain('"API" (claude)')
    expect(text).not.toContain('uncommitted')
  })

  it('skips the reply and git reads of sessions it will not print', async () => {
    const uncommitted = vi.fn(async () => 1)
    const text = await collectFleetDigest(depsOf({
      sessions: [session('a', 'Waiting'), session('b', 'Idle')],
      runtime: [running('a', { attention: 'permission' }), running('b', { activity: 'finished' })]
    }), { onlyNeedingAttention: true }, uncommitted)
    expect(text).toContain('"Waiting"')
    expect(text).not.toContain('"Idle"')
    expect(uncommitted).toHaveBeenCalledTimes(1)
    expect(uncommitted).toHaveBeenCalledWith('C:/a')
  })
})

// ---------- the MCP tool

describe('fleet_digest tool', () => {
  beforeEach(() => {
    vi.mocked(readUncommittedPaths).mockResolvedValue(new Set<string>())
  })

  const tools = (fake: FakeFleet): ReturnType<typeof createDigestTools> =>
    createDigestTools(depsOf(fake), {} as unknown as ToolContext)

  it('is one read-only tool with the two optional arguments', () => {
    const [tool] = tools({ sessions: [] })
    expect(tool.name).toBe('fleet_digest')
    expect(tool.description).toContain('Sessions that need the user come first')
    expect(tool.description).toContain(String(DIGEST_MAX_CHARS))
    const schema = tool.inputSchema as { properties: Record<string, { type?: string }>; required: string[] }
    expect(schema.required).toEqual([])
    expect(schema.properties['only_needing_attention'].type).toBe('boolean')
    expect(schema.properties['limit'].type).toBe('integer')
  })

  it('answers with the digest, reading the uncommitted count through the git helper', async () => {
    vi.mocked(readUncommittedPaths).mockResolvedValue(new Set(['a.ts', 'b.ts']))
    const [tool] = tools({
      sessions: [session('a', 'API')],
      runtime: [running('a', { activity: 'working', activityAt: NOW - MIN })],
      turns: [turn('a', NOW - 30_000, 0.5, 'go')]
    })
    const text = await tool.run({})
    expect(readUncommittedPaths).toHaveBeenCalledWith('C:/a')
    expect(text).toContain('"API" (claude) · running, working on a turn for 1 min · $0.50 today · 2 uncommitted')
  })

  it('passes only_needing_attention and limit through, and refuses wrong types', async () => {
    const fake: FakeFleet = {
      sessions: [session('a', 'Waiting'), session('b', 'Idle')],
      runtime: [running('a', { attention: 'done', attentionAt: NOW - MIN }), running('b', { activity: 'finished' })]
    }
    const [tool] = tools(fake)
    const only = await tool.run({ only_needing_attention: true })
    expect(only).toContain('"Waiting"')
    expect(only).not.toContain('"Idle"')

    const limited = await tool.run({ limit: 1 })
    expect((limited.match(/^"/gm) ?? [])).toHaveLength(1)
    expect(limited).toContain('(1 more session(s) not shown; the limit is 1.')

    await expect(tool.run({ only_needing_attention: 'yes' })).rejects.toThrow('"only_needing_attention" must be true or false.')
    await expect(tool.run({ limit: 0 })).rejects.toThrow('"limit" must be a positive whole number.')
    await expect(tool.run({ limit: 1.5 })).rejects.toThrow('"limit" must be a positive whole number.')
  })
})
