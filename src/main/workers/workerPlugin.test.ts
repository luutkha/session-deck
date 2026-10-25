import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildWorkerPluginSource, WORKER_HEARTBEAT_MS, WORKER_TEXT_THROTTLE_MS, WORKER_PLUGIN_DIR_NAME } from './workerPluginSource'

interface Instance {
  feed: AsyncIterable<unknown> & { push(value: unknown): void }
  cleanup: (() => void) | null
}
interface Posted { readonly url: string; readonly token: string; readonly body: Record<string, unknown> }

type PluginModule = { id: string; setup: (context: unknown) => Promise<unknown> }

const OC = 'ses_abcdefgh12345678'
const PROC = String(process.pid)
let dir: string
let posted: Posted[]
const saved = { port: process.env.SESSIONDECK_PORT, id: process.env.SESSIONDECK_SESSION_ID, token: process.env.SESSIONDECK_TOKEN }
let pluginModule: PluginModule | null = null

beforeEach(async () => {
  if (pluginModule === null) {
    dir = mkdtempSync(path.join(process.cwd(), 'sessiondeck-wplugin-test-')) // vitest cannot import files under the OS temp dir
    const pkgDir = path.join(dir, WORKER_PLUGIN_DIR_NAME)
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: WORKER_PLUGIN_DIR_NAME, main: 'index.mjs' }), 'utf8')
    writeFileSync(path.join(pkgDir, 'index.mjs'), buildWorkerPluginSource(), 'utf8')
    const mod = (await import(pathToFileURL(path.join(pkgDir, 'index.mjs')).href)) as { default: PluginModule }
    pluginModule = mod.default
  }
  posted = []
  process.env.SESSIONDECK_PORT = '4321'
  process.env.SESSIONDECK_SESSION_ID = 'claude one'
  process.env.SESSIONDECK_TOKEN = 'tok'
  vi.stubGlobal('fetch', (url: string, init: { headers: Record<string, string>; body: string }) => {
    posted.push({ url, token: init.headers['x-token'] ?? '', body: JSON.parse(init.body) as Record<string, unknown> })
    return Promise.resolve({})
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
  for (const [key, value] of [['SESSIONDECK_PORT', saved.port], ['SESSIONDECK_SESSION_ID', saved.id], ['SESSIONDECK_TOKEN', saved.token]] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

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

async function load(): Promise<Instance> {
  vi.useFakeTimers() // after the import: the module loader needs real timers
  const feed = createFeed()
  const cleanup = await pluginModule!.setup({ directory: 'C:\\proj', event: { subscribe: async () => feed } })
  await vi.advanceTimersByTimeAsync(0) // let the ordered send queue run (init hello lands here)
  // The init `hello` stays in `posted`; tests that don't want it clear with `posted.length = 0`.
  return { feed, cleanup: cleanup === undefined || cleanup === null ? null : (cleanup as () => void) }
}

const ev = (type: string, data: unknown): unknown => ({ type, data })
const evProps = (type: string, properties: unknown): unknown => ({ type, properties })

const send = async (instance: Instance, event: unknown): Promise<void> => {
  instance.feed.push(event)
  await vi.advanceTimersByTimeAsync(2) // microtasks + any 0 timers (only when not using fake timers)
}
const kinds = (): string[] => posted.map((p) => String(p.body.kind))

describe('worker plugin', () => {
  it('does nothing without the SessionDeck environment', async () => {
    delete process.env.SESSIONDECK_PORT
    const instance = await load()
    expect(instance.cleanup).toBeNull()
    expect(posted).toHaveLength(0)
  })

  it('reports a full run to the owning Claude session with the token (v2 events)', async () => {
    const instance = (await load())!
    posted.length = 0
    await send(instance, ev('session.created', { sessionID: OC, title: 'New session - x', location: { directory: 'C:\\proj' } }))
    await send(instance, ev('session.inbox.enqueued', { sessionID: OC, type: 'user', payload: { text: 'Do the thing' } }))
    await send(instance, ev('session.execution.started', { sessionID: OC }))
    await send(instance, ev('session.step.started', { sessionID: OC, model: { id: 'big-pickle', providerID: 'opencode' } }))
    await send(instance, ev('session.tool.input.started', { sessionID: OC, assistantMessageID: 'm2', id: 't1', name: 'read' }))
    await send(instance, ev('session.tool.called', { sessionID: OC, assistantMessageID: 'm2', id: 't1', input: { filePath: 'a.ts' } }))
    await send(instance, ev('session.tool.success', { sessionID: OC, assistantMessageID: 'm2', id: 't1', content: [] }))
    await send(instance, ev('session.text.ended', { sessionID: OC, assistantMessageID: 'm2', ordinal: 0, text: 'On it' }))
    await send(instance, ev('session.step.ended', { sessionID: OC, assistantMessageID: 'm2', cost: 0.01, tokens: { input: 40, output: 10, reasoning: 5, cache: { read: 0, write: 0 } } }))
    await send(instance, ev('session.execution.succeeded', { sessionID: OC }))

    expect(posted.every((p) => p.url === 'http://127.0.0.1:4321/worker/claude%20one/event' && p.token === 'tok')).toBe(true)
    expect(kinds()).toEqual(['start', 'user', 'busy', 'model', 'tool', 'tool', 'text', 'step', 'idle'])
    expect(posted[0]?.body).toMatchObject({ v: 1, oc: OC, dir: 'C:\\proj' })
    expect(posted[3]?.body.model).toBe('opencode/big-pickle')
    expect(posted[4]?.body).toMatchObject({ tool: 'read', state: 'running', text: 'a.ts' })
    expect(posted[5]?.body).toMatchObject({ tool: 'read', state: 'done', text: 'a.ts' })
    expect(posted[6]?.body).toMatchObject({ text: 'On it' })
    expect(posted[7]?.body).toMatchObject({ cost: 0.01, tokens: 55 })
  })

  it('posts hello first, with the process pid as proc, before any session exists', async () => {
    const instance = await load()
    await vi.advanceTimersByTimeAsync(0)
    expect(posted.map((p) => String(p.body.kind))).toEqual(['hello'])
    expect(posted[0]?.body.proc).toBe(PROC)
    expect(posted[0]?.body).not.toHaveProperty('oc')
    instance.feed.push(ev('session.created', { sessionID: OC, title: 'x' }))
    await vi.advanceTimersByTimeAsync(2)
    expect(posted[1]?.body.proc).toBe(PROC)
  })

  it('reports streaming text delta accumulated and the final text on end (v2)', async () => {
    const instance = await load()
    posted.length = 0
    await send(instance, ev('session.text.delta', { sessionID: OC, assistantMessageID: 'm9', ordinal: 0, text: 'early' }))
    expect(posted).toHaveLength(0) // the throttle holds it back
    await send(instance, ev('session.text.delta', { sessionID: OC, assistantMessageID: 'm9', ordinal: 0, text: ' and more' }))
    await vi.advanceTimersByTimeAsync(WORKER_TEXT_THROTTLE_MS + 5)
    expect(posted).toHaveLength(1)
    expect(posted[0]?.body).toMatchObject({ kind: 'text', text: 'early and more' })

    await send(instance, ev('session.text.ended', { sessionID: OC, assistantMessageID: 'm9', ordinal: 0, text: 'early and more, finalized' }))
    await vi.advanceTimersByTimeAsync(5)
    expect(posted).toHaveLength(2)
    expect(posted[1]?.body).toMatchObject({ kind: 'text', text: 'early and more, finalized' })
  })

  it('ignores sub-agent sessions and reports execution errors', async () => {
    const instance = await load()
    posted.length = 0
    await send(instance, ev('session.created', { sessionID: 'ses_child12345678', parentID: OC }))
    await send(instance, ev('session.execution.started', { sessionID: 'ses_child12345678' }))
    await send(instance, ev('session.status', { sessionID: 'ses_child12345678', status: { type: 'busy' } }))
    expect(posted).toHaveLength(0)
    await send(instance, ev('session.execution.failed', { sessionID: OC, error: { type: 'api', message: 'usage limit' } }))
    expect(posted.some((p) => p.body.kind === 'error' && p.body.text === 'usage limit')).toBe(true)
    // A failed execution ENDS the run even when no busy was reported (failed at spawn): the settle posts one idle
    // so the hub finalizes the worker as failed (error + idle) instead of leaving it running forever.
    expect(posted.filter((p) => p.body.kind === 'idle' && p.body.oc === OC)).toHaveLength(1)
    // And the settle is at most one per turn: a further idle without a busy stays silent.
    await send(instance, ev('session.idle', { sessionID: OC }))
    expect(posted.filter((p) => p.body.kind === 'idle' && p.body.oc === OC)).toHaveLength(1)
  })

  it('a message error finalizes on the next idle even when the session never went busy', async () => {
    const instance = await load()
    posted.length = 0
    await send(instance, ev('message.updated', { info: { id: 'm1', sessionID: OC, role: 'assistant', modelID: 'x', error: { name: 'APIError', data: { message: 'Go usage limit exceeded' } } } }))
    expect(posted.some((p) => p.body.kind === 'error' && p.body.text === 'Go usage limit exceeded')).toBe(true)
    await send(instance, ev('session.idle', { sessionID: OC }))
    expect(posted.filter((p) => p.body.kind === 'idle' && p.body.oc === OC)).toHaveLength(1)
    // A never-touched session stays silent: no announce, no error, no idle.
    await send(instance, ev('session.idle', { sessionID: 'ses_nevertouched01' }))
    expect(posted.filter((p) => p.body.oc === 'ses_nevertouched01')).toHaveLength(0)
  })

  it('v1 message events still work (older OpenCode)', async () => {
    const instance = await load()
    posted.length = 0
    await send(instance, evProps('session.created', { info: { id: OC, title: 'x', directory: 'C:\\old' } }))
    await send(instance, evProps('session.status', { sessionID: OC, status: { type: 'busy' } }))
    await send(instance, evProps('message.updated', { info: { id: 'm1', sessionID: OC, role: 'user' } }))
    await send(instance, evProps('message.part.updated', { part: { id: 'u1', sessionID: OC, messageID: 'm1', type: 'text', text: 'Do the thing' } }))
    await send(instance, evProps('message.updated', { info: { id: 'm2', sessionID: OC, role: 'assistant', providerID: 'opencode', modelID: 'big-pickle' } }))
    await send(instance, evProps('message.part.updated', { part: { id: 'a1', sessionID: OC, messageID: 'm2', type: 'text', text: 'On it' } }))
    await send(instance, evProps('message.part.updated', { part: { id: 'k1', sessionID: OC, messageID: 'm2', type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: 'a.ts' } } } }))
    await send(instance, evProps('message.part.updated', { part: { id: 's1', sessionID: OC, messageID: 'm2', type: 'step-finish', cost: 0.01, tokens: { total: 55 } } }))
    await send(instance, evProps('session.idle', { sessionID: OC }))

    expect(kinds()).toEqual(['start', 'busy', 'user', 'model', 'tool', 'step', 'text', 'idle'])
    expect(posted[0]?.body).toMatchObject({ oc: OC, dir: 'C:\\old' })
    expect(posted[4]?.body).toMatchObject({ tool: 'read', state: 'done', text: 'a.ts' })
    expect(posted[5]?.body).toMatchObject({ cost: 0.01, tokens: 55 })
    expect(posted[6]?.body).toMatchObject({ text: 'On it' })
    expect(posted[7]?.body.kind).toBe('idle')
  })

  it('sends a heartbeat and never throws when fetch fails', async () => {
    const instance = await load()
    expect(instance.cleanup).toBeTypeOf('function')
    vi.stubGlobal('fetch', () => { throw new Error('app is gone') })
    await vi.advanceTimersByTimeAsync(WORKER_HEARTBEAT_MS + 100)
    await expect(send(instance, ev('session.idle', { sessionID: OC }))).resolves.toBeUndefined()
    instance.cleanup?.()
  })

  it('beats every five seconds and stops when the cleanup runs', async () => {
    const instance = await load()
    posted.length = 0
    await vi.advanceTimersByTimeAsync(10_100)
    expect(kinds()).toEqual(['beat', 'beat'])
    instance.cleanup?.()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(kinds()).toEqual(['beat', 'beat'])
  })
})
