// D80 Jarvis watch mode: while the Settings toggle is on, a timer looks at the fleet every N minutes and gives Jarvis
// ONE message when a session has been waiting for the user (permission or question) or looks stuck (working with no
// state change). Each episode is reported once (`id:kind:since`), a failed delivery is retried on the next tick, and a
// tick with nothing to say reads no digest, so it costs nothing. The timer, the clock and every IO call are injected
// (same style as scheduleService), so unit tests never need a real timer or Jarvis.
import { MAX_WATCH_MINUTES, MIN_WATCH_MINUTES } from '../../shared/types'
import { clip } from './toolArgs'

/** A permission or question left unanswered this long is worth telling Jarvis about. */
export const WATCH_WAITING_MIN_MS = 3 * 60_000
/** Working with no state change this long looks stuck. */
export const WATCH_STUCK_MIN_MS = 20 * 60_000
/** The whole message stops here. */
export const WATCH_MAX_CHARS = 7000
/** A detail (the pending question) keeps at most this many characters in the list. */
const DETAIL_CHARS = 160
/** The `reported` set never grows past this. */
const REPORTED_MAX = 500
const DEFAULT_EVERY_MINUTES = 10

export interface WatchItem {
  /** `${id}:${kind}:${since}`: one entry per episode, so the same episode is reported once. */
  readonly key: string
  readonly sessionName: string
  readonly kind: 'waiting' | 'stuck'
  readonly since: number
  readonly detail: string
}

export interface WatchRow {
  readonly id: string
  readonly name: string
  readonly waiting: boolean
  readonly working: boolean
  readonly since: number | null
  readonly question: string | null
}

/** "under a minute", "4 min", "1 h 20 min", "2 days" (never negative). */
function durationText(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`
  return `${Math.round(hours / 24)} days`
}

/** Waiting first, then the longest in that state first; the name and key break ties, so the list is stable. */
function compareItems(a: WatchItem, b: WatchItem): number {
  if (a.kind !== b.kind) return a.kind === 'waiting' ? -1 : 1
  if (a.since !== b.since) return a.since - b.since
  if (a.sessionName !== b.sessionName) return a.sessionName < b.sessionName ? -1 : 1
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

/**
 * Pure: the rows that deserve Jarvis's attention at `now`, minus the episodes already in `reported`.
 * `since === null` (unknown) is ignored: there is no way to tell how long it has been like that.
 */
export function findWatchItems(rows: readonly WatchRow[], now: number, reported: ReadonlySet<string>): WatchItem[] {
  const items: WatchItem[] = []
  for (const row of rows) {
    if (row.since === null) continue
    const since = row.since
    if (row.waiting && now - since >= WATCH_WAITING_MIN_MS) pushItem(items, row, 'waiting', since, reported)
    if (row.working && now - since >= WATCH_STUCK_MIN_MS) pushItem(items, row, 'stuck', since, reported)
  }
  return items.sort(compareItems)
}

function pushItem(
  items: WatchItem[],
  row: WatchRow,
  kind: WatchItem['kind'],
  since: number,
  reported: ReadonlySet<string>
): void {
  const key = `${row.id}:${kind}:${since}`
  if (reported.has(key)) return
  items.push({ key, sessionName: row.name, kind, since, detail: (row.question ?? '').trim() })
}

function itemLine(item: WatchItem, now: number): string {
  const what = item.kind === 'waiting' ? 'waiting for you' : 'looks stuck'
  const detail = item.detail.length > 0 ? `: ${clip(item.detail, DETAIL_CHARS)}` : ''
  return `- "${item.sessionName}" — ${what} for ${durationText(now - item.since)}${detail}`
}

const WATCH_INSTRUCTION =
  'Look at each one. Answer a waiting question or approve a permission ONLY when the answer is obvious and cannot ' +
  'destroy anything; otherwise tell the user what is needed. For a stuck session, read its screen first, then nudge it ' +
  'or tell the user. Do not restart or close anything without asking.'

/** The end of `text`, cut to `max` characters with an ellipsis. */
function cutEnd(text: string, max: number): string {
  if (text.length <= max) return text
  return max <= 1 ? '…' : `${text.slice(0, max - 1)}…`
}

/**
 * Pure: ONE message for Jarvis: a one-line summary, the list of episodes (name, kind, how long, the pending question
 * clipped), the fleet digest and what Jarvis may do about it. The digest is the part that gives way to the cap; the
 * instruction stays at the end.
 */
export function formatWatchMessage(items: readonly WatchItem[], digest: string, now: number): string {
  const waiting = items.filter((item) => item.kind === 'waiting').length
  const stuck = items.length - waiting
  const parts: string[] = []
  if (waiting > 0) parts.push(waiting === 1 ? '1 session needs you' : `${waiting} sessions need you`)
  if (stuck > 0) parts.push(stuck === 1 ? '1 looks stuck' : `${stuck} look stuck`)
  const head = [`[Watch] ${parts.join(', ')}`, ...items.map((item) => itemLine(item, now))].join('\n')
  const digestText = digest.trim()
  const sections = [head]
  if (digestText.length > 0) {
    const room = WATCH_MAX_CHARS - head.length - WATCH_INSTRUCTION.length - 4
    if (room >= 40) sections.push(cutEnd(digestText, room))
  }
  sections.push(WATCH_INSTRUCTION)
  const message = sections.filter((section) => section.length > 0).join('\n\n')
  return message.length <= WATCH_MAX_CHARS ? message : cutEnd(message, WATCH_MAX_CHARS)
}

export interface WatchServiceDeps {
  /** The Settings toggle (jarvis.watchEnabled / jarvis.watchEveryMinutes), read each time. */
  readonly settings: () => { readonly enabled: boolean; readonly everyMinutes: number }
  /** The fleet, with Jarvis and worker tabs already excluded by the caller. */
  readonly rows: () => readonly WatchRow[]
  /** The fleet_digest text; onlyNeedingAttention keeps it cheap when every item is waiting. */
  readonly digest: (onlyNeedingAttention: boolean) => Promise<string>
  /** Hands the message to Jarvis (the same sender the schedules use). */
  readonly deliver: (message: string) => Promise<void>
  readonly now: () => number
  readonly setInterval: (callback: () => void, ms: number) => ReturnType<typeof setInterval>
  readonly clearInterval: (timer: ReturnType<typeof setInterval>) => void
  readonly onError: (where: string, error: unknown) => void
  readonly log: (tool: string, detail: string) => void
}

export interface WatchService {
  start(): void
  stop(): void
  /** Re-reads the settings: (re)creates the timer, or clears it and forgets what was reported when turned off. */
  refresh(): void
  tick(): Promise<void>
  status(): { enabled: boolean; everyMinutes: number; lastCheckAt: number | null; lastMessageAt: number | null; reported: number }
}

/** The settings are validated elsewhere; this only keeps a broken value from spinning the timer. */
function clampMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_EVERY_MINUTES
  return Math.min(MAX_WATCH_MINUTES, Math.max(MIN_WATCH_MINUTES, Math.round(value)))
}

export function createWatchService(deps: WatchServiceDeps): WatchService {
  /** Episodes already given to Jarvis; pruned as soon as a session stops being waiting/stuck. */
  const reported = new Set<string>()
  const nothingReported: ReadonlySet<string> = new Set()
  let timer: ReturnType<typeof setInterval> | null = null
  let timerMinutes: number | null = null
  let lastCheckAt: number | null = null
  let lastMessageAt: number | null = null
  let busy = false

  function clearTimer(): void {
    if (timer !== null) deps.clearInterval(timer)
    timer = null
    timerMinutes = null
  }

  /** Drops every remembered episode that is not live any more (resolved, or replaced by a new `since`). */
  function forgetResolved(live: readonly WatchItem[]): void {
    const liveKeys = new Set(live.map((item) => item.key))
    for (const key of [...reported]) {
      if (!liveKeys.has(key)) reported.delete(key)
    }
  }

  function remember(keys: readonly string[]): void {
    for (const key of keys) reported.add(key)
    while (reported.size > REPORTED_MAX) {
      const first = reported.values().next()
      if (first.done === true) break
      reported.delete(first.value)
    }
  }

  async function tick(): Promise<void> {
    if (!deps.settings().enabled) return
    if (busy) return
    busy = true
    try {
      const now = deps.now()
      lastCheckAt = now
      const live = findWatchItems(deps.rows(), now, nothingReported)
      forgetResolved(live)
      const items = live.filter((item) => !reported.has(item.key))
      if (items.length === 0) return
      const onlyWaiting = items.every((item) => item.kind === 'waiting')
      const digest = await deps.digest(onlyWaiting)
      await deps.deliver(formatWatchMessage(items, digest, now))
      // Only after the delivery resolved: a failed deliver is retried on the next tick.
      remember(items.map((item) => item.key))
      lastMessageAt = deps.now()
      deps.log('jarvis watch', `${items.length} session(s) reported`)
    } catch (error) {
      deps.onError('jarvis watch', error)
    } finally {
      busy = false
    }
  }

  function refresh(): void {
    const settings = deps.settings()
    if (!settings.enabled) {
      clearTimer()
      reported.clear()
      return
    }
    const minutes = clampMinutes(settings.everyMinutes)
    if (timer !== null && timerMinutes === minutes) return
    clearTimer()
    timerMinutes = minutes
    timer = deps.setInterval(() => {
      void tick()
    }, minutes * 60_000)
  }

  function status(): {
    enabled: boolean
    everyMinutes: number
    lastCheckAt: number | null
    lastMessageAt: number | null
    reported: number
  } {
    const settings = deps.settings()
    return {
      enabled: settings.enabled,
      everyMinutes: clampMinutes(settings.everyMinutes),
      lastCheckAt,
      lastMessageAt,
      reported: reported.size
    }
  }

  return {
    start: refresh,
    stop: clearTimer,
    refresh,
    tick,
    status
  }
}
