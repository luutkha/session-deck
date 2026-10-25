import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHookServer, type HookServer } from './HookServer'
import type { HookEvent } from '../../shared/types'

describe('HookServer POST /hook/<sessionId>/<Event>', () => {
  let server: HookServer
  let baseUrl: string
  const token = 'route-token-123'
  const knownSessions = new Set(['session-1', 'with space'])
  let events: HookEvent[] = []

  beforeEach(async () => {
    events = []
    server = createHookServer({
      token,
      isKnownSession: (id) => knownSessions.has(id),
      onEvent: (e) => events.push(e)
    })
    const { port } = await server.start()
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    await server.stop()
  })

  async function post(path: string, body: string, headers: Record<string, string> = { 'x-token': token }): Promise<number> {
    const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body })
    await response.text()
    return response.status
  }

  it('accepts UserPromptSubmit with an empty body and passes no message', async () => {
    const status = await post('/hook/session-1/UserPromptSubmit', '')
    expect(status).toBe(204)
    expect(events).toEqual([{ sessionId: 'session-1', event: 'UserPromptSubmit' }])
  })

  it('accepts Stop and Notification', async () => {
    expect(await post('/hook/session-1/Stop', '{"session_id":"abc"}')).toBe(204)
    expect(await post('/hook/session-1/Notification', '{"message":"Claude needs permission"}')).toBe(204)
    expect(events.map((e) => e.event)).toEqual(['Stop', 'Notification'])
  })

  it('takes the trimmed message of a Notification payload', async () => {
    await post('/hook/session-1/Notification', JSON.stringify({ message: '  Allow write?  ' }))
    expect(events[0]).toEqual({ sessionId: 'session-1', event: 'Notification', message: 'Allow write?' })
  })

  it('caps the message at 300 characters', async () => {
    await post('/hook/session-1/Notification', JSON.stringify({ message: 'x'.repeat(500) }))
    expect(events[0].message).toHaveLength(300)
  })

  it('a whitespace-only message is treated as no message', async () => {
    await post('/hook/session-1/Notification', JSON.stringify({ message: '   ' }))
    expect(events[0]).toEqual({ sessionId: 'session-1', event: 'Notification' })
  })

  it('invalid JSON is still accepted, without a message', async () => {
    const status = await post('/hook/session-1/Notification', 'not json {')
    expect(status).toBe(204)
    expect(events).toEqual([{ sessionId: 'session-1', event: 'Notification' }])
  })

  it('a JSON body without a string message yields no message', async () => {
    await post('/hook/session-1/Stop', JSON.stringify({ message: 42 }))
    expect(events[0]).toEqual({ sessionId: 'session-1', event: 'Stop' })
  })

  it('decodes the session id segment', async () => {
    const status = await post('/hook/with%20space/Stop', '', { 'x-token': token })
    expect(status).toBe(204)
    expect(events[0].sessionId).toBe('with space')
  })

  it('404 for an event that is not one of the three hook events', async () => {
    expect(await post('/hook/session-1/PreToolUse', '', { 'x-token': token })).toBe(404)
    expect(events).toHaveLength(0)
  })

  it('401 without a valid token (checked before the body is read)', async () => {
    expect(await post('/hook/session-1/Stop', '', {})).toBe(401)
    expect(await post('/hook/session-1/Stop', '', { 'x-token': 'wrong' })).toBe(401)
    expect(events).toHaveLength(0)
  })

  it('413 for a body larger than 65536 bytes', async () => {
    const body = JSON.stringify({ message: 'x'.repeat(70000) })
    expect(await post('/hook/session-1/Notification', body)).toBe(413)
    expect(events).toHaveLength(0)
  })

  it('404 for an unknown session', async () => {
    expect(await post('/hook/nobody/Stop', '')).toBe(404)
    expect(events).toHaveLength(0)
  })

  it('405 for a non-POST request', async () => {
    const response = await fetch(`${baseUrl}/hook/session-1/Stop`, { method: 'GET' })
    expect(response.status).toBe(405)
  })

  it('the legacy POST /hook JSON route still works and accepts UserPromptSubmit', async () => {
    const status = await post('/hook', JSON.stringify({ sessionId: 'session-1', event: 'UserPromptSubmit' }), {
      'x-token': token
    })
    expect(status).toBe(204)
    expect(events).toEqual([{ sessionId: 'session-1', event: 'UserPromptSubmit', message: undefined }])
  })
})

describe('HookServer proc field of OpenCode plugin bodies', () => {
  let server: HookServer
  let baseUrl: string
  const token = 'route-token-123'
  const knownSessions = new Set(['session-1'])
  let events: HookEvent[] = []

  beforeEach(async () => {
    events = []
    server = createHookServer({
      token,
      isKnownSession: (id) => knownSessions.has(id),
      onEvent: (e) => events.push(e)
    })
    const { port } = await server.start()
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    await server.stop()
  })

  async function post(path: string, body: unknown, headers: Record<string, string> = { 'x-token': token }): Promise<number> {
    const payload = typeof body === 'string' ? body : JSON.stringify(body)
    const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: payload })
    await response.text()
    return response.status
  }

  it('parses the proc into the event for every hook event kind', async () => {
    expect(await post('/hook/session-1/AgentSession', { session_id: 'ses_abcdefgh12345678', proc: '1234' })).toBe(204)
    expect(await post('/hook/session-1/UserPromptSubmit', { prompt: 'go', proc: '1234' })).toBe(204)
    expect(await post('/hook/session-1/Stop', { proc: '1234' })).toBe(204)
    expect(await post('/hook/session-1/Notification', { message: 'm', proc: '1234' })).toBe(204)
    expect(events).toEqual([
      { sessionId: 'session-1', event: 'AgentSession', message: 'ses_abcdefgh12345678', proc: '1234' },
      { sessionId: 'session-1', event: 'UserPromptSubmit', prompt: 'go', proc: '1234' },
      { sessionId: 'session-1', event: 'Stop', proc: '1234' },
      { sessionId: 'session-1', event: 'Notification', message: 'm', proc: '1234' }
    ])
  })

  it('a missing or invalid proc is ignored and the event is still accepted', async () => {
    expect(await post('/hook/session-1/Stop', { proc: 42 })).toBe(204)
    expect(await post('/hook/session-1/Notification', { proc: '' })).toBe(204)
    expect(await post('/hook/session-1/Stop', { proc: 'x'.repeat(65) })).toBe(204)
    expect(await post('/hook/session-1/Notification', '{"message":"m"')).toBe(204)
    expect(events.every((e) => e.proc === undefined)).toBe(true)
    expect(events).toHaveLength(4)
  })
})
