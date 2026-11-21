/**
 * Recovering an OpenCode conversation id that was never captured (the plugin's AgentSession event was missed, e.g.
 * the app was not running when the session started). `opencode session list --format json` is the only read-only
 * source. Probed against opencode v2.1.4 (`session list --help`):
 *
 *   USAGE: opencode session list [flags]   "List top-level sessions in the current project, newest first"
 *   FLAGS: --standalone, --server string, --max-count/-n integer (default 100), --format table|json
 *
 * `--format json` prints an array of objects with: id (`ses_...`), title, updated (epoch ms), created (epoch ms),
 * projectId, directory (an absolute path, backslash-separated on Windows). Fields are read tolerantly: an entry
 * without a valid `ses_` id is dropped, a missing title/directory/timestamp only makes that entry unusable for
 * adoption. The CLI lists the project of the directory it runs in, so the runner MUST run in the session's own
 * folder (D79: from another folder the list is empty); the directory field is still filtered on, because a project
 * can span several folders. `--max-count 300` keeps a busy project from hiding the row this launch continued.
 */

/** OpenCode conversation id shape used by this module (`ses_` + alphanumerics). */
const OPENCODE_SESSION_ID_RE = /^ses_[A-Za-z0-9]+$/

/** D79: how many of a project's newest sessions the listing asks for (the CLI default is 100). */
export const SESSION_LIST_MAX_COUNT = 300

/** Arguments of the read-only list command (an array, never a shell string). */
const SESSION_LIST_ARGS: readonly string[] = [
  'session', 'list', '--format', 'json', '--max-count', String(SESSION_LIST_MAX_COUNT)
]

/**
 * How far before the launch a listed session may have been created or updated and still be the one this launch
 * continued. Small on purpose: a session adopted by mistake would resume someone else's conversation.
 */
export const SESSION_ADOPT_SLACK_MS = 120_000

/** One row of `opencode session list --format json`, trimmed to the fields this module uses. */
export interface OpencodeSessionInfo {
  readonly id: string
  readonly title?: string
  readonly directory?: string
  /** Epoch ms, as printed by the CLI. */
  readonly created?: number
  /** Epoch ms, as printed by the CLI. */
  readonly updated?: number
}

/** Outcome of `pickSessionToAdopt`: one candidate, several (never guess), or none. */
export type SessionAdoptPick =
  | { readonly kind: 'adopt'; readonly id: string }
  | { readonly kind: 'ambiguous'; readonly ids: string[] }
  | { readonly kind: 'none' }

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Parses the output of `opencode session list --format json`. Pure and tolerant: anything that is not an array of
 * session-like objects yields `[]` (or skips the bad rows); it never throws.
 */
export function parseOpencodeSessionList(json: unknown): OpencodeSessionInfo[] {
  if (!Array.isArray(json)) return []
  const sessions: OpencodeSessionInfo[] = []
  for (const entry of json) {
    if (typeof entry !== 'object' || entry === null) continue
    const raw = entry as Record<string, unknown>
    if (typeof raw.id !== 'string' || !OPENCODE_SESSION_ID_RE.test(raw.id)) continue
    const info: OpencodeSessionInfo = {
      id: raw.id,
      ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
      ...(typeof raw.directory === 'string' ? { directory: raw.directory } : {}),
      ...(isTimestamp(raw.created) ? { created: raw.created } : {}),
      ...(isTimestamp(raw.updated) ? { updated: raw.updated } : {})
    }
    sessions.push(info)
  }
  return sessions
}

/** Case- and slash-insensitive form of a folder path, for Windows (`C:\Work\X` == `c:/work/x/`). */
function normalizeDirectory(path: string): string {
  const slashed = path.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  const lowered = slashed.toLowerCase()
  let end = lowered.length
  while (end > 1 && lowered.charAt(end - 1) === '/') end -= 1
  return lowered.slice(0, end)
}

/** True when two folder paths name the same folder (`C:\Work\X` == `c:/work/x/`). */
export function sameDirectory(a: string, b: string): boolean {
  return normalizeDirectory(a) === normalizeDirectory(b)
}

/** The later of the two timestamps the CLI printed, or undefined when it printed neither. */
function latestTimestamp(session: OpencodeSessionInfo): number | undefined {
  const times = [session.created, session.updated].filter((t): t is number => t !== undefined)
  if (times.length === 0) return undefined
  return Math.max(...times)
}

/**
 * Picks the OpenCode session this SessionDeck session most likely continued, without guessing: a candidate is in
 * the same folder (case and slash insensitive), was created or updated no earlier than the launch minus
 * `SESSION_ADOPT_SLACK_MS`, and is not a conversation another SessionDeck session already owns (`knownIds`, so
 * two sessions in one folder never adopt the same row). Exactly one candidate is adopted; several are reported as
 * ambiguous and nothing is stored.
 */
export function pickSessionToAdopt(input: {
  cwd: string
  startedAtMs: number
  knownIds: ReadonlySet<string>
  sessions: readonly OpencodeSessionInfo[]
}): SessionAdoptPick {
  const { cwd, startedAtMs, knownIds, sessions } = input
  if (cwd.trim().length === 0 || !Number.isFinite(startedAtMs)) return { kind: 'none' }

  const wanted = normalizeDirectory(cwd)
  const earliest = startedAtMs - SESSION_ADOPT_SLACK_MS
  const candidates = new Set<string>()
  for (const session of sessions) {
    if (knownIds.has(session.id)) continue
    if (session.directory === undefined) continue
    if (normalizeDirectory(session.directory) !== wanted) continue
    const latest = latestTimestamp(session)
    if (latest === undefined || latest < earliest) continue
    candidates.add(session.id)
  }

  if (candidates.size === 0) return { kind: 'none' }
  const ids = [...candidates]
  if (ids.length === 1) return { kind: 'adopt', id: ids[0] }
  return { kind: 'ambiguous', ids }
}

/** Parses JSON output, tolerating log lines the CLI may print before the array (best effort, never throws). */
function parseJsonOutput(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    // Some OpenCode builds prefix log lines: keep the outermost array and retry once.
  }
  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start < 0 || end <= start) return undefined
  try {
    return JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return undefined
  }
}

/**
 * Runs `opencode session list --format json` through the injected runner (so unit tests never spawn the real CLI)
 * and returns the parsed list. `cwd` is the folder the CLI must run in: it lists the project of its working
 * directory, so a session in another project is found only when its own folder is passed (D79). Any failure (could
 * not run, non-zero exit via a rejected promise, unreadable output) yields `[]`: recovering an id is an
 * enhancement, never a reason to block a launch.
 */
export async function listOpencodeSessions(
  run: (args: string[], cwd?: string) => Promise<string>,
  cwd?: string
): Promise<OpencodeSessionInfo[]> {
  let output: string
  try {
    output = cwd === undefined ? await run([...SESSION_LIST_ARGS]) : await run([...SESSION_LIST_ARGS], cwd)
  } catch {
    return []
  }
  return parseOpencodeSessionList(parseJsonOutput(output))
}
