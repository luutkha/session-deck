import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildWorkerPluginSource, WORKER_TEXT_THROTTLE_MS } from './workerPluginSource'

type Handler = (input: { event: { type: string; properties: unknown } }) => Promise<void>
interface Posted { readonly url: string; readonly token: string; readonly body: Record<string, unknown> }

const OC = 'ses_abcdefgh12345678'
let dir: string
let posted: Posted[]
const saved = { port: process.env.SESSIONDECK_PORT, id: process.env.SESSIONDECK_SESSION_ID, token: process.env.SESSIONDECK_TOKEN }

beforeEach(() => {
  dir = mkdtempSync(path.join(process.cwd(), 'sessiondeck-wplugin-test-')) // vitest cannot import files under the OS temp dir
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

async function load(): Promise<Handler | null> {
  const file = path.join(dir, 'plugin.mjs')
  writeFileSync(file, buildWorkerPluginSource(), 'utf8')
  const mod = (await import(pathToFileURL(file).href)) as { SessionDeckWorkerPlugin: (ctx: unknown) => Promise<{ event?: Handler }> }
  vi.useFakeTimers() // after the import: the module loader needs real timers
  const hooks = await mod.SessionDeckWorkerPlugin({ directory: 'C:\\proj' })
  return hooks.event ?? null
}

const send = async (handler: Handler, type: string, properties: unknown): Promise<void> => {
  await handler({ event: { type, properties } })
  await vi.advanceTimersByTimeAsync(0) // let the ordered send queue run
}
const kinds = (): string[] => posted.map((p) => String(p.body.kind))

describe('worker plugin', () => {
  it('does nothing without the SessionDeck environment', async () => {
    delete process.env.SESSIONDECK_PORT
    expect(await load()).toBeNull()
  })

  it('reports a full run to the owning Claude session with the token', async () => {
    const handler = (await load())!
    await send(handler, 'session.created', { info: { id: OC, title: 'New session - x', directory: 'C:\\proj' } })
    await send(handler, 'session.status', { sessionID: OC, status: { type: 'busy' } })
    await send(handler, 'session.status', { sessionID: OC, status: { type: 'busy' } })
    await send(handler, 'message.updated', { info: { id: 'm1', sessionID: OC, role: 'user' } })
    await send(handler, 'message.part.updated', { part: { id: 'u1', sessionID: OC, messageID: 'm1', type: 'text', text: 'Do the thing' } })
    await send(handler, 'message.updated', { info: { id: 'm2', sessionID: OC, role: 'assistant', providerID: 'opencode', modelID: 'big-pickle' } })
    await send(handler, 'message.part.updated', { part: { id: 'a1', sessionID: OC, messageID: 'm2', type: 'text', text: 'On it' } })
    await send(handler, 'message.part.updated', { part: { id: 'k1', sessionID: OC, messageID: 'm2', type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: 'a.ts' } } } })
    await send(handler, 'message.part.updated', { part: { id: 's1', sessionID: OC, messageID: 'm2', type: 'step-finish', cost: 0.01, tokens: { total: 55 } } })
    await send(handler, 'session.idle', { sessionID: OC })

    expect(posted.every((p) => p.url === 'http://127.0.0.1:4321/worker/claude%20one/event' && p.token === 'tok')).toBe(true)
    expect(kinds()).toEqual(['start', 'busy', 'user', 'model', 'tool', 'step', 'text', 'idle'])  // streaming text is flushed when the run goes idle
    expect(posted[0]?.body).toMatchObject({ v: 1, oc: OC, dir: 'C:\\proj' })
    expect(posted[3]?.body.model).toBe('opencode/big-pickle')
    expect(posted[4]?.body).toMatchObject({ tool: 'read', state: 'done', text: 'a.ts' })
    expect(posted[5]?.body).toMatchObject({ cost: 0.01, tokens: 55 })
    expect(posted[6]?.body).toMatchObject({ text: 'On it' })
  })

  it('throttles streaming text to the latest version and holds parts until their role is known', async () => {
    const handler = (await load())!
    await send(handler, 'message.part.updated', { part: { id: 'a1', sessionID: OC, messageID: 'm9', type: 'text', text: 'early' } })
    expect(posted).toHaveLength(0)
    await send(handler, 'message.updated', { info: { id: 'm9', sessionID: OC, role: 'assistant' } })
    await send(handler, 'message.part.updated', { part: { id: 'a1', sessionID: OC, messageID: 'm9', type: 'text', text: 'early and more' } })
    expect(posted).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(WORKER_TEXT_THROTTLE_MS + 5)
    expect(posted).toHaveLength(1)
    expect(posted[0]?.body).toMatchObject({ kind: 'text', text: 'early and more' })
  })

  it('ignores sub-agent sessions and reports errors', async () => {
    const handler = (await load())!
    await send(handler, 'session.created', { info: { id: 'ses_child12345678', parentID: OC } })
    await send(handler, 'session.status', { sessionID: 'ses_child12345678', status: { type: 'busy' } })
    expect(posted).toHaveLength(0)
    await send(handler, 'session.error', { sessionID: OC, error: { name: 'APIError', data: { message: 'usage limit' } } })
    expect(posted[0]?.body).toMatchObject({ kind: 'error', text: 'usage limit' })
  })

  it('sends a heartbeat and never throws when fetch fails', async () => {
    const handler = (await load())!
    vi.stubGlobal('fetch', () => { throw new Error('app is gone') })
    await vi.advanceTimersByTimeAsync(5100)
    await expect(send(handler, 'session.idle', { sessionID: OC })).resolves.toBeUndefined()
  })

  it('beats every five seconds', async () => {
    await load()
    await vi.advanceTimersByTimeAsync(10_100)
    expect(kinds()).toEqual(['beat', 'beat'])
  })
})
