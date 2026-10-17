import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHookServer, type HookServer } from './HookServer'

describe('HookServer /statusline/<sessionId>', () => {
  let server: HookServer
  let baseUrl: string
  const token = 'statusline-token'
  const knownSessions = new Set(['session-1'])
  let received: Array<{ sessionId: string; payload: unknown }> = []

  beforeEach(async () => {
    received = []
    server = createHookServer({
      token,
      isKnownSession: (id) => knownSessions.has(id),
      onEvent: () => {},
      onStatusLine: (sessionId, payload) => received.push({ sessionId, payload })
    })
    const { port } = await server.start()
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    await server.stop()
  })

  async function post(
    path: string,
    body: string,
    headers: Record<string, string> = { 'x-token': token }
  ): Promise<number> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body
    })
    return response.status
  }

  const validPayload = JSON.stringify({ session_id: 'abc', model: { display_name: 'Sonnet' } })

  it('returns 405 for GET', async () => {
    const response = await fetch(`${baseUrl}/statusline/session-1`, { method: 'GET' })
    expect(response.status).toBe(405)
  })

  it('returns 401 when the token is missing', async () => {
    expect(await post('/statusline/session-1', validPayload, {})).toBe(401)
    expect(received).toHaveLength(0)
  })

  it('returns 401 when the token is wrong', async () => {
    expect(await post('/statusline/session-1', validPayload, { 'x-token': 'nope' })).toBe(401)
    expect(received).toHaveLength(0)
  })

  it('returns 413 for a body larger than 65536 bytes', async () => {
    const big = JSON.stringify({ padding: 'x'.repeat(65537) })
    expect(await post('/statusline/session-1', big)).toBe(413)
    expect(received).toHaveLength(0)
  })

  it('accepts a body of just under 65536 bytes', async () => {
    const big = JSON.stringify({ padding: 'x'.repeat(65000) })
    expect(await post('/statusline/session-1', big)).toBe(204)
  })

  it('returns 400 for invalid JSON', async () => {
    expect(await post('/statusline/session-1', 'not json')).toBe(400)
    expect(received).toHaveLength(0)
  })

  it('returns 400 when the JSON is not an object', async () => {
    expect(await post('/statusline/session-1', '[1,2]')).toBe(400)
    expect(await post('/statusline/session-1', 'null')).toBe(400)
    expect(await post('/statusline/session-1', '"text"')).toBe(400)
    expect(received).toHaveLength(0)
  })

  it('returns 404 for an unknown session', async () => {
    expect(await post('/statusline/unknown', validPayload)).toBe(404)
    expect(received).toHaveLength(0)
  })

  it('returns 404 for a path with extra segments', async () => {
    expect(await post('/statusline/session-1/extra', validPayload)).toBe(404)
  })

  it('returns 204 and calls onStatusLine with the parsed object', async () => {
    expect(await post('/statusline/session-1', validPayload)).toBe(204)
    expect(received).toEqual([
      { sessionId: 'session-1', payload: { session_id: 'abc', model: { display_name: 'Sonnet' } } }
    ])
  })

  it('keeps /hook at its 4096 byte limit', async () => {
    const response = await fetch(`${baseUrl}/hook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-token': token },
      body: JSON.stringify({ sessionId: 'session-1', event: 'Stop', message: 'x'.repeat(5000) })
    })
    expect(response.status).toBe(413)
  })
})
