import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHookServer, type HookServer } from './HookServer'

describe('HookServer POST /worker/<sessionId>/event', () => {
  let server: HookServer
  let baseUrl: string
  const token = 'worker-token-123'
  const received: { sessionId: string; payload: unknown }[] = []
  let accept = true

  beforeEach(async () => {
    received.length = 0
    accept = true
    server = createHookServer({
      token,
      isKnownSession: (id) => id === 'claude-1' || id === 'with space',
      onEvent: () => undefined,
      onWorkerEvent: (sessionId, payload) => {
        received.push({ sessionId, payload })
        return accept
      }
    })
    const { port } = await server.start()
    baseUrl = 'http://127.0.0.1:' + port
  })

  afterEach(async () => {
    await server.stop()
  })

  async function post(path: string, body: string, headers: Record<string, string> = { 'x-token': token }): Promise<number> {
    const response = await fetch(baseUrl + path, { method: 'POST', headers, body })
    await response.text()
    return response.status
  }

  it('passes a valid payload of a known session to the handler', async () => {
    expect(await post('/worker/claude-1/event', '{"v":1,"kind":"beat"}')).toBe(204)
    expect(await post('/worker/with%20space/event', '{"v":1}')).toBe(204)
    expect(received).toEqual([
      { sessionId: 'claude-1', payload: { v: 1, kind: 'beat' } },
      { sessionId: 'with space', payload: { v: 1 } }
    ])
  })

  it('rejects a missing or wrong token without calling the handler', async () => {
    expect(await post('/worker/claude-1/event', '{}', {})).toBe(401)
    expect(await post('/worker/claude-1/event', '{}', { 'x-token': 'nope' })).toBe(401)
    expect(received).toHaveLength(0)
  })

  it('rejects unknown sessions, bad JSON, handler refusals and huge bodies', async () => {
    expect(await post('/worker/ghost/event', '{}')).toBe(404)
    expect(await post('/worker/claude-1/event', '{oops')).toBe(400)
    accept = false
    expect(await post('/worker/claude-1/event', '{}')).toBe(400)
    expect(await post('/worker/claude-1/event', 'x'.repeat(40000))).toBe(413)
  })

  it('does not treat other paths as worker routes', async () => {
    expect(await post('/worker/claude-1/other', '{}')).toBe(404)
  })
})
