/**
 * Copy-style fork of an OpenCode conversation (D79). OpenCode has no "fork this conversation" command, so a fork is a
 * COPY: `opencode session export <id>` prints the conversation as JSON, `opencode session import <file>` creates a
 * new conversation from it. This module holds the parts that can be tested without the CLI: what the export looks
 * like, where the temp file goes, which new id the import printed (or which row appeared in the session list).
 * The controller (sessionController.ts) does the process calls with the injected runner.
 *
 * Probed read-only against opencode v2.1.4 (`session export --help`, `session import --help`):
 *
 *   USAGE: opencode session export [flags] [<session>]   "Export session data as JSON"  (works from any folder)
 *   USAGE: opencode session import [flags] <file>        "Import session data from a JSON file or URL"
 *   FLAGS (import): --standalone, --server string, --directory string
 *
 * Import's output is not documented: one build may print the new id, another the imported session as JSON, another
 * nothing at all. `parseImportedSessionId` reads it when it is unambiguous; otherwise the controller diffs a
 * before/after `session list` (`pickNewSessionId`). When neither is sure the fork is refused: a conversation id is
 * never guessed, because the wrong one would resume someone else's session.
 */
import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isRecord } from '../../shared/guards'
import type { OpencodeSessionInfo } from './sessions'
import { sameDirectory } from './sessions'
import { isOpencodeSessionId } from './values'

/** Every distinct `ses_` id in a text, in the order it appears. */
function idsIn(text: string): string[] {
  const found = text.match(/ses_[A-Za-z0-9]+/g) ?? []
  return [...new Set(found.filter((id) => isOpencodeSessionId(id)))]
}

/** The text as JSON, or its outermost `{...}` when the CLI printed log lines around it. Null when it is not JSON. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  const candidates = [trimmed]
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1))
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate)
      if (isRecord(parsed)) return parsed
    } catch {
      // try the next shape
    }
  }
  return null
}

/** True when the id sits on the object itself or under `info` (export prints `{ info: { id }, messages: [...] }`). */
function idOfObject(value: Record<string, unknown>): string | null {
  if (isOpencodeSessionId(value.id)) return value.id
  const info = value.info
  if (isRecord(info) && isOpencodeSessionId(info.id)) return info.id
  return null
}

/**
 * True when `output` is a session export (`{ info: {...}, messages: [...] }`) or at least a JSON object carrying a
 * session id. Anything else is a CLI error page or garbage and must not be imported.
 */
export function isSessionExport(output: string): boolean {
  const parsed = parseJsonObject(output)
  if (parsed === null) return false
  return Array.isArray(parsed.messages) || idOfObject(parsed) !== null
}

/**
 * The id `opencode session import` printed, or null when the output does not make it sure. A JSON object with an id
 * wins (the imported session); otherwise the output must hold exactly one distinct `ses_` id. Several ids (a whole
 * export echo, including child sessions) are NOT guessed: the caller falls back to the session-list diff.
 */
export function parseImportedSessionId(output: string): string | null {
  if (output.trim().length === 0) return null
  const parsed = parseJsonObject(output)
  if (parsed !== null) {
    const id = idOfObject(parsed)
    if (id !== null) return id
  }
  const ids = idsIn(output)
  return ids.length === 1 ? ids[0] : null
}

/**
 * The conversation the import created: the single row `after` has that `before` did not. Nothing new, or several new
 * rows (someone else's session appeared at the same moment) = null, never a guess. `cwd` (the session's folder, the
 * folder the listing ran in) drops rows that clearly belong to another folder; a row without a directory counts,
 * since the CLI was already scoped to that project.
 */
export function pickNewSessionId(
  before: readonly OpencodeSessionInfo[],
  after: readonly OpencodeSessionInfo[],
  cwd?: string
): string | null {
  const known = new Set(before.map((session) => session.id))
  const added = after.filter((session) => {
    if (known.has(session.id)) return false
    if (cwd === undefined || session.directory === undefined) return true
    return sameDirectory(session.directory, cwd)
  })
  const ids = [...new Set(added.map((session) => session.id))]
  return ids.length === 1 ? ids[0] : null
}

/**
 * `opencode session import` refuses an export whose session id already exists ("Session already exists", exit 0) and fails with
 * an internal error when only the session id is new, because the message ids are keys too. Every OpenCode id in the export
 * (`ses_`, `msg_`, `prt_` ... + 12 hex time characters + 14 base62) gets a fresh random tail and keeps its time prefix, so the
 * ordering survives. Returns the new text and the new id of the SESSION (the first `ses_` id), null when there was none.
 */
export function remapExportIds(json: string, random: () => number = Math.random): { readonly json: string; readonly sessionId: string | null } {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const tail = (): string => Array.from({ length: 14 }, () => alphabet[Math.floor(random() * alphabet.length)]).join('')
  const map = new Map<string, string>()
  let sessionId: string | null = null
  const out = json.replace(/\b([a-z]{2,5}_[0-9a-f]{12})([A-Za-z0-9]{14})\b/g, (whole: string, head: string) => {
    let next = map.get(whole)
    if (next === undefined) {
      next = head + tail()
      map.set(whole, next)
      if (sessionId === null && head.startsWith('ses_')) sessionId = next
    }
    return next
  })
  return { json: out, sessionId }
}

/** A written export: its path, and a cleanup that deletes it and never throws (safe to call once, in a finally). */
export interface ForkFile {
  readonly path: string
  readonly cleanup: () => Promise<void>
}

/**
 * Writes the exported conversation to a unique file in the OS temp folder (never the user's project), for
 * `opencode session import`. The name is random so two forks cannot collide; `cleanup` removes it afterwards.
 */
export async function writeForkFile(json: string): Promise<ForkFile> {
  const path = join(tmpdir(), `sessiondeck-opencode-fork-${randomUUID()}.json`)
  await writeFile(path, json, 'utf-8')
  let done = false
  const cleanup = async (): Promise<void> => {
    if (done) return
    done = true
    try {
      await rm(path, { force: true })
    } catch {
      // A file the CLI still holds open on Windows: it lives in the temp folder, so leaving it is harmless.
    }
  }
  return { path, cleanup }
}
