import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHookServer } from './HookServer'
import type { HookEvent } from '../../shared/types'
import { TIMELINE_PROMPT_MAX } from '../../shared/types'

describe('HookServer UserPromptSubmit prompt', () => {
  let server: ReturnType<typeof createHookServer>
  let baseUrl: string
  const token = 'prompt-token-123'
  let received: HookEvent[] = []

  beforeEach(async () => {
    received = []
    server = createHookServer({
      token,
      isKnownSession: (id) => id === 'session-1',
      onEvent: (event) => received.push(event)
    })
    const { port } = await server.start()
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    await server.stop()
  })

  /** Posts a raw body to the per-event hook route, the way the curl hook command does. */
  async function postRaw(event: string, body: string): Promise<number> {
    const response = await fetch(`${baseUrl}/hook/session-1/${event}`, {
      method: 'POST',
      headers: { 'x-token': token, 'content-type': 'application/json' },
      body
    })
    return response.status
  }

  async function promptFor(body: string): Promise<unknown> {
    received = []
    const status = await postRaw('UserPromptSubmit', body)
    expect(status).toBe(204)
    expect(received).toHaveLength(1)
    return received[0].prompt
  }

  it('passes the prompt field of the stdin JSON on UserPromptSubmit', async () => {
    const status = await postRaw('UserPromptSubmit', JSON.stringify({ prompt: 'fix the login bug', session_id: 'x' }))
    expect(status).toBe(204)
    expect(received[0]).toEqual({ sessionId: 'session-1', event: 'UserPromptSubmit', prompt: 'fix the login bug' })
  })

  it('collapses newlines, tabs and space runs to one space and trims', async () => {
    const prompt = await promptFor(JSON.stringify({ prompt: '  first line\n\n\tsecond\t\tline   end \r\n ' }))
    expect(prompt).toBe('first line second line end')
  })

  it('cuts the prompt to TIMELINE_PROMPT_MAX characters', async () => {
    const prompt = await promptFor(JSON.stringify({ prompt: 'a'.repeat(TIMELINE_PROMPT_MAX + 50) }))
    expect(prompt).toBe('a'.repeat(TIMELINE_PROMPT_MAX))
  })

  it('keeps unicode text intact and does not split an emoji in the cut', async () => {
    const emoji = '\u{1F600}'
    const text = `${'b'.repeat(TIMELINE_PROMPT_MAX - 1)}${emoji}tail`
    const prompt = await promptFor(JSON.stringify({ prompt: text }))
    expect(prompt).toBe(`${'b'.repeat(TIMELINE_PROMPT_MAX - 1)}${emoji}`)
  })

  it('keeps non-latin text as written', async () => {
    const prompt = await promptFor(JSON.stringify({ prompt: '日本語のプロンプト' }))
    expect(prompt).toBe('日本語のプロンプト')
  })

  it('omits the prompt when the field is an empty or whitespace-only string', async () => {
    received = []
    await postRaw('UserPromptSubmit', JSON.stringify({ prompt: '   \n\t ' }))
    expect(received[0]).not.toHaveProperty('prompt')
    expect(await promptFor(JSON.stringify({ prompt: '' }))).toBeUndefined()
  })

  it('omits the prompt when the field is missing or not a string', async () => {
    expect(await promptFor(JSON.stringify({ session_id: 'abc' }))).toBeUndefined()
    expect(await promptFor(JSON.stringify({ prompt: 42 }))).toBeUndefined()
    expect(await promptFor(JSON.stringify({ prompt: ['a'] }))).toBeUndefined()
  })

  it('still accepts the event with no prompt when the body is not JSON', async () => {
    expect(await promptFor('not json at all')).toBeUndefined()
  })

  it('still accepts the event with no prompt when the body is empty', async () => {
    expect(await promptFor('')).toBeUndefined()
  })

  it('omits the prompt when the JSON body is an array or null', async () => {
    expect(await promptFor('["prompt"]')).toBeUndefined()
    expect(await promptFor('null')).toBeUndefined()
  })

  it('never adds a prompt to other events, even when the body has one', async () => {
    for (const event of ['Stop', 'Notification']) {
      received = []
      const status = await postRaw(event, JSON.stringify({ prompt: 'should be ignored' }))
      expect(status).toBe(204)
      expect(received[0]).not.toHaveProperty('prompt')
    }
  })
})
