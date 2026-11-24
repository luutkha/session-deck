import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHookServer, MAX_CURSOR_ANSWER_LENGTH, ROUTE_EVENT_NAMES } from './HookServer'
import type { HookEvent } from '../../shared/types'

// D81: the Cursor hook script posts to the same /hook/<sessionId>/<Event> routes as Claude. Every accepted event
// carries the body's conversation_id as `chatId`; CursorAnswer also carries the reply text as `answer`.
describe('HookServer Cursor route', () => {
  let server: ReturnType<typeof createHookServer>
  let baseUrl: string
  const token = 'cursor-token'
  const knownSessions = new Set(['session-1'])
  let receivedEvents: HookEvent[] = []

  beforeEach(async () => {
    receivedEvents = []
    server = createHookServer({
      token,
      isKnownSession: (id) => knownSessions.has(id),
      onEvent: (event) => receivedEvents.push(event)
    })
    const { port } = await server.start()
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    await server.stop()
  })

  async function post(event: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number }> {
    const response = await fetch(`${baseUrl}/hook/session-1/${event}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-token': token, ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    })
    return { status: response.status }
  }

  it('keeps Claude event names untouched', () => {
    expect(ROUTE_EVENT_NAMES).toEqual(['Notification', 'Stop', 'UserPromptSubmit', 'AgentSession', 'CursorAnswer'])
  })

  it('CursorAnswer carries the conversation id and the trimmed answer', async () => {
    const { status } = await post('CursorAnswer', { conversation_id: 'abcdefgh-1234', text: '  Done.\n' })

    expect(status).toBe(204)
    expect(receivedEvents).toEqual([
      { sessionId: 'session-1', event: 'CursorAnswer', chatId: 'abcdefgh-1234', answer: 'Done.' }
    ])
  })

  it('caps a long Cursor answer at 20000 characters', async () => {
    const text = 'x'.repeat(MAX_CURSOR_ANSWER_LENGTH + 500)
    const { status } = await post('CursorAnswer', { conversation_id: 'abcdefgh-1234', text })

    expect(status).toBe(204)
    expect(receivedEvents[0]?.answer).toHaveLength(MAX_CURSOR_ANSWER_LENGTH)
  })

  it('a CursorAnswer without text has no answer field', async () => {
    const { status } = await post('CursorAnswer', { conversation_id: 'abcdefgh-1234' })

    expect(status).toBe(204)
    expect(receivedEvents[0]).toEqual({ sessionId: 'session-1', event: 'CursorAnswer', chatId: 'abcdefgh-1234' })
    expect(receivedEvents[0]).not.toHaveProperty('answer')
  })

  it('Stop carries the conversation id as chatId', async () => {
    const { status } = await post('Stop', { conversation_id: 'abcdefgh-1234', hook_event_name: 'stop' })

    expect(status).toBe(204)
    expect(receivedEvents[0]).toEqual({ sessionId: 'session-1', event: 'Stop', chatId: 'abcdefgh-1234' })
  })

  it('UserPromptSubmit carries both prompt and chatId', async () => {
    const { status } = await post('UserPromptSubmit', {
      conversation_id: 'abcdefgh-1234',
      prompt: 'fix the failing test'
    })

    expect(status).toBe(204)
    expect(receivedEvents[0]).toEqual({
      sessionId: 'session-1',
      event: 'UserPromptSubmit',
      prompt: 'fix the failing test',
      chatId: 'abcdefgh-1234'
    })
  })

  it('ignores a malformed conversation_id instead of rejecting the event', async () => {
    const { status } = await post('Stop', { conversation_id: 'bad id!', hook_event_name: 'stop' })

    expect(status).toBe(204)
    expect(receivedEvents[0]).toEqual({ sessionId: 'session-1', event: 'Stop' })
  })

  it('does not read text as an answer for a non-CursorAnswer event', async () => {
    const { status } = await post('Notification', { conversation_id: 'abcdefgh-1234', text: 'not an answer' })

    expect(status).toBe(204)
    expect(receivedEvents[0]).not.toHaveProperty('answer')
  })

  it('still requires the token on the Cursor route', async () => {
    const { status } = await post('CursorAnswer', { conversation_id: 'abcdefgh-1234', text: 'hi' }, { 'x-token': 'wrong' })

    expect(status).toBe(401)
    expect(receivedEvents).toEqual([])
  })
})
