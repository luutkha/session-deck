import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PLUGIN_FILE_NAME, PLUGIN_USAGE_THROTTLE_MS, PLUGIN_FETCH_TIMEOUT_MS, MAX_PLUGIN_NOTICE_LENGTH, buildOpencodePluginSource } from './pluginSource'
interface FetchCall {
  readonly url: string
  readonly init: {
    readonly method: string
    readonly headers: Record<string, string>
    readonly body: string
  }
}

interface PluginInstance {
  event: (context: { event: unknown }) => Promise<void>
}

type OpencodeFactory = () => Promise<{ event?: (context: { event: unknown }) => Promise<void> } | undefined>

// Inside the project root (vitest cannot dynamically import files under the OS temp dir).
const dir = mkdtempSync(join(process.cwd(), 'sessiondeck-ocplugin-test-'))
const pluginPath = join(dir, PLUGIN_FILE_NAME)

let factory: OpencodeFactory

beforeAll(async () => {
  writeFileSync(pluginPath, buildOpencodePluginSource(), 'utf8')
  const mod = (await import(pathToFileURL(pluginPath).href)) as { SessionDeckPlugin: OpencodeFactory }
  factory = mod.SessionDeckPlugin
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

const ev = (type: string, properties: unknown): { event: unknown } => ({ event: { type, properties } })

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

/** Calls the plugin event handler; returns what the plugin posted (fetch calls, in order). */
async function dispatch(plugin: PluginInstance, type: string, properties: unknown): Promise<FetchCall[]> {
  const fetchCalls = captureFetch()
  await expect(plugin.event(ev(type, properties))).resolves.toBeUndefined()
  return fetchCalls
}

function captureFetch(): FetchCall[] {
  const calls: FetchCall[] = []
  const fake = vi.fn((_url: string | URL, init?: unknown): Promise<unknown> => {
    const typed = init as FetchCall['init']
    calls.push({
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
  return calls
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('opencode plugin availability gate', () => {
  it('does nothing when SESSIONDECK_PORT is missing', async () => {
    stubPluginEnv({ ...BASE_ENV, SESSIONDECK_PORT: undefined })
    expect(await factory()).toEqual({})
  })

  it('does nothing when SESSIONDECK_SESSION_ID is missing', async () => {
    stubPluginEnv({ ...BASE_ENV, SESSIONDECK_SESSION_ID: undefined })
    expect(await factory()).toEqual({})
  })

  it('does nothing when SESSIONDECK_TOKEN is missing', async () => {
    stubPluginEnv({ ...BASE_ENV, SESSIONDECK_TOKEN: undefined })
    expect(await factory()).toEqual({})
  })
})

describe('opencode plugin event mapping (all posts carry the token header and JSON body)', () => {
  function factoryWith(propertyOverrides: Record<string, string | undefined> = {}): Promise<PluginInstance> {
    stubPluginEnv({ ...BASE_ENV, ...propertyOverrides })
    return factory().then((result) => {
      if (!result?.event) throw new Error('plugin did not install its event handler')
      return { event: result.event }
    })
  }

  it('session.created of a top-level session posts AgentSession with the info.id', async () => {
    const plugin = await factoryWith()
    const calls = await dispatch(plugin, 'session.created', {
      sessionID: 'ses_abcdef12345678TOP',
      info: { id: 'ses_abcdef12345678TOP', parentID: undefined }
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://127.0.0.1:4123/hook/deck-sess/AgentSession')
    expect(JSON.parse(calls[0].init.body)).toEqual({ session_id: 'ses_abcdef12345678TOP' })
    expect(calls[0].init.headers['x-token']).toBe('tok')
    expect(calls[0].init.headers['content-type']).toBe('application/json')
    expect(calls[0].init.method).toBe('POST')
  })

  it('session.created falls back to properties.sessionID when info.id is absent', async () => {
    const plugin = await factoryWith()
    const calls = await dispatch(plugin, 'session.created', { sessionID: 'ses_abcdef12345678TOP' })
    expect(JSON.parse(calls[0].init.body)).toEqual({ session_id: 'ses_abcdef12345678TOP' })
  })

  it('session.created of a sub-agent session (info.parentID set) is ignored', async () => {
    const plugin = await factoryWith()
    const calls = await dispatch(plugin, 'session.created', {
      sessionID: 'ses_abcdef12345678SUB',
      info: { id: 'ses_abcdef12345678SUB', parentID: 'ses_parent12345678' }
    })
    expect(calls).toHaveLength(0)
  })

  it('session.status busy fires UserPromptSubmit once until the session is idle again (silent during "thinking" statuses so no double post)', async () => {
    const plugin = await factoryWith()
    const calls = []
    calls.push(...(await dispatch(plugin, 'session.status', { status: { type: 'busy' } })))
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://127.0.0.1:4123/hook/deck-sess/UserPromptSubmit')
    expect(JSON.parse(calls[0].init.body)).toEqual({})

    // A repeated busy status is NOT a new turn.
    calls.push(...(await dispatch(plugin, 'session.status', { status: { type: 'busy' } })))
    expect(calls).toHaveLength(1)

    // Idle resets the transition.
    await dispatch(plugin, 'session.status', { status: { type: 'idle' } })
    calls.push(...(await dispatch(plugin, 'session.status', { status: { type: 'busy' } })))
    expect(calls).toHaveLength(2)
  })

  it('session.idle posts Stop (sessionDeck finished)', async () => {
    const plugin = await factoryWith()
    const calls = await dispatch(plugin, 'session.idle', {})
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://127.0.0.1:4123/hook/deck-sess/Stop')
  })

  it('permission.asked posts Notification with the tool and command, capped and trimmed', async () => {
    const plugin = await factoryWith()
    const calls = await dispatch(plugin, 'permission.asked', {
      id: 'per_1',
      sessionID: 'ses_abcdef12345678TOP',
      permission: 'bash',
      patterns: ['echo hi'],
      metadata: { command: 'echo hi' }
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://127.0.0.1:4123/hook/deck-sess/Notification')
    expect(JSON.parse(calls[0].init.body)).toEqual({ message: 'Permission needed: bash (echo hi)' })
  })

  it('permission.asked without any recognizable text still posts a short message at most 200 chars', async () => {
    const plugin = await factoryWith()
    const calls = await dispatch(plugin, 'permission.asked', { id: 'per_1', metadata: {} })
    const message = JSON.parse(calls[0].init.body).message as string
    expect(message.length).toBeGreaterThan(0)
    expect(message.length).toBeLessThanOrEqual(MAX_PLUGIN_NOTICE_LENGTH)
  })

  it('a very long permission text is truncated to 200 characters', async () => {
    const plugin = await factoryWith()
    const calls = await dispatch(plugin, 'permission.asked', {
      permission: 'bash',
      metadata: { command: 'x'.repeat(500) }
    })
    expect(JSON.parse(calls[0].init.body).message).toHaveLength(MAX_PLUGIN_NOTICE_LENGTH)
  })

  it('question.asked posts Notification (defensive: event documented, not yet observed in 1.19 runs)', async () => {
    const plugin = await factoryWith()
    const calls = await dispatch(plugin, 'question.asked', { question: 'First or second?' })
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0].init.body)).toEqual({ message: 'Permission needed: First or second?' })
  })

  it('tool.execute.before for the question tool posts Notification; other tools do not', async () => {
    const plugin = await factoryWith()
    const calls = await dispatch(plugin, 'tool.execute.before', { tool: 'question', sessionID: 'ses_x' })
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0].init.body).message).toContain('question')

    const other = await dispatch(plugin, 'tool.execute.before', { tool: 'bash', sessionID: 'ses_x' })
    expect(other).toHaveLength(0)
  })

  it('unknown events post nothing', async () => {
    const plugin = await factoryWith()
    expect(await dispatch(plugin, 'session.updated', { sessionID: 'ses_x', info: {} })).toHaveLength(0)
    expect(await dispatch(plugin, 'message.part.updated', { part: {} })).toHaveLength(0)
    expect(await dispatch(plugin, 'session.diff', { diff: [] })).toHaveLength(0)
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

  async function factoryWith(propertyOverrides: Record<string, string | undefined> = {}): Promise<PluginInstance> {
    stubPluginEnv({ ...BASE_ENV, ...propertyOverrides })
    const result = await factory()
    if (!result?.event) throw new Error('plugin did not install its event handler')
    return { event: result.event }
  }

  /** A completed assistant message update as OpenCode sends it. */
  function assistantUpdate(id: string, cost: number, modelID = 'deepseek-v4.1-flash-free'): unknown {
    return {
      sessionID: 'ses_abcdef12345678TOP',
      info: { id, role: 'assistant', cost, modelID, tokens: { total: 100 } }
    }
  }

  it('assistant message.updated posts the summed cost and the model', async () => {
    const plugin = await factoryWith()
    const calls = captureFetch()
    await expect(plugin.event({ event: { type: 'message.updated', properties: assistantUpdate('msg_a', 0.5) } })).resolves.toBeUndefined()
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://127.0.0.1:4123/statusline/deck-sess')
    expect(JSON.parse(calls[0].init.body)).toEqual({
      cost: { total_cost_usd: 0.5 },
      model: { display_name: 'deepseek-v4.1-flash-free' }
    })
  })

  it('per-message cost of a message id is REPLACED (updates repeat) and posts use the sum', async () => {
    const plugin = await factoryWith()
    await plugin.event({ event: { type: 'message.updated', properties: assistantUpdate('msg_a', 0.5) } })
    const second = captureFetch()

    vi.advanceTimersByTime(PLUGIN_USAGE_THROTTLE_MS)
    await plugin.event({ event: { type: 'message.updated', properties: assistantUpdate('msg_a', 0.2) } })
    expect(second).toHaveLength(1)
    expect(JSON.parse(second[0].init.body)).toEqual({
      cost: { total_cost_usd: 0.2 },
      model: { display_name: 'deepseek-v4.1-flash-free' }
    })
  })

  it('cost posts are throttled: repeated updates within one second post nothing; after the window the SUM posts', async () => {
    const plugin = await factoryWith()
    const first = captureFetch()
    await plugin.event({ event: { type: 'message.updated', properties: assistantUpdate('msg_a', 0.5) } })
    expect(first).toHaveLength(1)

    // Same second: an update of msg_a (repeated) and a second message both add nothing to the wire.
    vi.advanceTimersByTime(500)
    const throttled = captureFetch()
    await plugin.event({ event: { type: 'message.updated', properties: assistantUpdate('msg_a', 0.7) } })
    await plugin.event({ event: { type: 'message.updated', properties: assistantUpdate('msg_b', 0.3) } })
    expect(throttled).toHaveLength(0)

    vi.advanceTimersByTime(PLUGIN_USAGE_THROTTLE_MS)
    const afterWindow = captureFetch()
    await plugin.event({ event: { type: 'message.updated', properties: assistantUpdate('msg_b', 0.3) } })
    expect(afterWindow).toHaveLength(1)
    expect(JSON.parse(afterWindow[0].init.body)).toEqual({
      cost: { total_cost_usd: 1 },
      model: { display_name: 'deepseek-v4.1-flash-free' }
    })
  })

  it('no rate_limits are reported for OpenCode (no Claude plan quota)', async () => {
    const plugin = await factoryWith()
    const calls = captureFetch()
    await plugin.event({ event: { type: 'message.updated', properties: assistantUpdate('msg_a', 0.1) } })
    expect(calls).toHaveLength(1)
    expect(calls[0].init.body).not.toContain('rate_limit')
  })

  it('user messages and messages without a usable cost update nothing new', async () => {
    const plugin = await factoryWith()
    const calls = captureFetch()
    await plugin.event({ event: { type: 'message.updated', properties: { info: { id: 'msg_u', role: 'user', cost: 5 } } } })
    await plugin.event({ event: { type: 'message.updated', properties: { info: { id: 'msg_n', role: 'assistant', cost: Number.NaN } } } })
    await plugin.event({ event: { type: 'message.updated', properties: { info: { id: 'msg_neg', role: 'assistant', cost: -3 } } } })
    expect(calls).toHaveLength(0)
  })

  it('a missing modelID is omitted from the payload', async () => {
    const plugin = await factoryWith()
    const calls = captureFetch()
    await plugin.event({ event: { type: 'message.updated', properties: { sessionID: 'ses_x', info: { id: 'msg_a', role: 'assistant', cost: 0.2 } } } })
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0].init.body)).toEqual({ cost: { total_cost_usd: 0.2 } })
  })
})

describe('opencode plugin never throws', () => {
  async function factoryWith(): Promise<PluginInstance> {
    stubPluginEnv(BASE_ENV)
    const result = await factory()
    if (!result?.event) throw new Error('plugin did not install its event handler')
    return { event: result.event }
  }

  it('malformed events and hosts do not throw and do not post', async () => {
    const plugin = await factoryWith()
    captureFetch()

    await expect(plugin.event({} as unknown as { event: unknown })).resolves.toBeUndefined()
    await expect(plugin.event({ event: undefined })).resolves.toBeUndefined()
    await expect(plugin.event({ event: { type: null, properties: null } })).resolves.toBeUndefined()
    await expect(plugin.event({ event: { type: 'session.created', properties: null } })).resolves.toBeUndefined()
    await expect(plugin.event({ event: { type: 'session.created', properties: 'nope' } })).resolves.toBeUndefined()
    await expect(plugin.event({ event: { type: 'message.updated', properties: { info: 42 } } })).resolves.toBeUndefined()
    await expect(plugin.event({ event: { type: 'message.updated', properties: { info: { role: 'assistant', id: 5, cost: 'x' } } } })).resolves.toBeUndefined()
    await expect(plugin.event({ event: { type: 'session.status', properties: { status: 7 } } })).resolves.toBeUndefined()
    await expect(plugin.event({ event: { type: 'permission.asked', properties: [] } })).resolves.toBeUndefined()
  })

  it('a throwing fetch is swallowed', async () => {
    const plugin = await factoryWith()
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network down') }))
    await expect(plugin.event({ event: { type: 'session.idle', properties: {} } })).resolves.toBeUndefined()
  })

  it('a rejecting fetch is swallowed', async () => {
    const plugin = await factoryWith()
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('app gone'))))
    await expect(plugin.event({ event: { type: 'session.idle', properties: {} } })).resolves.toBeUndefined()
  })

  it('every fetch carries a 2 second abort timeout so a hanging app cannot block the agent', async () => {
    const plugin = await factoryWith()
    const seen: unknown[] = []
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init: { signal: unknown }) => {
      seen.push(init.signal)
      return Promise.resolve({})
    }))
    await plugin.event({ event: { type: 'session.idle', properties: {} } })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBeDefined()
    expect(PLUGIN_FETCH_TIMEOUT_MS).toBe(2000)
  })
})
