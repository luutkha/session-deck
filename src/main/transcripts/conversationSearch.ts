// Conversation search (D52): finds text in the saved Claude Code conversations of SessionDeck's sessions.
// Read-only: transcripts live in <CLAUDE_CONFIG_DIR | ~/.claude>/projects/<project>/<conversation id>.jsonl and are
// never written. Parsed transcripts are cached by file size and modification time.
import { join } from 'node:path'
import type { ConversationHit, ConversationSearchResult, Id, Session } from '../../shared/types'
import { isRecord } from '../../shared/guards'

export const SEARCH_QUERY_MIN = 2
export const SEARCH_QUERY_MAX = 200
export const MAX_HITS = 200
export const MAX_HITS_PER_SESSION = 20
/** A transcript larger than this is skipped (it would block the main process for too long). */
export const MAX_TRANSCRIPT_BYTES = 50 * 1024 * 1024
const SNIPPET_RADIUS = 60

export interface TranscriptMessage {
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly at: number | null
}

/** Text of a message's content: a plain string, or the `text` parts of a content list (tool calls/results skipped). */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part): part is { type: 'text'; text: string } => isRecord(part) && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
}

// Lines Claude Code adds to the user side that the user did not type (slash command echoes, reminders, caveats).
const INJECTED_RE = /^\s*<(command-name|command-message|command-args|local-command-stdout|local-command-caveat|system-reminder)>/

/** The user and assistant messages of one transcript (JSONL); broken lines and injected text are skipped. */
export function parseTranscript(text: string): readonly TranscriptMessage[] {
  const messages: TranscriptMessage[] = []
  for (const line of text.split('\n')) {
    if (line.length === 0 || !/"type":"(?:user|assistant)"/.test(line)) continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(entry) || (entry.type !== 'user' && entry.type !== 'assistant') || entry.isMeta === true) continue
    const message = entry.message
    if (!isRecord(message)) continue
    const body = contentText(message.content).trim()
    if (body.length === 0 || INJECTED_RE.test(body)) continue
    const at = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN
    messages.push({ role: entry.type, text: body, at: Number.isFinite(at) ? at : null })
  }
  return messages
}

/** Matches of `query` (case-insensitive) in the messages, each with a short excerpt; at most `limit`. */
export function findInMessages(messages: readonly TranscriptMessage[], sessionId: Id, query: string, limit: number): ConversationHit[] {
  const needle = query.toLowerCase()
  const hits: ConversationHit[] = []
  for (const message of messages) {
    if (hits.length >= limit) break
    const flat = message.text.replace(/\s+/g, ' ')
    const index = flat.toLowerCase().indexOf(needle)
    if (index < 0) continue
    const start = Math.max(0, index - SNIPPET_RADIUS)
    const end = Math.min(flat.length, index + needle.length + SNIPPET_RADIUS)
    const prefix = start > 0 ? '…' : ''
    const suffix = end < flat.length ? '…' : ''
    hits.push({
      sessionId,
      role: message.role,
      snippet: `${prefix}${flat.slice(start, end)}${suffix}`,
      matchStart: prefix.length + index - start,
      matchLength: needle.length,
      at: message.at
    })
  }
  return hits
}

export interface ConversationSearchDeps {
  readonly configDir: () => string
  readonly readdir: (dir: string) => Promise<readonly string[]>
  readonly stat: (file: string) => Promise<{ readonly size: number; readonly mtimeMs: number } | null>
  readonly readFile: (file: string) => Promise<string>
}

export interface ConversationSearch {
  search(sessions: readonly Session[], query: string): Promise<ConversationSearchResult>
  /** D54: the saved messages of one Claude session (cached like search); null when it has no saved conversation. */
  messagesOfSession(session: Session): Promise<readonly TranscriptMessage[] | null>
}

/**
 * D54: the assistant's reply to the LAST user message: every assistant text after it, joined. Empty when the last
 * message is the user's (the answer is still being written) or there is none.
 */
export function lastAnswer(messages: readonly TranscriptMessage[]): string {
  let lastUser = -1
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') {
      lastUser = i
      break
    }
  }
  return messages.slice(lastUser + 1).filter((m) => m.role === 'assistant').map((m) => m.text).join('\n\n')
}

interface CacheEntry {
  readonly size: number
  readonly mtimeMs: number
  readonly messages: readonly TranscriptMessage[]
}

export function createConversationSearch(deps: ConversationSearchDeps): ConversationSearch {
  const cache = new Map<string, CacheEntry>()

  /** conversation id -> transcript path, from one listing of the projects folder. */
  async function locate(ids: ReadonlySet<string>): Promise<Map<string, string>> {
    const found = new Map<string, string>()
    const projects = join(deps.configDir(), 'projects')
    let dirs: readonly string[]
    try {
      dirs = await deps.readdir(projects)
    } catch {
      return found // nothing saved yet
    }
    for (const dir of dirs) {
      let files: readonly string[]
      try {
        files = await deps.readdir(join(projects, dir))
      } catch {
        continue
      }
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue
        const id = file.slice(0, -'.jsonl'.length)
        if (ids.has(id) && !found.has(id)) found.set(id, join(projects, dir, file))
      }
    }
    return found
  }

  async function messagesOf(path: string): Promise<readonly TranscriptMessage[]> {
    const info = await deps.stat(path)
    if (info === null || info.size > MAX_TRANSCRIPT_BYTES) return []
    const cached = cache.get(path)
    if (cached !== undefined && cached.size === info.size && cached.mtimeMs === info.mtimeMs) return cached.messages
    const messages = parseTranscript(await deps.readFile(path))
    cache.set(path, { size: info.size, mtimeMs: info.mtimeMs, messages })
    return messages
  }

  return {
    async messagesOfSession(session: Session): Promise<readonly TranscriptMessage[] | null> {
      if ((session.agent ?? 'claude') !== 'claude' || session.claudeSessionId === undefined) return null
      const path = (await locate(new Set([session.claudeSessionId]))).get(session.claudeSessionId)
      return path === undefined ? null : messagesOf(path)
    },

    async search(sessions: readonly Session[], rawQuery: string): Promise<ConversationSearchResult> {
      const query = rawQuery.trim()
      if (query.length < SEARCH_QUERY_MIN || query.length > SEARCH_QUERY_MAX) {
        throw new Error(`Search text must be ${SEARCH_QUERY_MIN} to ${SEARCH_QUERY_MAX} characters`)
      }
      const claude = sessions.filter((s) => (s.agent ?? 'claude') === 'claude' && s.claudeSessionId !== undefined)
      const paths = await locate(new Set(claude.map((s) => s.claudeSessionId as string)))
      const hits: ConversationHit[] = []
      let truncated = false
      let searched = 0
      for (const session of claude) {
        const path = paths.get(session.claudeSessionId as string)
        if (path === undefined) continue
        let messages: readonly TranscriptMessage[]
        try {
          messages = await messagesOf(path)
        } catch {
          continue // an unreadable transcript is skipped
        }
        searched += 1
        const found = findInMessages(messages, session.id, query, MAX_HITS_PER_SESSION + 1)
        if (found.length > MAX_HITS_PER_SESSION) truncated = true
        hits.push(...found.slice(0, MAX_HITS_PER_SESSION))
      }
      hits.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
      if (hits.length > MAX_HITS) truncated = true
      return { hits: hits.slice(0, MAX_HITS), truncated, searchedSessions: searched }
    }
  }
}
