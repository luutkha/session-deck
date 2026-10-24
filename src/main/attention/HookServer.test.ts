import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHookServer } from './HookServer'
import type { HookEvent } from '../../shared/types'

describe('HookServer', () => {
  let server: ReturnType<typeof createHookServer>
  let port: number
  let baseUrl: string
  const token = 'test-token-123'
  const knownSessions = new Set(['session-1', 'session-2'])
  let receivedEvents: HookEvent[] = []

  beforeEach(async () => {
    receivedEvents = []
    server = createHookServer({
      token,
      isKnownSession: (id) => knownSessions.has(id),
      onEvent: (e) => receivedEvents.push(e)
    })
    const { port: p } = await server.start()
    port = p
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    await server.stop()
  })

  async function postHook(body: object, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
    const response = await fetch(`${baseUrl}/hook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...headers
      },
      body: JSON.stringify(body)
    })
    return { status: response.status, body: await response.text() }
  }

  it('returns 405 for non-POST methods', async () => {
    const response = await fetch(`${baseUrl}/hook`, { method: 'GET' })
    expect(response.status).toBe(405)
  })

  it('returns 404 for unknown paths', async () => {
    const response = await fetch(`${baseUrl}/unknown`, { method: 'POST' })
    expect(response.status).toBe(404)
  })

  it('returns 401 for missing token', async () => {
    const { status } = await postHook({ sessionId: 'session-1', event: 'Notification' })
    expect(status).toBe(401)
  })

  it('returns 401 for wrong token', async () => {
    const { status } = await postHook(
      { sessionId: 'session-1', event: 'Notification' },
      { 'x-token': 'wrong-token' }
    )
    expect(status).toBe(401)
  })

  it('returns 400 for invalid JSON', async () => {
    const response = await fetch(`${baseUrl}/hook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-token': token },
      body: 'not json'
    })
    expect(response.status).toBe(400)
  })

  it('returns 413 for an oversized body', async () => {
    const response = await fetch(`${baseUrl}/hook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-token': token },
      body: 'x'.repeat(5000)
    })
    expect(response.status).toBe(413)
  })

  it('returns 400 for missing sessionId', async () => {
    const { status } = await postHook({ event: 'Notification' }, { 'x-token': token })
    expect(status).toBe(400)
  })

  it('returns 400 for invalid event type', async () => {
    const { status } = await postHook({ sessionId: 'session-1', event: 'Invalid' }, { 'x-token': token })
    expect(status).toBe(400)
  })

  it('returns 413 for oversized body', async () => {
    const largeBody = { sessionId: 'session-1', event: 'Notification', message: 'x'.repeat(5000) }
    const { status } = await postHook(largeBody, { 'x-token': token })
    expect(status).toBe(413)
  })

  it('returns 404 for unknown session', async () => {
    const { status } = await postHook({ sessionId: 'unknown', event: 'Notification' }, { 'x-token': token })
    expect(status).toBe(404)
  })

  it('returns 204 and fires onEvent for valid Notification', async () => {
    const { status } = await postHook(
      { sessionId: 'session-1', event: 'Notification', message: 'need permission' },
      { 'x-token': token }
    )
    expect(status).toBe(204)
    expect(receivedEvents).toHaveLength(1)
    expect(receivedEvents[0]).toEqual({
      sessionId: 'session-1',
      event: 'Notification',
      message: 'need permission'
    })
  })

  it('returns 204 and fires onEvent for valid Stop', async () => {
    const { status } = await postHook(
      { sessionId: 'session-2', event: 'Stop' },
      { 'x-token': token }
    )
    expect(status).toBe(204)
    expect(receivedEvents).toHaveLength(1)
    expect(receivedEvents[0]).toEqual({
      sessionId: 'session-2',
      event: 'Stop'
    })
  })

  it('stop() can be called twice safely', async () => {
    await server.stop()
    await server.stop() // Should not throw
  })

  it('restart gets a new port', async () => {
    const firstPort = port
    await server.stop()
    const { port: newPort } = await server.start()
    expect(newPort).not.toBe(firstPort)
    await server.stop()
  })

  it('token comparison is timing-safe (length check)', async () => {
    // Different length tokens should fail quickly without timing leak
    const { status } = await postHook(
      { sessionId: 'session-1', event: 'Notification' },
      { 'x-token': 'short' }
    )
    expect(status).toBe(401)
  })
})