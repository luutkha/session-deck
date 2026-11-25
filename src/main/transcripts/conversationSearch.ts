// Conversation search (D52): finds text in the saved conversations of SessionDeck's sessions. Claude Code
// transcripts live in <CLAUDE_CONFIG_DIR | ~/.claude>/projects/<project>/<conversation id>.jsonl and are read only;
// parsed transcripts are cached by file size and modification time. OpenCode sessions (D79) have no such file: their
// turns come from the injected `opencode session export` runner (opencodeTranscript.ts), cached per session and
// capped at a few processes at once. Nothing here writes a transcript.
import { join } from 'node:path'
import { open } from 'node:fs/promises'
import type { ConversationHit, ConversationSearchResult, Id, Session } from '../../shared/types'
import { isRecord } from '../../shared/guards'
import { exportOpencodeSession } from './opencodeTranscript'

export const SEARCH_QUERY_MIN = 2
export const SEARCH_QUERY_MAX = 200
export const MAX_HITS = 200
export const MAX_HITS_PER_SESSION = 20
/** A transcript larger than this is skipped (it would block the main process for too long). */
export const MAX_TRANSCRIPT_BYTES = 50 * 1024 * 1024
const SNIPPET_RADIUS = 60
/** Bounds the parsed-transcript caches: an unbounded Map kept whole transcripts (up to MAX_TRANSCRIPT_BYTES) forever. */
export const MAX_CACHE_ENTRIES = 24
export const MAX_CACHE_BYTES = 200 * 1024 * 1024
/** A located path is reused briefly; a "not found" answer is only trusted for a few seconds. */
export const LOCATE_TTL_MS = 30_000
export const LOCATE_MISS_TTL_MS = 5_000

/** Injectable bounds (tests use small ones); both caches default to 24 entries / ~200 MB. */
export interface CacheLimits {
  readonly maxEntries: number
  readonly maxBytes: number
}
export const DEFAULT_CACHE_LIMITS: CacheLimits = { maxEntries: MAX_CACHE_ENTRIES, maxBytes: MAX_CACHE_BYTES }

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
  /** Byte-range read for append-only growth; the default opens the file with fs.promises. */
  readonly readRange?: (path: string, start: number, length: number) => Promise<string>
  /** D79: the injected `opencode session export` runner (see main/opencode/exportRunner.ts); absent = no OpenCode search. */
  readonly runOpencodeExport?: (args: string[]) => Promise<string>
  /** Clock for the OpenCode cache (tests); Date.now otherwise. */
  readonly now?: () => number
}

export interface ConversationSearch {
  search(sessions: readonly Session[], query: string): Promise<ConversationSearchResult>
  /** D54: the saved messages of one session (cached like search); null when it has no saved conversation. */
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
  /** Byte offset after the last complete line; a trailing line without '\n' is re-read when the file grows. */
  readonly parsedBytes: number
  /** Messages from the unfinished line at `parsedBytes`, so an appended tail can replace them exactly. */
  readonly partialMessages: readonly TranscriptMessage[]
}

/** Byte-range read: ranges always start at a line boundary, so UTF-8 decoding cannot split a character. */
async function defaultReadRange(path: string, start: number, length: number): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, start)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

/** Splits off an unfinished last line; `text` is the newly read region and `fromByte` its absolute start. */
function completePrefix(text: string, fromByte = 0): { readonly parsedBytes: number; readonly partialLine: string } {
  const lastNewline = text.lastIndexOf('\n')
  if (lastNewline < 0) return { parsedBytes: fromByte, partialLine: text }
  return {
    parsedBytes: fromByte + Buffer.byteLength(text.slice(0, lastNewline + 1), 'utf8'),
    partialLine: text.slice(lastNewline + 1)
  }
}

/**
 * D79: how long an OpenCode export may answer get_last_answer / Jarvis's reply. fleet_digest asks for every session
 * in one turn, and an export is a whole process; a few seconds are enough to share one export between those calls.
 */
export const OPENCODE_ANSWER_TTL_MS = 5000
/** In a search the session's own last-active time rules; this only stops a very old entry from being reused forever. */
export const OPENCODE_SEARCH_MAX_AGE_MS = 60_000
/** At most this many `opencode session export` processes at once, so a big fleet does not swamp the machine. */
export const OPENCODE_MAX_CONCURRENT = 3

interface OpencodeEntry {
  /** The session's last-active time when the export was started (D61); a changed value means new messages. */
  readonly key: number
  readonly at: number
  readonly messages: readonly TranscriptMessage[] | null
}

/**
 * An LRU over a Map: a hit moves the entry to the end, an insert evicts the least-recently-used first until both the
 * entry count and the approximate byte budget are met. `sizeOf` is the file size for transcripts and the text length
 * for OpenCode exports.
 */
function createLru<V>(limits: CacheLimits, sizeOf: (value: V) => number) {
  const entries = new Map<string, { readonly value: V; readonly size: number }>()
  let bytes = 0
  return {
    get(key: string): V | undefined {
      const hit = entries.get(key)
      if (hit === undefined) return undefined
      entries.delete(key)
      entries.set(key, hit)
      return hit.value
    },
    set(key: string, value: V): void {
      const previous = entries.get(key)
      if (previous !== undefined) bytes -= previous.size
      const size = sizeOf(value)
      entries.delete(key)
      entries.set(key, { value, size })
      bytes += size
      while (entries.size > limits.maxEntries || bytes > limits.maxBytes) {
        const oldest = entries.keys().next()
        if (oldest.done === true) break
        const entry = entries.get(oldest.value)
        if (entry === undefined) break
        bytes -= entry.size
        entries.delete(oldest.value)
      }
    }
  }
}

export function createConversationSearch(
  deps: ConversationSearchDeps,
  limits: CacheLimits = DEFAULT_CACHE_LIMITS,
  opencodeLimits: CacheLimits = DEFAULT_CACHE_LIMITS
): ConversationSearch {
  const cache = createLru(limits, (entry: CacheEntry) => entry.size)
  const opencodeCache = createLru(opencodeLimits, (entry: OpencodeEntry) =>
    (entry.messages ?? []).reduce((sum, message) => sum + message.text.length, 0))
  const opencodeFlights = new Map<string, Promise<readonly TranscriptMessage[] | null>>()
  /** id -> last located path; `null` is a recent "not found", with its own shorter TTL. */
  const located = new Map<string, { readonly path: string | null; readonly at: number }>()
  let scanFlight: Promise<Map<string, string>> | null = null
  let opencodeActive = 0
  const opencodeWaiting: Array<() => void> = []
  const now = (): number => (deps.now ?? Date.now)()
  const readRange = deps.readRange ?? defaultReadRange

  /**
   * A transcript only grows: parse the appended bytes instead of the whole (up to 50 MB) file. Returns null if the
   * cached offset is not a trustworthy line boundary, so the caller falls back to the old full read + parse.
   */
  async function appendedEntry(path: string, cached: CacheEntry, size: number, mtimeMs: number): Promise<CacheEntry | null> {
    if (cached.parsedBytes > cached.size || cached.parsedBytes > size) return null
    try {
      if (cached.parsedBytes > 0 && await readRange(path, cached.parsedBytes - 1, 1) !== '\n') return null
      // The offset stops before the unfinished line, so the range read already contains it: replace the messages
      // that line contributed instead of prepending it again. Lines are independent JSON, so this equals a full parse.
      const tail = await readRange(path, cached.parsedBytes, size - cached.parsedBytes)
      const messages = [
        ...cached.messages.slice(0, cached.messages.length - cached.partialMessages.length),
        ...parseTranscript(tail)
      ]
      const prefix = completePrefix(tail, cached.parsedBytes)
      return {
        size, mtimeMs, messages,
        parsedBytes: prefix.parsedBytes,
        partialMessages: parseTranscript(prefix.partialLine)
      }
    } catch {
      return null
    }
  }

  /** Runs one export when a slot is free (first in, first out); the caller waits otherwise. */
  async function withOpencodeSlot<T>(task: () => Promise<T>): Promise<T> {
    if (opencodeActive >= OPENCODE_MAX_CONCURRENT) {
      // The task that frees the slot hands it over, so `opencodeActive` already counts this caller.
      await new Promise<void>((resolve) => opencodeWaiting.push(resolve))
    } else {
      opencodeActive += 1
    }
    try {
      return await task()
    } finally {
      const next = opencodeWaiting.shift()
      if (next !== undefined) next()
      else opencodeActive -= 1
    }
  }

  /** D61: the session's own "updated" time; a turn or a prompt moves it, so a new value means new messages. */
  function updatedAt(session: Session): number {
    return session.lastActiveAt ?? session.createdAt
  }

  /**
   * D79: the turns of an OpenCode session. Reused while the session's updated time is unchanged and the entry is
   * younger than `maxAgeMs`; concurrent callers share one process. null (no id, no runner, a failed export) means
   * "no conversation", never an empty one.
   */
  async function opencodeMessages(session: Session, maxAgeMs: number): Promise<readonly TranscriptMessage[] | null> {
    const sessionId = session.opencodeSessionId
    const run = deps.runOpencodeExport
    if (sessionId === undefined || run === undefined) return null
    const startedAt = now()
    const key = updatedAt(session)
    const cached = opencodeCache.get(sessionId)
    if (cached !== undefined && cached.key === key && startedAt - cached.at < maxAgeMs) return cached.messages
    const flying = opencodeFlights.get(sessionId)
    if (flying !== undefined) return flying
    const flight = withOpencodeSlot(() => exportOpencodeSession(sessionId, run))
      .then((messages): readonly TranscriptMessage[] | null => {
        opencodeCache.set(sessionId, { key, at: now(), messages })
        return messages
      })
      .catch((): readonly TranscriptMessage[] | null => null)
      .finally((): void => {
        opencodeFlights.delete(sessionId)
      })
    opencodeFlights.set(sessionId, flight)
    return flight
  }

  /** One listing of the projects tree; concurrent callers share the same in-flight scan. */
  function scanProjects(): Promise<Map<string, string>> {
    if (scanFlight !== null) return scanFlight
    scanFlight = (async (): Promise<Map<string, string>> => {
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
          if (!found.has(id)) found.set(id, join(projects, dir, file))
        }
      }
      return found
    })().finally((): void => {
      scanFlight = null
    })
    return scanFlight
  }

  /**
   * conversation id -> transcript path. A located path is reused for LOCATE_TTL_MS (checked with a cheap stat so a
   * moved file is found again); a "not found" answer is reused for LOCATE_MISS_TTL_MS only. Without this a digest of
   * N sessions rescanned every project directory N times.
   */
  async function locate(ids: ReadonlySet<string>): Promise<Map<string, string>> {
    const found = new Map<string, string>()
    const missing = new Set<string>()
    const at = now()
    for (const id of ids) {
      const entry = located.get(id)
      if (entry !== undefined && at - entry.at < (entry.path === null ? LOCATE_MISS_TTL_MS : LOCATE_TTL_MS)) {
        if (entry.path === null) continue
        if (await deps.stat(entry.path) !== null) {
          found.set(id, entry.path)
          continue
        }
      }
      missing.add(id)
    }
    if (missing.size === 0) return found
    const scanned = await scanProjects()
    for (const id of missing) {
      const path = scanned.get(id) ?? null
      located.set(id, { path, at: now() })
      if (path !== null) found.set(id, path)
    }
    return found
  }

  async function messagesOf(path: string, id: string): Promise<readonly TranscriptMessage[]> {
    const info = await deps.stat(path)
    if (info === null || info.size > MAX_TRANSCRIPT_BYTES) {
      located.delete(id) // the cached path is gone or unusable: look it up again next time
      return []
    }
    const cached = cache.get(path) // LRU hit: move the entry to the most-recent end
    if (cached !== undefined && cached.size === info.size && cached.mtimeMs === info.mtimeMs) return cached.messages
    if (cached !== undefined && info.size > cached.size) {
      const grown = await appendedEntry(path, cached, info.size, info.mtimeMs)
      if (grown !== null) {
        cache.set(path, grown)
        return grown.messages
      }
    }
    let messages: readonly TranscriptMessage[]
    try {
      const text = await deps.readFile(path)
      messages = parseTranscript(text)
      const prefix = completePrefix(text)
      cache.set(path, {
        size: info.size, mtimeMs: info.mtimeMs, messages,
        parsedBytes: prefix.parsedBytes,
        partialMessages: parseTranscript(prefix.partialLine)
      })
    } catch (error) {
      located.delete(id) // the file may have moved; force a fresh scan on the next lookup
      throw error
    }
    return messages
  }

  return {
    async messagesOfSession(session: Session): Promise<readonly TranscriptMessage[] | null> {
      const agent = session.agent ?? 'claude'
      if (agent === 'opencode') {
        // D79: the real turns come from the export, not the screen; null when it cannot be read.
        return opencodeMessages(session, OPENCODE_ANSWER_TTL_MS)
      }
      if (agent !== 'claude' || session.claudeSessionId === undefined) return null
      const path = (await locate(new Set([session.claudeSessionId]))).get(session.claudeSessionId)
      return path === undefined ? null : messagesOf(path, session.claudeSessionId as string)
    },

    async search(sessions: readonly Session[], rawQuery: string): Promise<ConversationSearchResult> {
      const query = rawQuery.trim()
      if (query.length < SEARCH_QUERY_MIN || query.length > SEARCH_QUERY_MAX) {
        throw new Error(`Search text must be ${SEARCH_QUERY_MIN} to ${SEARCH_QUERY_MAX} characters`)
      }
      const claude = sessions.filter((s) => (s.agent ?? 'claude') === 'claude' && s.claudeSessionId !== undefined)
      // D79: OpenCode sessions with a conversation id are searched through the export (no local transcript file).
      const opencode = sessions.filter((s) => (s.agent ?? 'claude') === 'opencode' && s.opencodeSessionId !== undefined)
      const paths = await locate(new Set(claude.map((s) => s.claudeSessionId as string)))
      const hits: ConversationHit[] = []
      let truncated = false
      let searched = 0
      for (const session of claude) {
        const path = paths.get(session.claudeSessionId as string)
        if (path === undefined) continue
        let messages: readonly TranscriptMessage[]
        try {
          messages = await messagesOf(path, session.claudeSessionId as string)
        } catch {
          continue // an unreadable transcript is skipped
        }
        searched += 1
        const found = findInMessages(messages, session.id, query, MAX_HITS_PER_SESSION + 1)
        if (found.length > MAX_HITS_PER_SESSION) truncated = true
        hits.push(...found.slice(0, MAX_HITS_PER_SESSION))
      }
      // Bounded concurrency: opencodeMessages queues on at most OPENCODE_MAX_CONCURRENT processes; results are kept in
      // session order so the output stays stable.
      const opencodeFound = await Promise.all(
        opencode.map((session) =>
          opencodeMessages(session, OPENCODE_SEARCH_MAX_AGE_MS)
            .then((messages): ConversationHit[] | null =>
              messages === null ? null : findInMessages(messages, session.id, query, MAX_HITS_PER_SESSION + 1)
            )
            .catch((): ConversationHit[] | null => null)
        )
      )
      for (const found of opencodeFound) {
        if (found === null) continue
        searched += 1
        if (found.length > MAX_HITS_PER_SESSION) truncated = true
        hits.push(...found.slice(0, MAX_HITS_PER_SESSION))
      }
      hits.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
      if (hits.length > MAX_HITS) truncated = true
      return { hits: hits.slice(0, MAX_HITS), truncated, searchedSessions: searched }
    }
  }
}
