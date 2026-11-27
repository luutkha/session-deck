// Reading a slice of a saved conversation for Jarvis's read_conversation tool (D52/D79): the newest messages of a
// session, oldest first, with paging back in time and a character budget. Pure: the caller supplies the messages, so
// nothing here reads a file, runs a process or looks at the clock.
import type { TranscriptMessage } from './conversationSearch'

export const READ_DEFAULT_MESSAGES = 10
export const READ_MAX_MESSAGES = 50
export const READ_DEFAULT_CHARS = 8000
export const READ_MAX_CHARS = 30000
/** Budget floor: below this a rendered message would be little more than its header. */
const READ_MIN_CHARS = 200
/** Marks a message whose start was cut to fit the budget. */
const CUT_MARK = '…(start cut)\n'

export interface ReadConversationOptions {
  /** How many messages to show (1 to READ_MAX_MESSAGES, default READ_DEFAULT_MESSAGES). */
  readonly last?: number
  /** How many of the newest messages to skip first, so the caller can page back in time (default 0). */
  readonly skip?: number
  /** Bound for the whole text (200 to READ_MAX_CHARS, default READ_DEFAULT_CHARS). */
  readonly maxChars?: number
}

export interface ReadConversationResult {
  /** The rendered slice: `[n/total] ROLE (time):` plus the message text, messages separated by a blank line. */
  readonly text: string
  /** Messages actually rendered (at most `last`). */
  readonly shown: number
  /** Messages in the whole conversation. */
  readonly total: number
  /** Messages older than the first shown one. */
  readonly olderLeft: number
}

/** A whole number inside [min, max]; a missing or non-finite value falls back to the default. */
function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.floor(value), min), max)
}

/** The message's ISO time, or `time unknown` when the transcript had none (or an unusable one). */
function timeText(at: number | null): string {
  if (at === null || !Number.isFinite(at)) return 'time unknown'
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? 'time unknown' : date.toISOString()
}

/** One message as `[n/total] USER|ASSISTANT (<ISO time>):` and its text on the next line. */
function renderMessage(message: TranscriptMessage, index: number, total: number): string {
  const role = message.role === 'user' ? 'USER' : 'ASSISTANT'
  return `[${index}/${total}] ${role} (${timeText(message.at)}):\n${message.text}`
}

/**
 * The newest `last` messages of a conversation, after skipping `skip` of the newest, in chronological order, bounded
 * by `maxChars`. Over budget, the OLDEST messages of the window are dropped first (the newest matter most); a single
 * message longer than the budget keeps its end, marked with `…(start cut)`.
 */
export function readConversation(messages: readonly TranscriptMessage[], options: ReadConversationOptions = {}): ReadConversationResult {
  const total = messages.length
  if (total === 0) return { text: '', shown: 0, total: 0, olderLeft: 0 }
  const last = clampInt(options.last, READ_DEFAULT_MESSAGES, 1, READ_MAX_MESSAGES)
  const skip = clampInt(options.skip, 0, 0, Number.MAX_SAFE_INTEGER)
  const maxChars = clampInt(options.maxChars, READ_DEFAULT_CHARS, READ_MIN_CHARS, READ_MAX_CHARS)
  // `skip` pages back from the newest end; both bounds are clamped so a skip past the start just yields no window.
  const end = Math.max(0, total - skip)
  const start = Math.max(0, end - last)
  const rendered = messages.slice(start, end).map((message, offset) => renderMessage(message, start + offset + 1, total))

  let from = 0
  let text = rendered.join('\n\n')
  while (text.length > maxChars && from < rendered.length - 1) {
    from += 1
    text = rendered.slice(from).join('\n\n')
  }
  if (text.length > maxChars) {
    const keep = Math.max(0, maxChars - CUT_MARK.length)
    text = CUT_MARK + rendered[from].slice(rendered[from].length - keep)
  }
  return { text, shown: rendered.length - from, total, olderLeft: start + from }
}
