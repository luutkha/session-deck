import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PLUGIN_DIR_NAME, PLUGIN_USAGE_THROTTLE_MS, PLUGIN_FETCH_TIMEOUT_MS, MAX_PLUGIN_NOTICE_LENGTH, buildOpencodePluginSource } from './pluginSource'

interface FetchCall {
  readonly url: string
  readonly init: {
    readonly method: string
    readonly headers: Record<string, string>
    readonly body: string
  }
}

interface PluginModule {
  id: string
  setup: (context: unknown) => Promise<unknown>
}

interface Instance {
  feed: AsyncIterable<unknown> & { push(value: unknown): void }
  cleanup: unknown
}

// Inside the project root (vitest cannot dynamically import files under the OS temp dir).
const dir = mkdtempSync(join(process.cwd(), 'sessiondeck-ocplugin-test-'))
const pluginPath = join(dir, PLUGIN_DIR_NAME, 'index.mjs')

let pluginModule: PluginModule

beforeAll(async () => {
  mkdirSync(join(dir, PLUGIN_DIR_NAME), { recursive: true })
  writeFileSync(pluginPath, buildOpencodePluginSource(), 'utf8')
  const mod = (await import(pathToFileURL(pluginPath).href)) as { default: PluginModule }
  pluginModule = mod.default
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

const ev = (type: string, data: unknown): unknown => ({ type, data })
const evProps = (type: string, properties: unknown): unknown => ({ type, properties })

/** A manual event feed like OpenCode's context.event.subscribe() AsyncIterable. */
function createFeed(): Instance['feed'] {
  const queue: unknown[] = []
  let resolver: ((result: IteratorResult<unknown>) => void) | null = null
  const feed: AsyncIterable<unknown> & { push(value: unknown): void } = {
    push(value: unknown) {
      if (resolver) {
        const resolve = resolver
        resolver = null
        resolve({ value, done: false })
      } else {
        queue.push(value)
      }
    },
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<unknown>> {
          if (queue.length > 0) return Promise.resolve({ value: queue.shift(), done: false })
          return new Promise((resolve) => {
            resolver = resolve
          })
        },
        return(): Promise<IteratorResult<unknown>> {
          return Promise.resolve({ value: undefined, done: true })
        }
      }
    }
  }
  return feed
}

const settle = async (): Promise<void> => {
  // Enough microtask ticks for: stream delivery -> for-await continuation -> the ordered fetch chain.
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

function stubPluginEnv(env: Record<string, string | undefined>): void {
  for (const key of ['SESSIONDECK_PORT', 'SESSIONDECK_SESSION_ID', 'SESSIONDECK_TOKEN']) {
    vi.stubEnv(key, env[key])
  }
}

const BASE_ENV: Record<string, string> = {
  SESSIONDECK_PORT: '4123',
  SESSIONDECK_SESSION_ID: 'deck-sess',
  SESSIONDECK_TOKEN: 'tok'
}

/** The plugin reports this process pid in every body (`proc`, same process as the test that imported it). */
const PROC = String(process.pid)

/** One persistent capture buffer: the spying fetch keeps appending, `captureFetch()` resets it. */
const fetchCalls: FetchCall[] = []

function installCaptureSpy(): void {
  const fake = vi.fn((_url: string | URL, init?: unknown): Promise<unknown> => {
    const typed = init as FetchCall['init']
    fetchCalls.push({
      url: String(_url),
      init: {
        method: typed.method,
        headers: typed.headers,
        body: typed.body
      }
    })
    return Promise.resolve({ status: 204 })
  })
  vi.stubGlobal('fetch', fake)
}

/** Re-arms the capturing spy (unless a test installed its own fetch) and resets the buffer when asked. */
function captureFetch(reset = true): FetchCall[] {
  installCaptureSpy()
  if (reset) fetchCalls.length = 0
  return fetchCalls
}

/** The fetch calls captured since the given position (per-`send` windows). */
function callsSince(n: number): FetchCall[] {
  return fetchCalls.slice(n)
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/** Starts a fresh plugin instance (its own subscription); returns the feed and posts fetch calls sent since. */
async function instance(env: Record<string, string | undefined> = BASE_ENV): Promise<Instance> {
  stubPluginEnv(env)
  const feed = createFeed()
  const cleanup = await pluginModule.setup({ location: { directory: 'C:\\proj' }, event: { subscribe: async () => feed } })
  await settle()
  captureFetch()
  return { feed, cleanup: cleanup ?? null }
}

async function send(instance_: Instance, event: unknown): Promise<FetchCall[]> {
  const before = fetchCalls.length
  instance_.feed.push(event)
  await settle()
  return callsSince(before)
}

describe('opencode plugin module shape (OpenCode v2 plugin contract)', () => {
  it('exports a default definition with an id and an async setup', async () => {
    expect(pluginModule.id).toBeTypeOf('string')
    expect(pluginModule.id.length).toBeGreaterThan(0)
    expect(pluginModule.setup).toBeTypeOf('function')
  })

  it('setup returns undefined (no subscription) without the OpenCode event stream', async () => {
    stubPluginEnv(BASE_ENV)
    expect(await pluginModule.setup({ event: {} })).toBeUndefined()
    expect(await pluginModule.setup({})).toBeUndefined()
    expect(await pluginModule.setup(undefined)).toBeUndefined()
  })
})

describe('opencode plugin availability gate', () => {
  it('does nothing when SESSIONDECK_PORT is missing', async () => {
    expect((await instance({ ...BASE_ENV, SESSIONDECK_PORT: undefined })).cleanup).toBeNull()
  })

  it('does nothing when SESSIONDECK_SESSION_ID is missing', async () => {
    expect((await instance({ ...BASE_ENV, SESSIONDECK_SESSION_ID: undefined })).cleanup).toBeNull()
  })

  it('does nothing when SESSIONDECK_TOKEN is missing', async () => {
    expect((await instance({ ...BASE_ENV, SESSIONDECK_TOKEN: undefined })).cleanup).toBeNull()
  })
})

describe('opencode plugin event mapping (all posts carry the token header and JSON body)', () => {
  it('session.created of a top-level session posts AgentSession with the sessionID (v2 .data shape)', async () => {
    const plugin = await instance()
    const calls = await send(plugin, ev('session.created', { sessionID: 'ses_abcdef12345678TOP' }))
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://127.0.0.1:4123/hook/deck-sess/AgentSession')
    expect(JSON.parse(calls[0].init.body)).toEqual({ session_id: 'ses_abcdef12345678TOP', proc: PROC })
    expect(calls[0].init.headers['x-token']).toBe('tok')
    expect(calls[0].init.headers['content-type']).toBe('application/json')
    expect(calls[0].init.method).toBe('POST')
  })

  it('session.created falls back to the v1 properties.info shape', async () => {
    const plugin = await instance()
    const calls = await send(plugin, evProps('session.created', { info: { id: 'ses_abcdef12345678v1' } }))
    expect(JSON.parse(calls[0].init.body)).toEqual({ session_id: 'ses_abcdef12345678v1', proc: PROC })
  })

  it('session.created of a sub-agent session (data.parentID set) is ignored', async () => {
    const plugin = await instance()
    const calls = await send(plugin, ev('session.created', { sessionID: 'ses_abcdef12345678SUB', parentID: 'ses_parent12345678' }))
    expect(calls).toHaveLength(0)
  })

  it('session.created of a v1 sub-agent session (info.parentID set) is ignored', async () => {
    const plugin = await instance()
    const calls = await send(plugin, evProps('session.created', { info: { id: 'ses_abcdef12345678SUB', parentID: 'ses_parent12345678' } }))
    expect(calls).toHaveLength(0)
  })

  it('session.status busy fires UserPromptSubmit once per turn; idle resets the transition', async () => {
    const plugin = await instance()
    const calls = await send(plugin, ev('session.status', { status: { type: 'busy' } }))
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://127.0.0.1:4123/hook/deck-sess/UserPromptSubmit')
    expect(JSON.parse(calls[0].init.body)).toEqual({ proc: PROC })

    // A repeated busy status is NOT a new turn.
    expect(await send(plugin, ev('session.status', { status: { type: 'busy' } }))).toHaveLength(0)

    // Idle resets the transition.
    await send(plugin, ev('session.idle', {}))
    expect(await send(plugin, ev('session.status', { status: { type: 'busy' } }))).toHaveLength(1)
  })

  it('v1 data.status payload still triggers the busy transition', async () => {
    const plugin = await instance()
    const calls = await send(plugin, ev('session.status', { sessionID: 'ses_x', status: { type: 'busy' } }))
    expect(calls).toHaveLength(1)
  })

  it('session.execution.started (the v2 run variant) fires the busy transition exactly once per turn', async () => {
    const plugin = await instance()
    const first = await send(plugin, ev('session.execution.started', { sessionID: 'ses_x' }))
    expect(first).toHaveLength(1)
    expect(first[0].url).toBe('http://127.0.0.1:4123/hook/deck-sess/UserPromptSubmit')

    // Repeated execution starts within the same turn are not new prompts...
    expect(await send(plugin, ev('session.execution.started', { sessionID: 'ses_x' }))).toHaveLength(0)
    // ...nor a mix of both variants (status.busy + execution.started).
    expect(await send(plugin, ev('session.status', { status: { type: 'busy' } }))).toHaveLength(0)
  })

  it('posts at most one Stop per turn no matter which end event variants arrive', async () => {
    const plugin = await instance()
    await send(plugin, ev('session.execution.started', { sessionID: 'ses_x' }))
    const first = await send(plugin, ev('session.execution.succeeded', { sessionID: 'ses_x' }))
    expect(first).toHaveLength(1)
    expect(first[0].url).toBe('http://127.0.0.1:4123/hook/deck-sess/Stop')

    // Duplicated end signals within the same turn (v1 idle + v2 execution end).
    expect(await send(plugin, ev('session.idle', {}))).toHaveLength(0)

    // The next turn posts a new Stop.
    const beforeSecond = fetchCalls.length
    await send(plugin, ev('session.execution.started', { sessionID: 'ses_x' }))
    await send(plugin, ev('session.execution.failed', { sessionID: 'ses_x' }))
    expect(callsSince(beforeSecond).filter((c) => c.url.endsWith('/Stop'))).toHaveLength(1)
  })

  it('session.execution.interrupted also settles the turn with one Stop', async () => {
    const plugin = await instance()
    await send(plugin, ev('session.execution.started', { sessionID: 'ses_x' }))
    const calls = await send(plugin, ev('session.execution.interrupted', { sessionID: 'ses_x' }))
    expect(calls.filter((c) => c.url.endsWith('/Stop'))).toHaveLength(1)
  })

  it('permission.asked posts Notification with the action and command, capped and trimmed (v2 shape)', async () => {
    const plugin = await instance()
    const calls = await send(plugin, ev('permission.asked', {
      sessionID: 'ses_abcdef12345678TOP',
      action: 'bash',
      resources: ['echo hi'],
      metadata: { command: 'echo hi' }
    }))
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://127.0.0.1:4123/hook/deck-sess/Notification')
    expect(JSON.parse(calls[0].init.body)).toEqual({ message: 'Permission needed: bash (echo hi)', proc: PROC })
  })

  it('permission.asked falls back to the v1 properties.permission shape', async () => {
    const plugin = await instance()
    const calls = await send(plugin, evProps('permission.asked', {
      permission: 'bash',
      pattern: 'echo hi',
      metadata: {}
    }))
    expect(JSON.parse(calls[0].init.body).message).toBe('Permission needed: bash (echo hi)')
  })

  it('permission.asked without any recognizable text still posts a short message at most 200 chars', async () => {
    const plugin = await instance()
    const calls = await send(plugin, ev('permission.asked', { metadata: {} }))
    const message = JSON.parse(calls[0].init.body).message as string
    expect(message.length).toBeGreaterThan(0)
    expect(message.length).toBeLessThanOrEqual(MAX_PLUGIN_NOTICE_LENGTH)
  })

  it('a very long permission text is truncated to 200 characters', async () => {
    const plugin = await instance()
    const calls = await send(plugin, ev('permission.asked', {
      action: 'bash',
      metadata: { command: 'x'.repeat(500) }
    }))
    expect(JSON.parse(calls[0].init.body).message).toHaveLength(MAX_PLUGIN_NOTICE_LENGTH)
  })

  it('question.asked posts Notification (defensive: event documented, not yet observed)', async () => {
    const plugin = await instance()
    const calls = await send(plugin, evProps('question.asked', { question: 'First or second?' }))
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0].init.body)).toEqual({ message: 'Permission needed: First or second?', proc: PROC })
  })

  it('tool.execute.before (v1) and session.tool.input.started (v2) for the question tool post Notification; other tools do not', async () => {
    const plugin = await instance()
    const v1 = await send(plugin, evProps('tool.execute.before', { tool: 'question', sessionID: 'ses_x' }))
    expect(v1).toHaveLength(1)
    expect(JSON.parse(v1[0].init.body).message).toContain('question')

    const v2 = await send(plugin, ev('session.tool.input.started', { sessionID: 'ses_x', id: 't1', name: 'question' }))
    expect(v2).toHaveLength(1)

    const other = await send(plugin, ev('session.tool.input.started', { sessionID: 'ses_x', id: 't2', name: 'bash' }))
    expect(other).toHaveLength(0)
  })

  it('unknown events post nothing', async () => {
    const plugin = await instance()
    expect(await send(plugin, ev('session.updated', { sessionID: 'ses_x' }))).toHaveLength(0)
    expect(await send(plugin, ev('message.part.updated', { part: {} }))).toHaveLength(0)
    expect(await send(plugin, ev('session.diff', { diff: [] }))).toHaveLength(0)
  })
})

describe('opencode plugin cost / statusline tracking', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** v2 sends running per-session totals on session.usage.updated. */
  const usageUpdate = (cost: number): unknown => ({
    sessionID: 'ses_abcdef12345678TOP',
    cost,
    tokens: { input: 100, output: 20, reasoning: 10, cache: { read: 5, write: 0 } }
  })

  it('session.usage.updated posts the session cost; the model comes from the step that ran', async () => {
    const plugin = await instance()
    await plugin.feed.push(ev('session.step.started', { sessionID: 'ses_x', model: { id: 'big-pickle', providerID: 'opencode' } }))
    await settle()
    const calls = await send(plugin, ev('session.usage.updated', usageUpdate(0.5)))
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://127.0.0.1:4123/statusline/deck-sess')
    expect(JSON.parse(calls[0].init.body)).toEqual({
      cost: { total_cost_usd: 0.5 },
      model: { display_name: 'big-pickle' },
      proc: PROC
    })
  })

  it('replaces the cost with each update (v2 reports running totals, not per-message costs)', async () => {
    const plugin = await instance()
    const first = await send(plugin, ev('session.usage.updated', usageUpdate(0.5)))
    expect(first).toHaveLength(1)

    vi.advanceTimersByTime(PLUGIN_USAGE_THROTTLE_MS)
    const second = await send(plugin, ev('session.usage.updated', usageUpdate(0.2)))
    expect(second).toHaveLength(1)
    expect(JSON.parse(second[0].init.body)).toEqual({
      cost: { total_cost_usd: 0.2 },
      proc: PROC
    })
  })

  it('cost posts are throttled: repeated updates within one second post nothing', async () => {
    const plugin = await instance()
    const first = await send(plugin, ev('session.usage.updated', usageUpdate(0.5)))
    expect(first).toHaveLength(1)

    vi.advanceTimersByTime(500)
    const throttled = await send(plugin, ev('session.usage.updated', usageUpdate(0.7)))
    expect(throttled).toHaveLength(0)

    vi.advanceTimersByTime(PLUGIN_USAGE_THROTTLE_MS)
    const afterWindow = await send(plugin, ev('session.usage.updated', usageUpdate(0.7)))
    expect(afterWindow).toHaveLength(1)
    expect(JSON.parse(afterWindow[0].init.body).cost).toEqual({ total_cost_usd: 0.7 })
  })

  it('no rate_limits are reported for OpenCode (no Claude plan quota)', async () => {
    const plugin = await instance()
    const calls = await send(plugin, ev('session.usage.updated', usageUpdate(0.1)))
    expect(calls).toHaveLength(1)
    expect(calls[0].init.body).not.toContain('rate_limit')
  })

  it('v1 message.updated assistant cost still posts (fallback for older OpenCode)', async () => {
    const plugin = await instance()
    const calls = await send(plugin, evProps('message.updated', {
      sessionID: 'ses_x',
      info: { id: 'msg_a', role: 'assistant', cost: 0.4, modelID: 'deepseek-v4.1-flash-free', tokens: { total: 100 } }
    }))
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0].init.body)).toEqual({
      cost: { total_cost_usd: 0.4 },
      model: { display_name: 'deepseek-v4.1-flash-free' },
      proc: PROC
    })
  })

  it('usage without a usable cost and v1 user updates post nothing', async () => {
    const plugin = await instance()
    const calls = await send(plugin, ev('session.usage.updated', { sessionID: 'ses_x', cost: Number.NaN, tokens: {} }))
    await send(plugin, evProps('message.updated', { sessionID: 'ses_x', info: { id: 'msg_u', role: 'user', cost: 5 } }))
    await send(plugin, evProps('message.updated', { sessionID: 'ses_x', info: { id: 'msg_n', role: 'assistant', cost: Number.NaN } }))
    await send(plugin, ev('session.usage.updated', { sessionID: 'ses_x', cost: -3, tokens: {} }))
    expect(calls).toHaveLength(0)
    expect(captureFetch(false)).toHaveLength(0)
  })

  it('a negative or malformed cost is skipped; zero posts', async () => {
    const plugin = await instance()
    const zero = await send(plugin, ev('session.usage.updated', usageUpdate(0)))
    expect(zero).toHaveLength(1)
    expect(JSON.parse(zero[0].init.body).cost).toEqual({ total_cost_usd: 0 })
  })
})

describe('opencode plugin never throws', () => {
  it('malformed events and hosts do not throw and do not post', async () => {
    const plugin = await instance()
    captureFetch()

    await send(plugin, {} as unknown)
    await send(plugin, { event: undefined })
    await send(plugin, ev(null as unknown as string, null))
    await send(plugin, ev('session.created', null))
    await send(plugin, ev('session.created', 'nope'))
    await send(plugin, ev('message.updated', { info: 42 }))
    await send(plugin, ev('message.updated', { info: { role: 'assistant', id: 5, cost: 'x' } }))
    await send(plugin, ev('session.status', { status: 7 }))
    await send(plugin, ev('session.updated', ['nope'])) // unknown event type, malformed array data
    expect(captureFetch(false)).toHaveLength(0)
  })

  it('subscription errors and broken feeds never crash the process', async () => {
    stubPluginEnv(BASE_ENV)
    const badFeed = {
      [Symbol.asyncIterator]() {
        return {
          next: () => Promise.reject(new Error('stream broke')),
          return: () => Promise.resolve({ value: undefined, done: true })
        }
      }
    }
    const cleanup = await pluginModule.setup({ location: { directory: 'X' }, event: { subscribe: async () => badFeed } })
    await settle()
    expect(cleanup).toBeDefined()
  })

  it('a throwing and a rejecting fetch are swallowed', async () => {
    const plugin = await instance()
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network down') }))
    await send(plugin, ev('session.idle', {}))
    await settle()

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('app gone'))))
    await send(plugin, ev('session.idle', {}))
    await settle()
  })

  it('every fetch carries a 2 second abort timeout so a hanging app cannot block the agent', async () => {
    const plugin = await instance()
    const seen: unknown[] = []
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init: { signal: unknown }) => {
      seen.push(init.signal)
      return Promise.resolve({})
    }))
    await send(plugin, ev('session.idle', {}))
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBeDefined()
    expect(PLUGIN_FETCH_TIMEOUT_MS).toBe(2000)
  })
})
