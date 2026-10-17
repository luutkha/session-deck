import type { Id, WorkerInfo } from '../../shared/types'

/** A finished worker's tab closes by itself this long after it ended (unless it is the one being read). */
export const WORKER_LINGER_MS = 2 * 60 * 1000

export interface VisibleWorkersInput {
  readonly workers: readonly WorkerInfo[]
  readonly activeSessionId: Id | null
  readonly dismissed: ReadonlySet<string>
  /** The worker being read right now: it never expires under the reader. */
  readonly selectedId: string | null
  readonly now: number
}

/** Workers that belong to the active session, minus dismissed ones and finished ones that have lingered long enough. */
export function visibleWorkers(input: VisibleWorkersInput): readonly WorkerInfo[] {
  const { workers, activeSessionId, dismissed, selectedId, now } = input
  if (activeSessionId === null) return []
  return workers.filter((w: WorkerInfo): boolean => {
    if (!w.ownerSessionIds.includes(activeSessionId)) return false
    if (dismissed.has(w.id)) return false
    if (w.finishedAt === null || w.id === selectedId) return true
    return now - w.finishedAt < WORKER_LINGER_MS
  })
}

/** Milliseconds until the first finished, unselected worker expires; null when nothing will. */
export function nextExpiryIn(workers: readonly WorkerInfo[], selectedId: string | null, now: number): number | null {
  let soonest: number | null = null
  for (const w of workers) {
    if (w.finishedAt === null || w.id === selectedId) continue
    const left = w.finishedAt + WORKER_LINGER_MS - now
    if (left > 0 && (soonest === null || left < soonest)) soonest = left
  }
  return soonest
}

/** "opencode-go/glm-5.3-flash" -> "glm-5.3-flash". */
export function shortModel(model: string): string {
  const slash = model.lastIndexOf('/')
  return slash >= 0 && slash < model.length - 1 ? model.slice(slash + 1) : model
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

export function formatCost(usd: number): string {
  if (usd <= 0) return '$0'
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}`
  return tokens < 1_000_000 ? `${(tokens / 1000).toFixed(1)}k` : `${(tokens / 1_000_000).toFixed(1)}M`
}

/** Plain-words status for the tab tooltip and the view header. */
export function statusText(worker: Pick<WorkerInfo, 'status' | 'statusDetail'>): string {
  if (worker.status === 'running') return 'Working…'
  if (worker.status === 'done') return 'Finished'
  const reasons: Record<string, string> = {
    'rate-limited': 'Stopped: usage limit reached',
    timeout: 'Stopped: took too long',
    stalled: 'Stopped: no output for too long',
    'over-budget': 'Stopped: over its cost limit',
    blocked: 'Stopped: waiting for a permission it was not given',
    empty: 'Finished without any answer',
    error: 'Stopped: error'
  }
  return reasons[worker.statusDetail] ?? `Stopped: ${worker.statusDetail}`
}
