// Jarvis tool for the whole fleet at a glance (D79): fleet_digest. One call answers "what is everyone doing, who is
// blocked or stuck?" without naming a session: per session its agent, state and how long it has been in it, the last
// prompt, the end of the last reply, the pending question, cost today and uncommitted files (read-only, git helper).
// Formatting is the pure formatFleetDigest (own tests: ordering, clipping, cap, empty list); collecting is
// collectFleetDigest; createDigestTools only parses the arguments. Jarvis itself is filtered out by targetSessions and
// worker tabs are not sessions at all, so neither is ever listed. Registered in index.ts like the other tool files.
import type { AgentKind, RuntimeState, Session } from '../../shared/types'
import { isIdleReminder } from '../app/activity'
import { readUncommittedPaths } from '../git'
import type { McpTool } from './mcpProtocol'
import { clip, optionalBool, optionalInt, schema } from './toolArgs'
import { targetSessions } from './targets'
import { stateText, type JarvisToolDeps } from './jarvisTools'
import type { ToolContext } from './appTools'

/** The whole answer stops here, so one call never floods Jarvis's context. */
export const DIGEST_MAX_CHARS = 6000
/** Room kept for the "N more sessions" line so the cap is never exceeded. */
const CUT_NOTE_RESERVE = 220
/** No limit by default; the character cap (or the user's limit) does the cutting. */
export const DIGEST_LIMIT_MAX = 200
const PROMPT_CHARS = 120
const REPLY_CHARS = 240
const QUESTION_CHARS = 160
const SCREEN_LINES = 15

export interface FleetDigestRow {
  readonly name: string
  readonly agent: AgentKind
  /** stateText without the question (that is `question`), e.g. "running, working on a turn". */
  readonly state: string
  /** Epoch ms when it entered that state; null = unknown. */
  readonly since: number | null
  /** Waiting for the user: permission, question, finished turn, bell or marked unread. */
  readonly waiting: boolean
  /** The pending question/permission text, when it needs the user. */
  readonly question: string | null
  readonly lastPrompt: string | null
  /** The last reply as text (already gathered; the formatter keeps its end). '' = none yet. */
  readonly reply: string
  /** Known turn costs since local midnight; null = no known cost. */
  readonly costTodayUsd: number | null
  /** Files that differ from HEAD; null = not a git repository (or unreadable), so nothing is said. */
  readonly uncommitted: number | null
  readonly working: boolean
  readonly queued: number
}

export interface FleetDigestInput {
  readonly now: number
  readonly rows: readonly FleetDigestRow[]
  readonly onlyNeedingAttention?: boolean
  readonly limit?: number
}

export interface FleetDigestOptions {
  readonly onlyNeedingAttention?: boolean
  readonly limit?: number
}

/** A pure counter: uncommitted files of a folder, null when it is not a git repository. */
export type UncommittedCounter = (folder: string) => Promise<number | null>

/** "under a minute", "12 min", "3 h 20 min", "2 days" (never negative). */
export function timeInState(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`
  return `${Math.round(hours / 24)} days`
}

/** The end of a long text (a reply is read from its end), flattened to one line and at most `max` characters. */
export function clipToEnd(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return `…${flat.slice(flat.length - (max - 1))}`
}

/** 0 = needs the user, 1 = working, 2 = idle (the digest's order). */
function rank(row: FleetDigestRow): 0 | 1 | 2 {
  if (row.waiting) return 0
  return row.working ? 1 : 2
}

/**
 * Needs and working sessions first (longest in that state first: the most stuck is the most urgent); idle ones last,
 * most recently active first (closed sessions have an old `since`, so they trail). Same name breaks ties, so the
 * answer is stable between calls.
 */
function compareRows(a: FleetDigestRow, b: FleetDigestRow): number {
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra - rb
  const sa = a.since ?? (ra === 2 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY)
  const sb = b.since ?? (ra === 2 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY)
  if (sa !== sb) return ra === 2 ? sb - sa : sa - sb
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

function blockOf(row: FleetDigestRow, now: number): string {
  const parts = [`"${row.name}" (${row.agent})`, row.since === null ? row.state : `${row.state} for ${timeInState(now - row.since)}`]
  if (row.queued > 0) parts.push(`${row.queued} queued`)
  if (row.costTodayUsd !== null) parts.push(`$${row.costTodayUsd.toFixed(2)} today`)
  if (row.uncommitted !== null) parts.push(`${row.uncommitted} uncommitted`)
  const lines = [parts.join(' · ')]
  if (row.waiting && row.question !== null && row.question.trim().length > 0) {
    lines.push(`  needs you: "${clip(row.question, QUESTION_CHARS)}"`)
  }
  if (row.lastPrompt !== null && row.lastPrompt.trim().length > 0) {
    lines.push(`  last prompt: "${clip(row.lastPrompt, PROMPT_CHARS)}"`)
  }
  if (row.reply.trim().length > 0) lines.push(`  reply: ${clipToEnd(row.reply, REPLY_CHARS)}`)
  return lines.join('\n')
}

/**
 * The whole digest as text. Pure: it orders, clips and caps the rows it is given (the tool gathers them).
 * Empty list and "nothing needs you" have their own messages; a cut says how many sessions are left out.
 */
export function formatFleetDigest(input: FleetDigestInput): string {
  const onlyAttention = input.onlyNeedingAttention === true
  const pool = onlyAttention ? input.rows.filter((row) => row.waiting) : [...input.rows]
  if (pool.length === 0) {
    return onlyAttention ? 'Nothing needs the user right now: every session is running or idle.' : 'No sessions to report.'
  }
  const ordered = [...pool].sort(compareRows)
  const needs = ordered.filter((row) => row.waiting).length
  const working = ordered.filter((row) => !row.waiting && row.working).length
  const idle = ordered.length - needs - working
  const header = onlyAttention
    ? `Fleet digest: ${ordered.length} session(s) need you.`
    : `Fleet digest: ${ordered.length} session(s) · ${needs} need you · ${working} working · ${idle} idle`
  const max = input.limit === undefined ? ordered.length : Math.max(0, Math.trunc(input.limit))
  const budget = DIGEST_MAX_CHARS - CUT_NOTE_RESERVE
  const blocks: string[] = []
  let used = header.length
  let cappedByBudget = false
  for (const row of ordered) {
    if (blocks.length >= max) break
    const block = blockOf(row, input.now)
    if (used + 1 + block.length > budget) {
      cappedByBudget = true
      break
    }
    blocks.push(block)
    used += 1 + block.length
  }
  const cut = ordered.length - blocks.length
  if (cut === 0) return [header, ...blocks].join('\n')
  const note = cappedByBudget
    ? `(${cut} more session(s) not shown; the digest stops at ${DIGEST_MAX_CHARS} characters. Use limit or only_needing_attention.)`
    : `(${cut} more session(s) not shown; the limit is ${max}. Raise it or use only_needing_attention.)`
  return [header, ...blocks, note].join('\n')
}

/** Really waiting for an answer (a permission or a question), not just Claude's idle reminder. */
function isAsking(state: RuntimeState | undefined): boolean {
  return state?.activity === 'needs-input' && !isIdleReminder(state.activityMessage)
}

/** The bell / "Needs you" list, which is what "blocked" means in the app. Closed sessions are never it. */
function needsUser(session: Session, state: RuntimeState | undefined): boolean {
  if (session.closedAt !== undefined || state === undefined) return false
  return (state.attention !== null && state.attention !== undefined) || isAsking(state)
}

/** Working on a turn, or still has queued prompts it will get (mirrors jarvisTools.isBusy without importing private code). */
function isWorking(session: Session, state: RuntimeState | undefined): boolean {
  if (session.closedAt !== undefined) return false
  if (state?.activity === 'working') return true
  const typeable = state?.run === 'running' && state.sleeping !== true
  return typeable && (session.queue ?? []).length > 0 && !isAsking(state)
}

function positive(value: number | undefined): number | null {
  return value !== undefined && value > 0 ? value : null
}

/** When the session entered its current state, as far as main knows it. */
function stateSince(session: Session, state: RuntimeState | undefined, deps: JarvisToolDeps): number | null {
  if (session.closedAt !== undefined) return session.closedAt
  if (state?.sleeping === true) return positive(deps.lastOutputAt(session.id))
  if (state?.run === 'running') {
    if (state.attention !== null && state.attention !== undefined && state.attentionAt !== undefined) return positive(state.attentionAt)
    if (state.activityAt !== undefined) return positive(state.activityAt)
    return positive(deps.startedAt(session.id))
  }
  return positive(deps.lastOutputAt(session.id)) ?? positive(deps.startedAt(session.id))
}

/** Drops the question stateText appends (`: "..."`): the digest shows it on its own line instead. */
function stateWithoutQuestion(state: string, waiting: boolean): string {
  if (!waiting) return state
  const at = state.indexOf(': "')
  return at === -1 ? state : state.slice(0, at)
}

/** Claude's saved reply, or the visible screen for OpenCode/shell (and as a fallback when Claude has no saved one). */
async function replyOf(session: Session, deps: JarvisToolDeps): Promise<string> {
  if ((session.agent ?? 'claude') !== 'shell') {
    try {
      const answer = await deps.lastAnswer(session)
      if (answer !== null && answer.trim().length > 0) return answer
    } catch {
      // No readable conversation: the screen below is still useful.
    }
  }
  try {
    return await deps.screenText(session.id, SCREEN_LINES)
  } catch {
    return ''
  }
}

/** Uncommitted files of a session's folder through the git service (read-only). */
async function countUncommittedFiles(folder: string): Promise<number | null> {
  return (await readUncommittedPaths(folder)).size
}

/** A folder outside a repository (or gone) says nothing at all; the digest is not the place for that error. */
async function quietUncommitted(read: UncommittedCounter, folder: string): Promise<number | null> {
  try {
    return await read(folder)
  } catch {
    return null
  }
}

/**
 * Gathers every session (Jarvis excluded) and formats the digest. `uncommittedOf` is the one filesystem seam, so unit
 * tests never start git. With only_needing_attention the other sessions are not printed, so their reply and git reads
 * are skipped.
 */
export async function collectFleetDigest(
  deps: JarvisToolDeps,
  options: FleetDigestOptions = {},
  uncommittedOf: UncommittedCounter = countUncommittedFiles
): Promise<string> {
  const now = deps.now()
  const midnight = new Date(now).setHours(0, 0, 0, 0)
  const costToday = new Map<string, number>()
  for (const turn of deps.allTurns()) {
    if (turn.costUsd === null || turn.startedAt < midnight) continue
    costToday.set(turn.sessionId, (costToday.get(turn.sessionId) ?? 0) + turn.costUsd)
  }
  const rows = await Promise.all(targetSessions(deps.getData()).map(async (session): Promise<FleetDigestRow> => {
    const state = deps.getRuntime(session.id)
    const waiting = needsUser(session, state)
    const row: FleetDigestRow = {
      name: session.name,
      agent: session.agent ?? 'claude',
      state: stateWithoutQuestion(stateText(session, state), waiting),
      since: stateSince(session, state, deps),
      waiting,
      question: waiting ? state?.activityMessage ?? null : null,
      lastPrompt: null,
      reply: '',
      costTodayUsd: costToday.get(session.id) ?? null,
      uncommitted: null,
      working: !waiting && isWorking(session, state),
      queued: (session.queue ?? []).length
    }
    if (options.onlyNeedingAttention === true && !waiting) return row
    const last = deps.timeline(session.id).at(-1)
    return {
      ...row,
      lastPrompt: last !== undefined && last.prompt.length > 0 ? last.prompt : null,
      reply: await replyOf(session, deps),
      uncommitted: await quietUncommitted(uncommittedOf, session.cwd)
    }
  }))
  return formatFleetDigest({ now, rows, onlyNeedingAttention: options.onlyNeedingAttention === true, limit: options.limit ?? DIGEST_LIMIT_MAX })
}

export function createDigestTools(deps: JarvisToolDeps, _ctx: ToolContext): McpTool[] {
  // _ctx: no tool here changes the app; the digest only reads what main already knows.
  return [
    {
      name: 'fleet_digest',
      description: `What every session is doing, in one call: per session its agent, state and how long it has been in it, the last prompt, the end of the last reply, the pending question when it needs the user, its cost today and its uncommitted files (when the folder is a git repository). Sessions that need the user come first, then working, then idle; the most stuck in each group is first. Jarvis itself and worker tabs are never listed. The answer stops at about ${DIGEST_MAX_CHARS} characters and says how many sessions were left out. Use it for "what is everyone doing, who is blocked or stuck?".`,
      inputSchema: schema({
        only_needing_attention: { type: 'boolean', description: 'Only sessions waiting for the user (permission, question, finished turn, bell or unread).' },
        limit: { type: 'integer', minimum: 1, description: `Show at most this many sessions (max ${DIGEST_LIMIT_MAX}; default all).` }
      }),
      run: async (args) => collectFleetDigest(deps, {
        onlyNeedingAttention: optionalBool(args, 'only_needing_attention') === true,
        limit: optionalInt(args, 'limit', DIGEST_LIMIT_MAX, DIGEST_LIMIT_MAX)
      })
    }
  ]
}
