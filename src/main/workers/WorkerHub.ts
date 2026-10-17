import type { Id, WorkerInfo, WorkerLine, WorkerStatus } from '../../shared/types'
import { parseWorkerEvent, type WorkerEvent } from './workerEvents'

/** Newest lines kept per worker. */
export const MAX_WORKER_LINES = 400
/** Workers kept per Claude session (the oldest finished ones go first). */
export const MAX_WORKERS_PER_SESSION = 50
/** A running worker whose process has been silent (no event, no heartbeat) this long is reported as lost. */
export const LOST_AFTER_MS = 20_000
/** Finished workers are forgotten after this long (the UI hides them much sooner). */
const FORGET_FINISHED_MS = 30 * 60 * 1000
const LIMIT_RE = /usage limit|rate.?limit|too many requests|\b429\b|quota exceeded|insufficient (credit|balance|funds)|out of credit/i
const NAME_MAX = 40

interface Entry {
  readonly key: string
  readonly line: WorkerLine
}

interface Rec {
  readonly id: string
  readonly owner: Id
  readonly proc: string
  readonly dir: string
  readonly title: string
  readonly firstUser: string | null
  readonly model: string
  readonly status: WorkerStatus
  readonly detail: string
  readonly startedAt: number
  readonly finishedAt: number | null
  readonly lastEventAt: number
  readonly entries: readonly Entry[]
  /** Cost and tokens per step part, so a re-sent part overwrites instead of adding twice. */
  readonly steps: ReadonlyMap<string, { readonly cost: number; readonly tokens: number }>
  readonly sawError: string | null
}

export interface WorkerHubDeps {
  readonly now: () => number
  readonly onChange: (workers: readonly WorkerInfo[]) => void
  readonly isKnownSession: (id: Id) => boolean
}

export interface WorkerHub {
  /** One authenticated payload from the plugin of a Claude session. Returns false when it was rejected. */
  ingest(owner: Id, payload: unknown): boolean
  /** Marks workers whose process went silent; call every few seconds. */
  sweep(): void
  forgetSession(owner: Id): void
  getWorkers(): readonly WorkerInfo[]
}

const DEFAULT_TITLE_RE = /^(new session|child session)\b/i

function workerName(rec: Rec, index: number): string {
  if (rec.title.length > 0 && !DEFAULT_TITLE_RE.test(rec.title)) return rec.title.slice(0, NAME_MAX)
  if (rec.firstUser !== null) {
    const line = rec.firstUser.split(/\r?\n/).map((l) => l.replace(/^[#>*\-\s]+/, '').trim()).find((l) => l.length > 0)
    if (line !== undefined) return line.length > NAME_MAX ? `${line.slice(0, NAME_MAX - 1)}…` : line
  }
  return `Worker ${index}`
}

function totals(rec: Rec): { cost: number; tokens: number } {
  let cost = 0
  let tokens = 0
  for (const step of rec.steps.values()) {
    cost += step.cost
    tokens += step.tokens
  }
  return { cost, tokens }
}

function upsertEntry(entries: readonly Entry[], key: string, line: WorkerLine): readonly Entry[] {
  const at = entries.findIndex((e) => e.key === key)
  const next = at >= 0 ? entries.map((e, i) => (i === at ? { key, line } : e)) : [...entries, { key, line }]
  return next.length > MAX_WORKER_LINES ? next.slice(next.length - MAX_WORKER_LINES) : next
}

function fresh(owner: Id, proc: string, oc: string, now: number): Rec {
  return {
    id: oc, owner, proc, dir: '', title: '', firstUser: null, model: 'unknown model', status: 'running', detail: 'running',
    startedAt: now, finishedAt: null, lastEventAt: now, entries: [], steps: new Map(), sawError: null
  }
}

function running(rec: Rec): Rec {
  return rec.status === 'running' ? rec : { ...rec, status: 'running', detail: 'running', finishedAt: null, sawError: null }
}

function applyEvent(rec: Rec, event: WorkerEvent, now: number): Rec {
  const base: Rec = { ...rec, lastEventAt: now, proc: event.proc }
  switch (event.kind) {
    case 'start':
      return { ...running(base), dir: event.dir || base.dir, title: event.title }
    case 'busy':
      return { ...running(base), dir: event.dir || base.dir }
    case 'idle': {
      if (base.sawError !== null) {
        return { ...base, status: 'failed', detail: LIMIT_RE.test(base.sawError) ? 'rate-limited' : 'error', finishedAt: base.finishedAt ?? now }
      }
      return { ...base, status: 'done', detail: 'ok', finishedAt: base.finishedAt ?? now }
    }
    case 'user':
      return base.firstUser === null ? { ...base, firstUser: event.text } : base
    case 'text': {
      const text = event.text.trim()
      return text.length === 0 ? running(base) : { ...running(base), entries: upsertEntry(base.entries, event.partId, { kind: 'text', text }) }
    }
    case 'tool':
      return { ...running(base), entries: upsertEntry(base.entries, event.partId, { kind: 'tool', tool: event.tool, text: event.text, state: event.state }) }
    case 'step': {
      const steps = new Map(base.steps)
      steps.set(event.partId, { cost: event.cost, tokens: event.tokens })
      return { ...running(base), steps }
    }
    case 'model':
      return { ...base, model: event.model }
    case 'error':
      return { ...base, sawError: event.text, entries: upsertEntry(base.entries, `error:${event.text}`, { kind: 'error', text: event.text }) }
    case 'beat':
      return rec
  }
}

/**
 * Collects the workers that OpenCode processes started from Claude terminals report through the worker plugin.
 * Everything is in memory: a worker exists for as long as the app runs and is not older than FORGET_FINISHED_MS.
 */
export function createWorkerHub(deps: WorkerHubDeps): WorkerHub {
  const records = new Map<string, Rec>()
  const lastBeat = new Map<string, number>()

  function emit(): void {
    deps.onChange(snapshot())
  }

  function indexOf(rec: Rec): number {
    return [...records.values()].filter((r) => r.owner === rec.owner).findIndex((r) => r.id === rec.id) + 1
  }

  function snapshot(): readonly WorkerInfo[] {
    return [...records.values()]
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((rec): WorkerInfo => {
        const sum = totals(rec)
        return {
          id: rec.id,
          name: workerName(rec, indexOf(rec)),
          model: rec.model,
          status: rec.status,
          statusDetail: rec.detail,
          startedAt: rec.startedAt,
          finishedAt: rec.finishedAt,
          costUsd: sum.cost,
          tokens: sum.tokens,
          dir: rec.dir,
          ownerSessionIds: [rec.owner],
          lines: rec.entries.map((e) => e.line)
        }
      })
  }

  function trim(owner: Id): void {
    const mine = [...records.values()].filter((r) => r.owner === owner)
    if (mine.length <= MAX_WORKERS_PER_SESSION) return
    const dropOrder = [...mine].sort((a, b) => Number(a.finishedAt === null) - Number(b.finishedAt === null) || a.startedAt - b.startedAt)
    for (const rec of dropOrder.slice(0, mine.length - MAX_WORKERS_PER_SESSION)) records.delete(rec.id)
  }

  return {
    ingest(owner: Id, payload: unknown): boolean {
      const event = parseWorkerEvent(payload)
      if (event === null || !deps.isKnownSession(owner)) return false
      const now = deps.now()
      lastBeat.set(event.proc, now)
      if (event.kind === 'beat') return true
      const existing = records.get(event.oc)
      if (existing !== undefined && existing.owner !== owner) return false // an id belongs to one Claude session
      const before = existing ?? fresh(owner, event.proc, event.oc, now)
      const after = applyEvent(before, event, now)
      records.set(event.oc, after)
      if (existing === undefined) trim(owner)
      emit()
      return true
    },

    sweep(): void {
      const now = deps.now()
      let changed = false
      for (const [id, rec] of records) {
        if (rec.status === 'running') {
          const seen = Math.max(rec.lastEventAt, lastBeat.get(rec.proc) ?? 0)
          if (now - seen > LOST_AFTER_MS) {
            records.set(id, { ...rec, status: 'failed', detail: 'lost', finishedAt: now })
            changed = true
          }
        } else if (rec.finishedAt !== null && now - rec.finishedAt > FORGET_FINISHED_MS) {
          records.delete(id)
          changed = true
        }
      }
      if (changed) emit()
    },

    forgetSession(owner: Id): void {
      let changed = false
      for (const [id, rec] of records) {
        if (rec.owner === owner) {
          records.delete(id)
          changed = true
        }
      }
      if (changed) emit()
    },

    getWorkers: snapshot
  }
}
