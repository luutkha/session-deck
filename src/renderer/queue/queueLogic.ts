// Pure helpers for the prompt queue panel (D47). No React, no IPC.
import { QUEUE_MAX_ITEMS, QUEUE_TEXT_MAX, type QueuedPrompt, type RuntimeState, type Session } from '../../shared/types'

/** Appends a prompt (trimmed). Returns the same list when the text is blank, too long, or the queue is full. */
export function addPrompt(queue: readonly QueuedPrompt[], text: string, id: string, now: number): readonly QueuedPrompt[] {
  const trimmed = text.trim()
  if (trimmed.length === 0 || trimmed.length > QUEUE_TEXT_MAX || queue.length >= QUEUE_MAX_ITEMS) return queue
  return [...queue, { id, text: trimmed, addedAt: now }]
}

export function removePrompt(queue: readonly QueuedPrompt[], id: string): readonly QueuedPrompt[] {
  return queue.filter((item) => item.id !== id)
}

/** Moves a prompt one place earlier (it is sent sooner). The first item stays put. */
export function movePromptUp(queue: readonly QueuedPrompt[], id: string): readonly QueuedPrompt[] {
  const index = queue.findIndex((item) => item.id === id)
  if (index <= 0) return queue
  const next = [...queue]
  const [item] = next.splice(index, 1)
  if (item !== undefined) next.splice(index - 1, 0, item)
  return next
}

export type QueueState = 'shell' | 'stopped' | 'busy' | 'idle'

/** What the queue will do right now for this session. */
export function queueState(session: Session, state: RuntimeState | undefined): QueueState {
  if (session.agent === 'shell') return 'shell'
  if (session.closedAt !== undefined || state?.run !== 'running' || state.sleeping === true) return 'stopped'
  return state.activity === 'finished' ? 'idle' : 'busy'
}

/** Where one prompt sent to several sessions goes (D48): through each session's queue, never into a running turn. */
export interface BroadcastPlan {
  /** Idle sessions: the prompt is typed in at once. */
  readonly now: readonly string[]
  /** Busy sessions: typed in when their current turn finishes. */
  readonly later: readonly string[]
  /** Sleeping, exited or closed sessions: queued, sent after they run and finish a turn. */
  readonly stopped: readonly string[]
  /** Shell sessions and full queues: not sent. */
  readonly skipped: readonly string[]
}

export function broadcastPlan(
  ids: readonly string[],
  sessions: readonly Session[],
  runtime: ReadonlyMap<string, RuntimeState>
): BroadcastPlan {
  const now: string[] = []
  const later: string[] = []
  const stopped: string[] = []
  const skipped: string[] = []
  for (const id of ids) {
    const session = sessions.find((s) => s.id === id)
    if (session === undefined) continue
    const state = queueState(session, runtime.get(id))
    if (state === 'shell' || (session.queue?.length ?? 0) >= QUEUE_MAX_ITEMS) skipped.push(id)
    else if (state === 'idle') now.push(id)
    else if (state === 'busy') later.push(id)
    else stopped.push(id)
  }
  return { now, later, stopped, skipped }
}

/** The sessions a broadcast actually reaches (everything except the skipped ones), in selection order. */
export function broadcastTargets(plan: BroadcastPlan, ids: readonly string[]): readonly string[] {
  const reach = new Set([...plan.now, ...plan.later, ...plan.stopped])
  return ids.filter((id) => reach.has(id))
}

export const QUEUE_STATE_TEXT: Readonly<Record<QueueState, string>> = {
  shell: 'Prompts can only be queued for Claude and OpenCode sessions.',
  stopped: 'The session is not running. Queued prompts go out after it runs and finishes a turn.',
  busy: 'The next prompt is typed in when the current turn finishes.',
  idle: 'The session is idle: a prompt you add is sent right away.'
}
