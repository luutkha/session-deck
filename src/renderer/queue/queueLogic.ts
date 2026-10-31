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

export const QUEUE_STATE_TEXT: Readonly<Record<QueueState, string>> = {
  shell: 'Prompts can only be queued for Claude and OpenCode sessions.',
  stopped: 'The session is not running. Queued prompts go out after it runs and finishes a turn.',
  busy: 'The next prompt is typed in when the current turn finishes.',
  idle: 'The session is idle: a prompt you add is sent right away.'
}
