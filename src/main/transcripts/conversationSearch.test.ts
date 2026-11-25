import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import type { Session } from '../../shared/types'
import {
  createConversationSearch,
  findInMessages,
  lastAnswer,
  LOCATE_MISS_TTL_MS,
  LOCATE_TTL_MS,
  MAX_HITS_PER_SESSION,
  parseTranscript,
  type CacheLimits
} from './conversationSearch'

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
    readonly cacheLimits?: CacheLimits
    readonly opencodeLimits?: CacheLimits
    readonly readRange?: (path: string, start: number, length: number) => Promise<string>
  }

  function service(
    files: Record<string, string>,
    options: ServiceOptions = {}
  ): { search: ReturnType<typeof createConversationSearch>; reads: string[]; ranges: Array<{ start: number; length: number }>; scans: () => number } {
    const reads: string[] = []
    const ranges: Array<{ start: number; length: number }> = []
    let scans = 0
    const search = createConversationSearch({
      configDir: () => config,
      readdir: async (dir) => {
        scans += 1
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
      readRange: async (path, start, length) => {
        ranges.push({ start, length })
        if (options.readRange !== undefined) return options.readRange(path, start, length)
        return files[path.replace(/\\/g, '/')]?.slice(start, start + length) ?? ''
      },
      ...(options.runOpencodeExport !== undefined ? { runOpencodeExport: options.runOpencodeExport } : {}),
      ...(options.now !== undefined ? { now: options.now } : {})
    }, options.cacheLimits, options.opencodeLimits)
    return { search, reads, ranges, scans: () => scans }
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

  // --- append-only growth (performance review): parse only the new bytes

  it('parses only appended bytes when a transcript grows, matching a full parse exactly', async () => {
    const path = p('a', 'c1')
    const first = [user('hello world', '2026-10-30T10:00:00.000Z'), assistant('first reply')].join('\n')
    const files: Record<string, string> = { [path]: first }
    const { search: incremental, reads, ranges } = service(files)
    const s = session('s1', 'c1')
    expect((await incremental.messagesOfSession(s))?.map((m) => m.text)).toEqual(['hello world', 'first reply'])
    expect(reads).toHaveLength(1)

    // The next line arrives without its trailing '\n' first, then is completed by the later append.
    const partial = user('partial line', '2026-10-30T10:01:00.000Z')
    files[path] = first + '\n' + partial
    expect(await incremental.messagesOfSession(s)).toEqual(parseTranscript(files[path]))

    files[path] += '\n' + [
      assistant('second reply'), user('one more question'), assistant('third reply')
    ].join('\n') + '\n'
    const grown = await incremental.messagesOfSession(s)
    expect(grown).toEqual(parseTranscript(files[path]))
    expect(grown).toEqual(await service({ [path]: files[path] }).search.messagesOfSession(s))
    expect(reads).toHaveLength(1) // the (possibly 50 MB) file was never re-read in full
    expect(ranges.length).toBeGreaterThan(0)
  })

  it('falls back to a full read when the transcript shrank', async () => {
    const path = p('a', 'c1')
    const files: Record<string, string> = { [path]: [user('alpha one'), user('alpha two')].join('\n') }
    const { search, reads, ranges } = service(files)
    const s = session('s1', 'c1')
    expect((await search.messagesOfSession(s))?.map((m) => m.text)).toEqual(['alpha one', 'alpha two'])
    const before = ranges.length
    files[path] = user('alpha one')
    expect((await search.messagesOfSession(s))?.map((m) => m.text)).toEqual(['alpha one'])
    expect(reads).toHaveLength(2)
    expect(ranges).toHaveLength(before)
  })

  it('falls back to a full read when the byte before the cached offset is not a newline', async () => {
    const path = p('a', 'c1')
    const files: Record<string, string> = { [path]: [user('alpha'), user('beta')].join('\n') }
    let corruptBoundary = false
    const { search, reads } = service(files, {
      readRange: async (file, start, length) => {
        if (corruptBoundary && length === 1) return 'X'
        return files[file.replace(/\\/g, '/')]?.slice(start, start + length) ?? ''
      }
    })
    const s = session('s1', 'c1')
    expect((await search.messagesOfSession(s))?.map((m) => m.text)).toEqual(['alpha', 'beta'])
    corruptBoundary = true
    files[path] += '\n' + user('gamma')
    expect((await search.messagesOfSession(s))?.map((m) => m.text)).toEqual(['alpha', 'beta', 'gamma'])
    expect(reads).toHaveLength(2)
  })

  it('falls back to a full read when the range read fails, still skipping broken lines', async () => {
    const path = p('a', 'c1')
    const files: Record<string, string> = { [path]: [user('alpha'), user('beta')].join('\n') }
    let failRange = false
    const { search, reads } = service(files, {
      readRange: async (file, start, length) => {
        if (failRange) throw new Error('EIO')
        return files[file.replace(/\\/g, '/')]?.slice(start, start + length) ?? ''
      }
    })
    const s = session('s1', 'c1')
    expect((await search.messagesOfSession(s))?.map((m) => m.text)).toEqual(['alpha', 'beta'])
    failRange = true
    files[path] += '\n{broken json\n' + user('gamma')
    const messages = await search.messagesOfSession(s)
    expect(messages).toEqual(parseTranscript(files[path]))
    expect(messages?.map((m) => m.text)).toEqual(['alpha', 'beta', 'gamma'])
    expect(reads).toHaveLength(2)
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

  // --- cache bounds and path lookup TTL (performance review)

  it('evicts parsed transcripts by recency, and a hit refreshes that recency', async () => {
    const { search, reads } = service({
      [p('a', 'c1')]: user('alpha one'),
      [p('a', 'c2')]: user('alpha two'),
      [p('a', 'c3')]: user('alpha three')
    }, { cacheLimits: { maxEntries: 2, maxBytes: 1024 * 1024 } })
    const readIds = (): string[] => reads.map((file) => file.split(/[\\/]/).at(-1) ?? '')
    await search.search([session('s1', 'c1')], 'alpha')
    await search.search([session('s2', 'c2')], 'alpha')
    await search.search([session('s1', 'c1')], 'alpha') // hit: c1 is now the most recently used
    expect(readIds()).toEqual(['c1.jsonl', 'c2.jsonl'])
    await search.search([session('s3', 'c3')], 'alpha') // c2 was the oldest, so it is evicted
    await search.search([session('s1', 'c1')], 'alpha') // the hit kept c1 cached
    expect(readIds()).toEqual(['c1.jsonl', 'c2.jsonl', 'c3.jsonl'])
    await search.search([session('s2', 'c2')], 'alpha') // re-read; now c3 is the oldest
    await search.search([session('s1', 'c1')], 'alpha') // c1 is still cached
    expect(readIds()).toEqual(['c1.jsonl', 'c2.jsonl', 'c3.jsonl', 'c2.jsonl'])
  })

  it('evicts parsed transcripts by total approximate size too', async () => {
    const first = user('x'.repeat(400))
    const second = user('y'.repeat(400))
    const { search, reads } = service({
      [p('a', 'c1')]: first,
      [p('a', 'c2')]: second
    }, { cacheLimits: { maxEntries: 10, maxBytes: first.length + second.length - 1 } })
    await search.search([session('s1', 'c1')], 'xxx')
    await search.search([session('s2', 'c2')], 'xxx') // the two entries would exceed the byte budget
    await search.search([session('s1', 'c1')], 'xxx') // so c1 had to be re-read
    expect(reads).toHaveLength(3)
  })

  it('bounds the OpenCode export cache by recency too', async () => {
    let clock = 1000
    let calls = 0
    const run = async (): Promise<string> => {
      calls += 1
      return exportJson([{ role: 'user', text: 'alpha', at: 1 }])
    }
    const { search } = service({}, {
      runOpencodeExport: run,
      now: () => clock,
      opencodeLimits: { maxEntries: 2, maxBytes: 1024 * 1024 }
    })
    const a = opencodeSession('a', 'ses_a', { lastActiveAt: 1 })
    const b = opencodeSession('b', 'ses_b', { lastActiveAt: 1 })
    const c = opencodeSession('c', 'ses_c', { lastActiveAt: 1 })
    await search.search([a], 'alpha')
    await search.search([b], 'alpha')
    await search.search([a], 'alpha') // hit refreshes a
    await search.search([c], 'alpha') // b was the oldest, so its export is dropped
    expect(calls).toBe(3)
    await search.search([b], 'alpha')
    expect(calls).toBe(4)
  })

  it('reuses a located path inside the TTL and rescans after it', async () => {
    let clock = 1000
    const { search, scans } = service({ [p('a', 'c1')]: user('hello world') }, { now: () => clock })
    await search.messagesOfSession(session('s', 'c1'))
    expect(scans()).toBe(2) // the projects folder plus one project folder
    await search.messagesOfSession(session('s', 'c1'))
    expect(scans()).toBe(2)
    clock += LOCATE_TTL_MS
    await search.messagesOfSession(session('s', 'c1'))
    expect(scans()).toBe(4)
  })

  it('rescans when a cached transcript path no longer exists', async () => {
    const files: Record<string, string> = { [p('a', 'c1')]: user('move me') }
    const { search, scans } = service(files)
    const s = session('s', 'c1')
    expect((await search.messagesOfSession(s))?.map((m) => m.text)).toEqual(['move me'])
    const before = scans()
    delete files[p('a', 'c1')]
    files[p('b', 'c1')] = user('move me')
    expect((await search.messagesOfSession(s))?.map((m) => m.text)).toEqual(['move me'])
    expect(scans()).toBeGreaterThan(before)
  })

  it('caches a not-found lookup for the short miss TTL only', async () => {
    let clock = 1000
    const { search, scans } = service({}, { now: () => clock }) // no projects folder
    await search.messagesOfSession(session('s', 'missing'))
    expect(scans()).toBe(1)
    await search.messagesOfSession(session('s', 'missing'))
    clock += LOCATE_MISS_TTL_MS - 1
    await search.messagesOfSession(session('s', 'missing'))
    expect(scans()).toBe(1)
    clock += 2
    await search.messagesOfSession(session('s', 'missing'))
    expect(scans()).toBe(2)
  })
})
