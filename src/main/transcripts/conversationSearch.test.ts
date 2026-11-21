import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import type { Session } from '../../shared/types'
import { createConversationSearch, findInMessages, lastAnswer, MAX_HITS_PER_SESSION, parseTranscript } from './conversationSearch'

const line = (obj: unknown): string => JSON.stringify(obj)
const user = (text: unknown, timestamp = '2026-10-30T10:00:00.000Z', extra: object = {}): string =>
  line({ type: 'user', timestamp, message: { role: 'user', content: text }, ...extra })
const assistant = (text: string, timestamp = '2026-10-30T10:00:05.000Z'): string =>
  line({ type: 'assistant', timestamp, message: { role: 'assistant', content: [{ type: 'text', text }, { type: 'tool_use', name: 'Bash' }] } })

describe('parseTranscript', () => {
  it('keeps typed user text and assistant text parts, with timestamps', () => {
    const text = [
      line({ type: 'mode', sessionId: 'x' }),
      user('Fix the login bug'),
      assistant('Looking at auth.ts now'),
      user([{ type: 'tool_result', content: 'output' }]),
      user('<command-name>/clear</command-name>'),
      user('meta stuff', undefined, { isMeta: true }),
      '{broken json',
      ''
    ].join('\n')
    expect(parseTranscript(text)).toEqual([
      { role: 'user', text: 'Fix the login bug', at: Date.parse('2026-10-30T10:00:00.000Z') },
      { role: 'assistant', text: 'Looking at auth.ts now', at: Date.parse('2026-10-30T10:00:05.000Z') }
    ])
  })
})

describe('lastAnswer (D54)', () => {
  it('joins every assistant text after the last user message', () => {
    const m = (role: 'user' | 'assistant', text: string) => ({ role, text, at: null })
    expect(lastAnswer([m('user', 'a'), m('assistant', 'old'), m('user', 'b'), m('assistant', 'one'), m('assistant', 'two')])).toBe('one\n\ntwo')
    expect(lastAnswer([m('assistant', 'old'), m('user', 'pending')])).toBe('')
    expect(lastAnswer([])).toBe('')
  })
})

describe('findInMessages', () => {
  it('finds case-insensitively and cuts an excerpt around the match', () => {
    const long = `${'a '.repeat(80)}The PINEAPPLE codeword ${'b '.repeat(80)}`
    const [hit] = findInMessages([{ role: 'user', text: long, at: 1 }], 's1', 'pineapple', 5)
    expect(hit?.snippet.startsWith('…')).toBe(true)
    expect(hit?.snippet.endsWith('…')).toBe(true)
    expect(hit?.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)).toBe('PINEAPPLE')
    expect(hit).toMatchObject({ sessionId: 's1', role: 'user', at: 1 })
  })

  it('stops at the limit', () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({ role: 'user' as const, text: `word ${i}`, at: i }))
    expect(findInMessages(messages, 's', 'word', 3)).toHaveLength(3)
  })
})

describe('createConversationSearch', () => {
  const config = 'C:/fake-claude'
  const session = (id: string, claudeSessionId: string, extra: Partial<Session> = {}): Session => ({
    id, name: id, cwd: 'C:/p', groupId: null, statusId: null, order: 0, createdAt: 0, claudeArgs: [], claudeSessionId, ...extra
  })
  const opencodeSession = (id: string, opencodeSessionId: string, extra: Partial<Session> = {}): Session => ({
    id, name: id, cwd: 'C:/p', groupId: null, statusId: null, order: 0, createdAt: 0, claudeArgs: [], agent: 'opencode', opencodeSessionId, ...extra
  })
  /** Minimal `opencode session export` JSON (see opencodeTranscript.ts). */
  const exportJson = (turns: ReadonlyArray<{ role: 'user' | 'assistant'; text: string; at: number }>): string =>
    JSON.stringify({
      info: { id: 'ses_x' },
      messages: turns.map((turn, i) =>
        turn.role === 'user'
          ? { id: `m${i}`, type: 'user', text: turn.text, time: { created: turn.at } }
          : { id: `m${i}`, type: 'assistant', content: [{ type: 'text', text: turn.text }], time: { created: turn.at } }
      )
    })

  interface ServiceOptions {
    readonly runOpencodeExport?: (args: string[]) => Promise<string>
    readonly now?: () => number
  }

  function service(files: Record<string, string>, options: ServiceOptions = {}): { search: ReturnType<typeof createConversationSearch>; reads: string[] } {
    const reads: string[] = []
    const search = createConversationSearch({
      configDir: () => config,
      readdir: async (dir) => {
        const prefix = dir.replace(/\\/g, '/') + '/'
        const names = new Set<string>()
        for (const path of Object.keys(files)) {
          if (path.startsWith(prefix)) names.add(path.slice(prefix.length).split('/')[0] as string)
        }
        if (names.size === 0) throw new Error('ENOENT')
        return [...names]
      },
      stat: async (file) => (files[file.replace(/\\/g, '/')] === undefined ? null : { size: files[file.replace(/\\/g, '/')]!.length, mtimeMs: 1 }),
      readFile: async (file) => {
        reads.push(file)
        return files[file.replace(/\\/g, '/')] ?? ''
      },
      ...(options.runOpencodeExport !== undefined ? { runOpencodeExport: options.runOpencodeExport } : {}),
      ...(options.now !== undefined ? { now: options.now } : {})
    })
    return { search, reads }
  }

  const p = (project: string, id: string): string => join(config, 'projects', project, `${id}.jsonl`).replace(/\\/g, '/')

  it('searches the transcripts of Claude sessions, newest hit first (an OpenCode session without an export id is skipped)', async () => {
    const { search } = service({
      [p('a', 'c1')]: [user('deploy to staging', '2026-10-29T10:00:00.000Z'), assistant('Deploy done', '2026-10-29T10:01:00.000Z')].join('\n'),
      [p('b', 'c2')]: user('how do I deploy?', '2026-10-30T09:00:00.000Z'),
      [p('b', 'other')]: user('deploy in a session SessionDeck does not know')
    })
    const result = await search.search([session('s1', 'c1'), session('s2', 'c2'), session('oc', 'c3', { agent: 'opencode' })], 'DEPLOY')
    expect(result.searchedSessions).toBe(2)
    expect(result.hits.map((h) => [h.sessionId, h.role])).toEqual([['s2', 'user'], ['s1', 'assistant'], ['s1', 'user']])
    expect(result.truncated).toBe(false)
  })

  it('searches an OpenCode session through the export runner, next to the Claude transcripts (D79)', async () => {
    const calls: string[][] = []
    const run = async (args: string[]): Promise<string> => {
      calls.push(args)
      return exportJson([
        { role: 'user', text: 'please deploy the API', at: 1 },
        { role: 'assistant', text: 'Deploy finished on port 8080', at: 2 }
      ])
    }
    const { search } = service({ [p('a', 'c1')]: user('deploy notes', '2026-10-30T09:00:00.000Z') }, { runOpencodeExport: run })
    const result = await search.search([session('s1', 'c1'), opencodeSession('oc', 'ses_abc123', { lastActiveAt: 1 })], 'deploy')
    expect(calls).toEqual([['session', 'export', 'ses_abc123']])
    expect(result.searchedSessions).toBe(2)
    expect(result.hits.map((h) => [h.sessionId, h.role])).toEqual([['s1', 'user'], ['oc', 'assistant'], ['oc', 'user']])
  })

  it('reuses an OpenCode export until the session updates, and always for a fresh last answer (D79)', async () => {
    let calls = 0
    let clock = 1000
    const run = async (): Promise<string> => {
      calls += 1
      return exportJson([{ role: 'user', text: 'deploy please', at: 1 }])
    }
    const { search } = service({}, { runOpencodeExport: run, now: () => clock })
    const before = opencodeSession('oc', 'ses_abc123', { lastActiveAt: 10 })
    await search.search([before], 'deploy')
    clock += 2000
    await search.search([before], 'deploy')
    expect(calls).toBe(1) // same updated time: the cached export is reused
    clock += 6000
    expect((await search.messagesOfSession(before))?.map((m) => m.text)).toEqual(['deploy please'])
    expect(calls).toBe(2) // a last answer wants a fresh export after a few seconds
    await search.search([{ ...before, lastActiveAt: 11 }], 'deploy')
    expect(calls).toBe(3) // the session moved: export again
  })

  it('returns the exported turns of one OpenCode session; null without an id, a runner or a readable export (D79)', async () => {
    let calls = 0
    const run = async (): Promise<string> => {
      calls += 1
      return exportJson([
        { role: 'user', text: 'hi', at: 1 },
        { role: 'assistant', text: 'hello', at: 2 }
      ])
    }
    const { search } = service({}, { runOpencodeExport: run })
    const oc = opencodeSession('oc', 'ses_abc123', { lastActiveAt: 1 })
    expect((await search.messagesOfSession(oc))?.map((m) => m.text)).toEqual(['hi', 'hello'])
    expect(await search.messagesOfSession(opencodeSession('no-id', ''))).toBeNull()
    const failing = service({}, { runOpencodeExport: async () => { throw new Error('Session not found') } })
    expect(await failing.search.messagesOfSession(oc)).toBeNull()
    expect(await service({}).search.messagesOfSession(oc)).toBeNull() // no runner injected
  })

  it('caps OpenCode exports at three processes at once so a search stays bounded (D79)', async () => {
    let active = 0
    let peak = 0
    let calls = 0
    const run = async (): Promise<string> => {
      calls += 1
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return exportJson([{ role: 'assistant', text: 'synchronize done', at: 1 }])
    }
    const sessions = Array.from({ length: 6 }, (_, i) => opencodeSession(`oc${i}`, `ses_a${i}`, { lastActiveAt: 1 }))
    const result = await service({}, { runOpencodeExport: run }).search.search(sessions, 'synchronize')
    expect(calls).toBe(6)
    expect(peak).toBeLessThanOrEqual(3)
    expect(result.searchedSessions).toBe(6)
    expect(result.hits).toHaveLength(6)
  })

  it('reuses the parsed transcript while the file is unchanged', async () => {
    const { search, reads } = service({ [p('a', 'c1')]: user('hello world') })
    await search.search([session('s1', 'c1')], 'hello')
    await search.search([session('s1', 'c1')], 'world')
    expect(reads).toHaveLength(1)
  })

  it('caps the hits per session and says so', async () => {
    const many = Array.from({ length: MAX_HITS_PER_SESSION + 5 }, (_, i) => user(`match ${i}`)).join('\n')
    const result = await (service({ [p('a', 'c1')]: many }).search).search([session('s1', 'c1')], 'match')
    expect(result.hits).toHaveLength(MAX_HITS_PER_SESSION)
    expect(result.truncated).toBe(true)
  })

  it('reads the messages of one Claude session; null for OpenCode or no saved conversation (D54)', async () => {
    const { search } = service({ [p('a', 'c1')]: [user('hi'), assistant('hello')].join('\n') })
    expect((await search.messagesOfSession(session('s1', 'c1')))?.map((m) => m.text)).toEqual(['hi', 'hello'])
    expect(await search.messagesOfSession(session('s2', 'missing'))).toBeNull()
    expect(await search.messagesOfSession(session('oc', 'c1', { agent: 'opencode' }))).toBeNull()
  })

  it('rejects a too short query and copes with no projects folder', async () => {
    const { search } = service({})
    await expect(search.search([], 'a')).rejects.toThrow('2 to 200')
    expect(await search.search([session('s1', 'c1')], 'hello')).toEqual({ hits: [], truncated: false, searchedSessions: 0 })
  })
})
