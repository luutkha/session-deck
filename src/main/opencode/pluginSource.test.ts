import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  OPENCODE_GO_USAGE_URL,
  PLUGIN_DIR_NAME,
  PLUGIN_GO_USAGE_THROTTLE_MS,
  PLUGIN_USAGE_THROTTLE_MS,
  PLUGIN_FETCH_TIMEOUT_MS,
  MAX_PLUGIN_NOTICE_LENGTH,
  MAX_PLUGIN_PROMPT_LENGTH,
  buildOpencodePluginSource
} from './pluginSource'

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
  // Enough microtask ticks for: stream delivery -> for-await continuation -> the ordered fetch chain
  // (the Go allowance adds the credential resolve + JSON parse awaits on top).
  for (let i = 0; i < 16; i++) await Promise.resolve()
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
async function instance(
  env: Record<string, string | undefined> = BASE_ENV,
  modelApi?: { list: () => Promise<unknown> },
  extra: { readonly integration?: unknown; readonly keepFetch?: boolean } = {}
): Promise<Instance> {
  stubPluginEnv(env)
  const feed = createFeed()
  const context: Record<string, unknown> = { location: { directory: 'C:\\proj' }, event: { subscribe: async () => feed } }
  if (modelApi !== undefined) context.model = modelApi
  if (extra.integration !== undefined) context.integration = extra.integration
  const cleanup = await pluginModule.setup(context)
  await settle()
  if (extra.keepFetch !== true) captureFetch()
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

describe('opencode plugin prompt text (D29 parity with Claude turns)', () => {
  /** The real v2 shape recorded from a live turn (see scripts/probe-opencode-context.cjs). */
  const inboxEnqueued = (text: string): unknown => ({
    sessionID: 'ses_abcdef12345678TOP',
    inboxID: 'msg_inbox1',
    item: { type: 'user', payload: { text, files: [], agents: [] }, delivery: 'steer' }
  })

  it('attaches the v2 inbox prompt to the next UserPromptSubmit, exactly once', async () => {
    const plugin = await instance()
    await send(plugin, ev('session.inbox.enqueued', inboxEnqueued('fix the failing test')))
    const calls = await send(plugin, ev('session.execution.started', { sessionID: 'ses_x' }))
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://127.0.0.1:4123/hook/deck-sess/UserPromptSubmit')
    expect(JSON.parse(calls[0].init.body)).toEqual({ prompt: 'fix the failing test', proc: PROC })

    // The next turn has no captured prompt: an empty body (never the previous text).
    await send(plugin, ev('session.execution.succeeded', { sessionID: 'ses_x' }))
    const before = fetchCalls.length
    await send(plugin, ev('session.execution.started', { sessionID: 'ses_x' }))
    const nextTurn = callsSince(before).filter((c) => c.url.endsWith('/UserPromptSubmit'))
    expect(nextTurn).toHaveLength(1)
    expect(JSON.parse(nextTurn[0].init.body)).toEqual({ proc: PROC })
  })

  it('also works when the busy status arrives before the inbox event in the same turn', async () => {
    const plugin = await instance()
    const start = await send(plugin, ev('session.status', { status: { type: 'busy' } }))
    expect(JSON.parse(start[0].init.body)).toEqual({ proc: PROC })
    // A prompt recorded mid-turn is never attached to the NEXT turn (it was part of this one).
    await send(plugin, ev('session.inbox.enqueued', inboxEnqueued('steer this')))
    await send(plugin, ev('session.idle', {}))
    const before = fetchCalls.length
    await send(plugin, ev('session.status', { status: { type: 'busy' } }))
    const next = callsSince(before).filter((c) => c.url.endsWith('/UserPromptSubmit'))
    expect(JSON.parse(next[0].init.body)).toEqual({ proc: PROC })
  })

  it('clips a long prompt to 200 characters', async () => {
    const plugin = await instance()
    await send(plugin, ev('session.inbox.enqueued', inboxEnqueued('x'.repeat(500))))
    const calls = await send(plugin, ev('session.execution.started', {}))
    expect((JSON.parse(calls[0].init.body).prompt as string)).toHaveLength(MAX_PLUGIN_PROMPT_LENGTH)
  })

  it('never posts an empty prompt field', async () => {
    const plugin = await instance()
    await send(plugin, ev('session.inbox.enqueued', inboxEnqueued('   ')))
    const calls = await send(plugin, ev('session.execution.started', {}))
    expect(JSON.parse(calls[0].init.body)).toEqual({ proc: PROC })
  })

  it('reads a v1 user message from its text parts', async () => {
    const plugin = await instance()
    await send(plugin, evProps('message.updated', {
      sessionID: 'ses_x',
      info: { id: 'msg_u', role: 'user', parts: [{ type: 'text', text: 'hello' }, { type: 'text', text: 'world' }] }
    }))
    const calls = await send(plugin, ev('session.status', { status: { type: 'busy' } }))
    expect(JSON.parse(calls[0].init.body)).toEqual({ prompt: 'hello world', proc: PROC })
  })

  it('an assistant message never yields a prompt', async () => {
    const plugin = await instance()
    await send(plugin, evProps('message.updated', {
      sessionID: 'ses_x',
      info: { id: 'msg_a', role: 'assistant', cost: 0.1, parts: [{ type: 'text', text: 'assistant words' }] }
    }))
    // The assistant update posted its cost, not a prompt.
    const all = captureFetch(false)
    expect(all.some((c) => c.url.endsWith('/UserPromptSubmit'))).toBe(false)
    const calls = await send(plugin, ev('session.execution.started', {}))
    expect(JSON.parse(calls[0].init.body)).toEqual({ proc: PROC })
  })

  it('the prompt is only ever attached to UserPromptSubmit (not Stop or Notification)', async () => {
    const plugin = await instance()
    await send(plugin, ev('session.inbox.enqueued', inboxEnqueued('do the thing')))
    await send(plugin, ev('session.execution.started', {}))
    await send(plugin, ev('permission.asked', { action: 'bash', metadata: { command: 'rm -rf build' } }))
    await send(plugin, ev('session.execution.succeeded', {}))
    for (const call of captureFetch(false)) {
      if (call.url.endsWith('/UserPromptSubmit')) continue
      expect(JSON.parse(call.init.body).prompt).toBeUndefined()
    }
  })
})

describe('opencode plugin context window (D29 parity with Claude usage chip)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** The real v2 catalog entry shape (id, display name, limit.context). */
  const catalog = (): { list: () => Promise<unknown> } => ({
    list: async () => [
      { id: 'model-a', name: 'Model A', limit: { context: 200_000, output: 64_000 } },
      { id: 'model-b', name: 'Model B', limit: { context: 0 } }
    ]
  })

  const stepStarted = (id = 'model-a'): unknown => ({ sessionID: 'ses_x', model: { id, providerID: 'p' } })
  const stepEnded = (input: number, read = 0, write = 0): unknown => ({
    sessionID: 'ses_x',
    cost: 0.1,
    tokens: { input, output: 3, reasoning: 0, cache: { read, write } }
  })
  const usage = (cost: number, tokens: unknown = {}): unknown => ({ sessionID: 'ses_x', cost, tokens })

  it('posts used_percentage from the latest step tokens and the model limit', async () => {
    const plugin = await instance(BASE_ENV, catalog())
    await send(plugin, ev('session.step.started', stepStarted()))
    await send(plugin, ev('session.step.ended', stepEnded(60_000, 30_000, 0)))
    const calls = await send(plugin, ev('session.usage.updated', usage(0.1)))
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0].init.body)).toEqual({
      cost: { total_cost_usd: 0.1 },
      model: { display_name: 'Model A' },
      context_window: { used_percentage: 45 },
      proc: PROC
    })
  })

  it('never uses the cumulative session totals, only the latest step', async () => {
    const plugin = await instance(BASE_ENV, catalog())
    await send(plugin, ev('session.step.started', stepStarted()))
    await send(plugin, ev('session.step.ended', stepEnded(20_000)))
    const first = await send(plugin, ev('session.usage.updated', usage(0.1, { input: 190_000, cache: { read: 0, write: 0 } })))
    expect(JSON.parse(first[0].init.body).context_window).toEqual({ used_percentage: 10 })

    vi.advanceTimersByTime(PLUGIN_USAGE_THROTTLE_MS)
    await send(plugin, ev('session.step.ended', stepEnded(50_000)))
    const second = await send(plugin, ev('session.usage.updated', usage(0.2, { input: 200_000, cache: { read: 0, write: 0 } })))
    expect(JSON.parse(second[0].init.body).context_window).toEqual({ used_percentage: 25 })
  })

  it('rounds the percentage', async () => {
    const plugin = await instance(BASE_ENV, catalog())
    await send(plugin, ev('session.step.started', stepStarted()))
    await send(plugin, ev('session.step.ended', stepEnded(1_000)))
    const calls = await send(plugin, ev('session.usage.updated', usage(0.1)))
    expect(JSON.parse(calls[0].init.body).context_window).toEqual({ used_percentage: 1 })
  })

  it('omits the field when the model limit is missing, zero, or unknown', async () => {
    const plugin = await instance(BASE_ENV, catalog())
    // Unknown model.
    await send(plugin, ev('session.step.started', stepStarted('model-unknown')))
    await send(plugin, ev('session.step.ended', stepEnded(50_000)))
    const unknown = await send(plugin, ev('session.usage.updated', usage(0.1)))
    expect(JSON.parse(unknown[0].init.body).context_window).toBeUndefined()

    // Known model with a non-positive limit.
    vi.advanceTimersByTime(PLUGIN_USAGE_THROTTLE_MS)
    await send(plugin, ev('session.step.started', stepStarted('model-b')))
    const zero = await send(plugin, ev('session.usage.updated', usage(0.2)))
    expect(JSON.parse(zero[0].init.body).context_window).toBeUndefined()

    // No step tokens at all yet.
    vi.advanceTimersByTime(PLUGIN_USAGE_THROTTLE_MS)
    const none = await instance(BASE_ENV, catalog())
    const calls = await send(none, ev('session.usage.updated', usage(0.3)))
    expect(JSON.parse(calls[0].init.body).context_window).toBeUndefined()
  })

  it('a failing model catalog leaves cost and the model id exactly as before', async () => {
    const plugin = await instance(BASE_ENV, { list: async () => { throw new Error('catalog down') } })
    await send(plugin, ev('session.step.started', stepStarted()))
    await send(plugin, ev('session.step.ended', stepEnded(50_000)))
    const calls = await send(plugin, ev('session.usage.updated', usage(0.1)))
    expect(JSON.parse(calls[0].init.body)).toEqual({
      cost: { total_cost_usd: 0.1 },
      model: { display_name: 'model-a' },
      proc: PROC
    })
  })

  it('does not let the throttle swallow the richer post after the cost-only one (recorded event order)', async () => {
    const plugin = await instance(BASE_ENV, catalog())
    // The real v2 turn posts a cost-only session.usage.updated BEFORE step.started/ended.
    const early = await send(plugin, ev('session.usage.updated', usage(0.0001)))
    expect(JSON.parse(early[0].init.body).context_window).toBeUndefined()
    await send(plugin, ev('session.step.started', stepStarted()))
    await send(plugin, ev('session.step.ended', stepEnded(20_000)))
    const richer = await send(plugin, ev('session.usage.updated', usage(0.0001)))
    expect(richer).toHaveLength(1)
    expect(JSON.parse(richer[0].init.body)).toEqual({
      cost: { total_cost_usd: 0.0001 },
      model: { display_name: 'Model A' },
      context_window: { used_percentage: 10 },
      proc: PROC
    })
  })

  it('keeps the context percentage on later cost-only updates (no flicker to null)', async () => {
    const plugin = await instance(BASE_ENV, catalog())
    await send(plugin, ev('session.step.started', stepStarted()))
    await send(plugin, ev('session.step.ended', stepEnded(40_000)))
    await send(plugin, ev('session.usage.updated', usage(0.1)))
    vi.advanceTimersByTime(PLUGIN_USAGE_THROTTLE_MS)
    const later = await send(plugin, ev('session.usage.updated', usage(0.2)))
    expect(JSON.parse(later[0].init.body).context_window).toEqual({ used_percentage: 20 })
  })

  it('a v1 assistant message with tokens also feeds the percentage', async () => {
    const plugin = await instance(BASE_ENV, catalog())
    const calls = await send(plugin, evProps('message.updated', {
      sessionID: 'ses_x',
      info: {
        id: 'msg_a',
        role: 'assistant',
        cost: 0.3,
        modelID: 'model-a',
        tokens: { input: 10_000, output: 5, cache: { read: 10_000, write: 0 } }
      }
    }))
    expect(JSON.parse(calls[0].init.body).context_window).toEqual({ used_percentage: 10 })
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

describe('opencode plugin OpenCode Go allowance (display-only quota bars)', () => {
  const GO_BODY = {
    usage: {
      rolling: { status: 'ok', percent: 7, resetsAt: '2026-10-13T10:00:00Z' },
      weekly: { status: 'ok', percent: 3, resetsAt: '2026-10-20T10:00:00Z' },
      monthly: { status: 'ok', percent: 1, resetsAt: '2026-11-01T00:00:00Z' }
    }
  }

  /** The v2 credential API surface we verified: active(id) -> ConnectionInfo, resolve(conn) -> CredentialValue. */
  function credentials(value: unknown): {
    integration: unknown
    asked: string[]
    resolveCalls: () => number
  } {
    const asked: string[] = []
    let resolved = 0
    return {
      asked,
      resolveCalls: () => resolved,
      integration: {
        connection: {
          active: async (id: string) => {
            asked.push(id)
            return value === null ? undefined : { type: 'credential', id: 'cred-1', label: 'Go', method: 'key' }
          },
          resolve: async () => {
            resolved += 1
            return value ?? undefined
          }
        }
      }
    }
  }

  /** A fetch that answers the Go endpoint with `body`/`status` and every app post with 204. */
  function installGoFetch(body: unknown, status = 200): FetchCall[] {
    const calls: FetchCall[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
        calls.push({
          url: String(url),
          init: { method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body ?? '' }
        })
        if (String(url) === OPENCODE_GO_USAGE_URL) {
          return Promise.resolve({
            status,
            ok: status >= 200 && status < 300,
            json: async () => {
              if (status >= 400) throw new Error('no body')
              return body
            }
          })
        }
        return Promise.resolve({ status: 204 })
      })
    )
    return calls
  }

  const goGets = (calls: readonly FetchCall[]): FetchCall[] => calls.filter((c) => c.url === OPENCODE_GO_USAGE_URL)
  const statusPosts = (calls: readonly FetchCall[]): FetchCall[] => calls.filter((c) => c.url.includes('/statusline/'))

  it('posts the Go windows once at setup, with the OAuth access token as the bearer', async () => {
    const calls = installGoFetch(GO_BODY)
    const creds = credentials({ type: 'oauth', methodID: 'go', refresh: 'r', access: 'oauth-access-token', expires: 1 })
    await instance(BASE_ENV, undefined, { integration: creds.integration, keepFetch: true })

    expect(creds.asked).toEqual(['opencode-go'])
    expect(creds.resolveCalls()).toBe(1)
    const gets = goGets(calls)
    expect(gets).toHaveLength(1)
    expect(gets[0].init.method).toBe('GET')
    expect(gets[0].init.headers.authorization).toBe('Bearer oauth-access-token')
    expect(gets[0].init.headers.accept).toBe('application/json')

    const posts = statusPosts(calls)
    expect(posts).toHaveLength(1)
    expect(posts[0].url).toBe('http://127.0.0.1:4123/statusline/deck-sess')
    expect(JSON.parse(posts[0].init.body)).toEqual({
      source: 'opencode-go',
      rate_limits: {
        five_hour: { used_percentage: 7, resets_at: '2026-10-13T10:00:00Z' },
        seven_day: { used_percentage: 3, resets_at: '2026-10-20T10:00:00Z' },
        monthly: { used_percentage: 1, resets_at: '2026-11-01T00:00:00Z' }
      },
      proc: PROC
    })
    // The key never reaches the app.
    expect(posts[0].init.body).not.toContain('oauth-access-token')
  })

  it('accepts a plain API key credential', async () => {
    const calls = installGoFetch(GO_BODY)
    const creds = credentials({ type: 'key', key: 'sk-go-secret' })
    await instance(BASE_ENV, undefined, { integration: creds.integration, keepFetch: true })
    expect(goGets(calls)[0].init.headers.authorization).toBe('Bearer sk-go-secret')
    expect(statusPosts(calls)[0].init.body).not.toContain('sk-go-secret')
  })

  it('posts nothing when OpenCode has no Go connection (other providers are silent)', async () => {
    const calls = installGoFetch(GO_BODY)
    const creds = credentials(null)
    await instance(BASE_ENV, undefined, { integration: creds.integration, keepFetch: true })
    expect(creds.asked).toEqual(['opencode-go'])
    expect(creds.resolveCalls()).toBe(0)
    expect(goGets(calls)).toHaveLength(0)
    expect(statusPosts(calls)).toHaveLength(0)
  })

  it('posts nothing without the v2 connection API (no fake fallback)', async () => {
    const calls = installGoFetch(GO_BODY)
    await instance(BASE_ENV, undefined, { integration: { connection: {} }, keepFetch: true })
    expect(goGets(calls)).toHaveLength(0)
    expect(statusPosts(calls)).toHaveLength(0)
  })

  it('posts nothing on 401 and 429', async () => {
    for (const status of [401, 429]) {
      const calls = installGoFetch(GO_BODY, status)
      const creds = credentials({ type: 'key', key: 'k' })
      await instance(BASE_ENV, undefined, { integration: creds.integration, keepFetch: true })
      expect(goGets(calls)).toHaveLength(1)
      expect(statusPosts(calls)).toHaveLength(0)
    }
  })

  it('posts nothing when the endpoint is unreachable', async () => {
    const calls: FetchCall[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
        calls.push({ url: String(url), init: { method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body ?? '' } })
        if (String(url) === OPENCODE_GO_USAGE_URL) return Promise.reject(new Error('offline'))
        return Promise.resolve({ status: 204 })
      })
    )
    const creds = credentials({ type: 'key', key: 'k' })
    await instance(BASE_ENV, undefined, { integration: creds.integration, keepFetch: true })
    expect(goGets(calls)).toHaveLength(1)
    expect(statusPosts(calls)).toHaveLength(0)
  })

  it('posts nothing when no window is usable (status error, missing percent, bad body)', async () => {
    const bodies: unknown[] = [
      { usage: { rolling: { status: 'error', percent: 7 }, weekly: { percent: 'x' } } },
      { usage: {} },
      null,
      'nope'
    ]
    for (const body of bodies) {
      const calls = installGoFetch(body)
      const creds = credentials({ type: 'key', key: 'k' })
      await instance(BASE_ENV, undefined, { integration: creds.integration, keepFetch: true })
      expect(statusPosts(calls)).toHaveLength(0)
    }
  })

  it('sends only the windows the endpoint reported (monthly-only body)', async () => {
    const calls = installGoFetch({ usage: { monthly: { status: 'ok', percent: 12 } } })
    const creds = credentials({ type: 'key', key: 'k' })
    await instance(BASE_ENV, undefined, { integration: creds.integration, keepFetch: true })
    const body = JSON.parse(statusPosts(calls)[0].init.body)
    expect(body.rate_limits).toEqual({ monthly: { used_percentage: 12, resets_at: null } })
  })

  it('refreshes after a turn ends, throttled to once per 5 minutes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    try {
      const calls = installGoFetch(GO_BODY)
      const creds = credentials({ type: 'key', key: 'k' })
      const plugin = await instance(BASE_ENV, undefined, { integration: creds.integration, keepFetch: true })
      expect(goGets(calls)).toHaveLength(1)

      // One second later a turn ends: inside the 5-minute window, no second request.
      vi.advanceTimersByTime(PLUGIN_USAGE_THROTTLE_MS)
      await send(plugin, ev('session.execution.started', {}))
      await send(plugin, ev('session.execution.succeeded', {}))
      expect(goGets(calls)).toHaveLength(1)

      // After the window a turn end refreshes the bars.
      vi.advanceTimersByTime(PLUGIN_GO_USAGE_THROTTLE_MS)
      await send(plugin, ev('session.execution.started', {}))
      await send(plugin, ev('session.execution.succeeded', {}))
      expect(goGets(calls)).toHaveLength(2)
      expect(statusPosts(calls)).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
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
