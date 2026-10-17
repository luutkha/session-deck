import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHookServer, type HookServer } from '../attention/HookServer'
import type { HookEvent } from '../../shared/types'

describe('HookServer POST /hook/<sessionId>/AgentSession', () => {
  let server: HookServer
  let baseUrl: string
  const token = 'agent-token-1'
  const knownSessions = new Set(['deck-sess'])
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

  const ocId = (n = 1): string => `ses_abcd${String(n).padStart(8, 'f')}`

  it('a valid payload becomes HookEvent AgentSession with the id as the message', async () => {
    expect(await post('/hook/deck-sess/AgentSession', JSON.stringify({ session_id: ocId(1) }))).toBe(204)
    expect(events).toEqual([{ sessionId: 'deck-sess', event: 'AgentSession', message: ocId(1) }])
  })

  it('the OpenCode session id must match /^ses_[A-Za-z0-9]{8,64}$/', async () => {
    expect(await post('/hook/deck-sess/AgentSession', JSON.stringify({ session_id: 'ses_' }))).toBe(400)
    expect(await post('/hook/deck-sess/AgentSession', JSON.stringify({ session_id: 'ses_short1' }))).toBe(400)
    expect(await post('/hook/deck-sess/AgentSession', JSON.stringify({ session_id: `ses_${'a'.repeat(65)}` }))).toBe(400)
    expect(await post('/hook/deck-sess/AgentSession', JSON.stringify({ session_id: `ses_${'a'.repeat(64)}` }))).toBe(204)
    expect(await post('/hook/deck-sess/AgentSession', JSON.stringify({ session_id: `ses_${'a'.repeat(8)}` }))).toBe(204)
    expect(await post('/hook/deck-sess/AgentSession', JSON.stringify({ session_id: 'agent_1234abcd' }))).toBe(400)
    expect(await post('/hook/deck-sess/AgentSession', JSON.stringify({ session_id: 42 }))).toBe(400)
    expect(events).toEqual([
      { sessionId: 'deck-sess', event: 'AgentSession', message: `ses_${'a'.repeat(64)}` },
      { sessionId: 'deck-sess', event: 'AgentSession', message: `ses_${'a'.repeat(8)}` }
    ])
  })

  it('invalid JSON, non-objects and missing session_id are 400 with no event', async () => {
    expect(await post('/hook/deck-sess/AgentSession', 'not json')).toBe(400)
    expect(await post('/hook/deck-sess/AgentSession', '[]')).toBe(400)
    expect(await post('/hook/deck-sess/AgentSession', '{}')).toBe(400)
    expect(await post('/hook/deck-sess/AgentSession', '')).toBe(400)
    expect(events).toHaveLength(0)
  })

  it('bad token and unknown sessions behave like the other hook events', async () => {
    expect(await post('/hook/deck-sess/AgentSession', JSON.stringify({ session_id: ocId(1) }), {})).toBe(401)
    expect(await post('/hook/nobody/AgentSession', JSON.stringify({ session_id: ocId(1) }))).toBe(404)
    expect(events).toHaveLength(0)
  })

  it('non-hook event names (like PreToolUse) are still rejected', async () => {
    expect(await post('/hook/deck-sess/PreToolUse', JSON.stringify({ session_id: ocId(1) }))).toBe(404)
    expect(events).toHaveLength(0)
  })
})
