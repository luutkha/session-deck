import { describe, expect, it } from 'vitest'
import { exportOpencodeSession, lastAssistantAnswer, parseOpencodeExport } from './opencodeTranscript'

/**
 * Trimmed copy of a real `opencode session export ses_...` (opencode v2.1.4), with neutral text replacing the
 * conversation and only the fields this module reads. Real shape: `info` plus chronological `messages`, where user
 * messages carry `text` and assistant messages carry `content` parts.
 */
const EXPORT_FIXTURE = {
  info: {
    id: 'ses_abc123',
    projectID: 'p1',
    model: { id: 'm', providerID: 'p', variant: 'default' },
    time: { created: 1000, updated: 4000 },
    title: 'Demo session',
    location: { directory: 'C:\\work\\demo' }
  },
  messages: [
    { id: 'msg_1', time: { created: 1000 }, text: 'Fix the login bug', files: [], type: 'user' },
    {
      id: 'msg_2',
      time: { created: 1100, streamed: 1200, completed: 1300 },
      type: 'assistant',
      agent: 'build',
      content: [
        { type: 'reasoning', text: 'The user wants the login bug fixed.' },
        { type: 'text', text: 'Looking at auth.ts now.' },
        {
          type: 'tool',
          id: 'call_1',
          name: 'read',
          state: { status: 'completed', input: { path: 'auth.ts' }, content: [{ type: 'text', text: 'code' }] }
        },
        { type: 'text', text: 'The bug is a missing await.' }
      ],
      finish: 'stop'
    },
    { id: 'msg_3', time: { created: 1400 }, type: 'idle', outcome: 'succeeded' },
    {
      id: 'msg_4',
      time: { created: 1500 },
      metadata: { notice: 'restart' },
      text: 'The server restarted while you were working.',
      description: 'Continuing after restart',
      type: 'synthetic'
    },
    { id: 'msg_5', time: { created: 1600 }, type: 'agent-switched', agent: 'plan', previous: 'build' },
    { id: 'msg_6', time: { created: 2000 }, text: 'Then add a test', files: [], agents: [], type: 'user' },
    { id: 'msg_7', time: { created: 2100 }, type: 'assistant', content: [{ type: 'text', text: 'Added one.' }] },
    {
      id: 'msg_8',
      time: { created: 2200 },
      metadata: { notice: 'instructions' },
      type: 'system',
      text: 'The following skills have changed.'
    }
  ]
}

describe('parseOpencodeExport', () => {
  it('keeps user prompts and assistant text parts, with timestamps (real export shape)', () => {
    expect(parseOpencodeExport(EXPORT_FIXTURE)).toEqual([
      { role: 'user', text: 'Fix the login bug', at: 1000 },
      { role: 'assistant', text: 'Looking at auth.ts now.\nThe bug is a missing await.', at: 1300 },
      { role: 'user', text: 'Then add a test', at: 2000 },
      { role: 'assistant', text: 'Added one.', at: 2100 }
    ])
  })

  it('accepts a plain cloned object (no class or identity needed)', () => {
    expect(parseOpencodeExport(JSON.parse(JSON.stringify(EXPORT_FIXTURE)))).toHaveLength(4)
  })

  it('skips injected, empty and turn-control messages, and assistant messages with no text part', () => {
    const json = {
      messages: [
        { type: 'user', time: { created: 1 }, text: '   ' },
        { type: 'user', time: { created: 2 } },
        { type: 'assistant', time: { created: 3 }, content: [{ type: 'tool', name: 'read' }] },
        { type: 'assistant', time: { created: 4 }, content: [{ type: 'reasoning', text: 'thinking' }] },
        { type: 'assistant', time: { created: 5 }, content: 'not a list' },
        { type: 'synthetic', time: { created: 6 }, text: 'injected' },
        { type: 'system', time: { created: 7 }, text: 'injected' },
        { type: 'idle', time: { created: 8 }, outcome: 'succeeded' }
      ]
    }
    expect(parseOpencodeExport(json)).toEqual([])
  })

  it('uses time.created when the assistant message has no completed time, and null for unusable times', () => {
    expect(
      parseOpencodeExport({
        messages: [
          { type: 'user', text: 'hi' },
          { type: 'assistant', time: { created: 42 }, content: [{ type: 'text', text: 'hello' }] }
        ]
      })
    ).toEqual([
      { role: 'user', text: 'hi', at: null },
      { role: 'assistant', text: 'hello', at: 42 }
    ])
  })

  it('never throws on malformed input', () => {
    for (const bad of [null, undefined, 42, 'text', [], {}, { messages: 'nope' }, { messages: null }]) {
      expect(parseOpencodeExport(bad)).toEqual([])
    }
    expect(
      parseOpencodeExport({
        messages: [null, 42, 'x', [], { type: 'user', text: 7 }, { type: 'assistant', content: [null, 3] }]
      })
    ).toEqual([])
  })
})

describe('lastAssistantAnswer', () => {
  it('joins every assistant text after the last user message', () => {
    const turn = (role: 'user' | 'assistant', text: string) => ({ role, text, at: null })
    expect(lastAssistantAnswer([turn('user', 'a'), turn('assistant', 'old'), turn('user', 'b')])).toBeNull()
    expect(
      lastAssistantAnswer([turn('user', 'a'), turn('assistant', 'old'), turn('user', 'b'), turn('assistant', 'one'), turn('assistant', 'two')])
    ).toBe('one\n\ntwo')
  })

  it('returns the answer of the fixture’s last turn and null when there is none', () => {
    const turns = parseOpencodeExport(EXPORT_FIXTURE)
    expect(lastAssistantAnswer(turns)).toBe('Added one.')
    expect(lastAssistantAnswer(turns.slice(0, 3))).toBeNull() // last message is the user's: still being written
    expect(lastAssistantAnswer([])).toBeNull()
    expect(lastAssistantAnswer([{ role: 'assistant', text: 'unprompted', at: null }])).toBeNull()
  })
})

describe('exportOpencodeSession', () => {
  function fakeRunner(output: string | Error): { run: (args: string[]) => Promise<string>; calls: string[][] } {
    const calls: string[][] = []
    return {
      calls,
      run: async (args) => {
        calls.push(args)
        if (output instanceof Error) throw output
        return output
      }
    }
  }

  it('exports through an argument array and parses the turns', async () => {
    const { run, calls } = fakeRunner(JSON.stringify(EXPORT_FIXTURE))
    expect(await exportOpencodeSession('ses_abc123', run)).toEqual(parseOpencodeExport(EXPORT_FIXTURE))
    expect(calls).toEqual([['session', 'export', 'ses_abc123']])
  })

  it('refuses an id that is not ses_+alphanumerics before running anything', async () => {
    for (const id of ['abc', 'ses_', 'ses_abc-1', 'ses_abc; rm -rf /', '../ses_abc', 'ses_abc def']) {
      const { run, calls } = fakeRunner('{}')
      expect(await exportOpencodeSession(id, run)).toBeNull()
      expect(calls).toHaveLength(0)
    }
  })

  it('returns null on any runner or output failure', async () => {
    expect(await exportOpencodeSession('ses_abc', fakeRunner(new Error('exit 1')).run)).toBeNull()
    expect(await exportOpencodeSession('ses_abc', fakeRunner('').run)).toBeNull()
    expect(await exportOpencodeSession('ses_abc', fakeRunner('Session not found: ses_abc').run)).toBeNull()
    expect(await exportOpencodeSession('ses_abc', fakeRunner('[1,2,3]').run)).toBeNull()
    expect(await exportOpencodeSession('ses_abc', fakeRunner('{"info":{}}').run)).toBeNull()
    expect(await exportOpencodeSession('ses_abc', fakeRunner('{"messages":"nope"}').run)).toBeNull()
    expect(await exportOpencodeSession('ses_abc', fakeRunner('{broken').run)).toBeNull()
  })

  it('keeps a genuine empty conversation as [] and tolerates log lines before the JSON', async () => {
    expect(await exportOpencodeSession('ses_abc', fakeRunner('{"messages":[]}').run)).toEqual([])
    const prefixed = `log line\n${JSON.stringify(EXPORT_FIXTURE)}`
    expect(await exportOpencodeSession('ses_abc', fakeRunner(prefixed).run)).toHaveLength(4)
  })
})
