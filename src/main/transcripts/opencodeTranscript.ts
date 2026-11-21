/**
 * OpenCode transcripts (D54 for OpenCode): the real conversation text of an `opencode` session, so Jarvis'
 * get_last_answer and conversation search work for OpenCode like they do for Claude JSONL transcripts.
 *
 * Probed against opencode v2.1.4, read-only (`opencode session export --help`, then exports of real ids):
 *
 *   USAGE: opencode session export [flags] [<session>]   "Export session data as JSON"
 *   FLAGS: --standalone, --server string, --sanitize
 *
 * Export prints one JSON object: `{ info: {...}, messages: [...] }`. `info` (id, projectID, model, cost, tokens,
 * time, title, location) is not needed here. `messages` is chronological; each entry has `id`, `time.created`,
 * `type` and a type-specific body:
 *   - `user`: `text` is the typed prompt (plain string; also `files`, sometimes `agents`). No content array.
 *   - `assistant`: `content` is an array of parts; only `{ type: 'text', text }` is conversation text. Tool parts
 *     (`{ type: 'tool', name, state }`) and reasoning parts (`{ type: 'reasoning', text }`) are skipped. There is no
 *     top-level `text`. `time.completed` is the end of the reply; `time.created` is used when it is missing.
 *   - `idle`: `{ outcome }` marks the end of a turn. `synthetic` and `system` carry injected text (a restart notice,
 *     a plan-mode reminder, skill notices), `agent-switched` is bookkeeping. None of these is typed by the user, so
 *     they are dropped (as `parseTranscript` drops Claude's injected user lines).
 * A session id that does not exist exits 1 with `Session not found: <id>` on stderr and no JSON on stdout, so a
 * failed command and unreadable output are both "no transcript" (null), never an empty conversation.
 *
 * The returned turns have the same shape as `TranscriptMessage` in conversationSearch.ts, so that module can reuse
 * them directly.
 */
import { isRecord } from '../../shared/guards'
import type { TranscriptMessage } from './conversationSearch'

/** OpenCode conversation id shape (`ses_` + alphanumerics); the same rule src/main/opencode/sessions.ts uses. */
const OPENCODE_SESSION_ID_RE = /^ses_[A-Za-z0-9]+$/

/** Arguments of the read-only export command (an array, never a shell string). */
const SESSION_EXPORT_ARGS: readonly string[] = ['session', 'export']

/**
 * One turn of an OpenCode transcript. Identical to a Claude transcript message, so conversationSearch's
 * `lastAnswer`/`findInMessages` accept it unchanged.
 */
export type OpencodeTurn = TranscriptMessage

/** First finite numeric field of `time` among `keys`, or null. */
function timestampOf(time: unknown, keys: readonly string[]): number | null {
  if (!isRecord(time)) return null
  for (const key of keys) {
    const value = time[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

/** Conversation text of an assistant `content` list: its text parts, newline-joined; other parts are skipped. */
function textParts(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter(
      (part): part is { type: 'text'; text: string } =>
        isRecord(part) && part.type === 'text' && typeof part.text === 'string'
    )
    .map((part) => part.text)
    .join('\n')
}

/**
 * Parses the JSON of `opencode session export`. Pure and tolerant: only user prompts and assistant text parts become
 * turns (`role`/`text`/`at`, same as a Claude transcript); injected, empty and unknown messages are skipped. Any
 * shape that is not `{ messages: [...] }`, or a malformed entry, yields `[]` (never throws).
 */
export function parseOpencodeExport(json: unknown): OpencodeTurn[] {
  if (!isRecord(json) || !Array.isArray(json.messages)) return []
  const turns: OpencodeTurn[] = []
  for (const message of json.messages) {
    if (!isRecord(message)) continue
    if (message.type === 'user') {
      const text = typeof message.text === 'string' ? message.text.trim() : ''
      if (text.length === 0) continue
      turns.push({ role: 'user', text, at: timestampOf(message.time, ['created']) })
      continue
    }
    if (message.type !== 'assistant') continue
    const text = textParts(message.content).trim()
    if (text.length === 0) continue
    turns.push({ role: 'assistant', text, at: timestampOf(message.time, ['completed', 'created']) })
  }
  return turns
}

/**
 * The assistant's reply to the LAST user message: every assistant text after it, joined. Null when there is no user
 * message at all, or when the last message is the user's (the answer is still being written) — same rule as
 * conversationSearch's `lastAnswer`, but null instead of '' so callers can tell "no answer" from "empty answer".
 */
export function lastAssistantAnswer(turns: readonly TranscriptMessage[]): string | null {
  let lastUser = -1
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i].role === 'user') {
      lastUser = i
      break
    }
  }
  if (lastUser < 0) return null
  const answer = turns
    .slice(lastUser + 1)
    .filter((turn) => turn.role === 'assistant')
    .map((turn) => turn.text)
    .join('\n\n')
  return answer.length === 0 ? null : answer
}

/** Parses JSON output, tolerating log lines before the object (best effort, never throws). */
function parseJsonOutput(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    // Some OpenCode builds prefix log lines: keep the outermost object and retry once.
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    return JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return undefined
  }
}

/**
 * Runs `opencode session export <id>` through the injected runner (so unit tests never spawn the real CLI) and
 * returns the parsed turns. Null on any failure: an id that is not `ses_...` (refused before the runner is called),
 * a rejected runner (non-zero exit, timeout), unreadable output, or JSON without a `messages` array. A genuine empty
 * conversation (`{ messages: [] }`) is `[]`.
 */
export async function exportOpencodeSession(
  sessionId: string,
  run: (args: string[]) => Promise<string>
): Promise<OpencodeTurn[] | null> {
  if (!OPENCODE_SESSION_ID_RE.test(sessionId)) return null
  let output: string
  try {
    output = await run([...SESSION_EXPORT_ARGS, sessionId])
  } catch {
    return null
  }
  const json = parseJsonOutput(output)
  if (!isRecord(json) || !Array.isArray(json.messages)) return null
  return parseOpencodeExport(json)
}
