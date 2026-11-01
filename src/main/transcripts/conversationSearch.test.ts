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

  function service(files: Record<string, string>): { search: ReturnType<typeof createConversationSearch>; reads: string[] } {
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
      }
    })
    return { search, reads }
  }

  const p = (project: string, id: string): string => join(config, 'projects', project, `${id}.jsonl`).replace(/\\/g, '/')

  it('searches the transcripts of Claude sessions only, newest hit first', async () => {
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
