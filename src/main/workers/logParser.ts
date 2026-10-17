import type { WorkerLine } from '../../shared/types'

/** Newest lines kept per worker. */
export const MAX_WORKER_LINES = 400
const MAX_TEXT_CHARS = 1200
const MAX_SUMMARY_CHARS = 240

export interface WorkerLogState {
  /** Trailing partial line of the last chunk, completed by the next one. */
  readonly carry: string
  readonly lines: readonly WorkerLine[]
  readonly costUsd: number
  readonly tokens: number
  /** Timestamp (ms) of the first event seen, or null. */
  readonly firstAt: number | null
}

export const EMPTY_LOG_STATE: WorkerLogState = { carry: '', lines: [], costUsd: 0, tokens: 0, firstAt: null }

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? ''
  return line.trim()
}

/** One-line description of what a tool call does, from its input. */
export function summarizeTool(input: Record<string, unknown> | null): string {
  if (input === null) return ''
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = asString(input[key])
      if (value !== null) return value
    }
    return null
  }
  const text = pick('command', 'filePath', 'path', 'pattern', 'query', 'url', 'description', 'prompt')
  if (text !== null) return clip(firstLine(text), MAX_SUMMARY_CHARS)
  const json = JSON.stringify(input)
  return clip(json === '{}' ? '' : json, MAX_SUMMARY_CHARS)
}

function toolLine(part: Record<string, unknown>): WorkerLine | null {
  const tool = asString(part.tool)
  if (tool === null) return null
  const state = asRecord(part.state)
  const status = state === null ? null : asString(state.status)
  const summary = summarizeTool(state === null ? null : asRecord(state.input))
  if (status === 'error') {
    const reason = state === null ? null : asString(state.error)
    return { kind: 'tool', tool, text: reason === null ? summary : `${summary} — ${clip(firstLine(reason), MAX_SUMMARY_CHARS)}`, state: 'error' }
  }
  return { kind: 'tool', tool, text: summary, state: status === 'completed' ? 'done' : 'running' }
}

function errorLine(event: Record<string, unknown>): WorkerLine {
  const error = asRecord(event.error)
  const data = error === null ? null : asRecord(error.data)
  const message = (data === null ? null : asString(data.message)) ?? (error === null ? null : asString(error.name)) ?? 'Error'
  return { kind: 'error', text: clip(message, MAX_TEXT_CHARS) }
}

function applyEvent(state: WorkerLogState, event: Record<string, unknown>): WorkerLogState {
  const stamp = asNumber(event.timestamp)
  const firstAt = state.firstAt ?? (stamp > 0 ? stamp : null)
  const part = asRecord(event.part)
  switch (event.type) {
    case 'text': {
      const text = part === null ? null : asString(part.text)
      return text === null ? { ...state, firstAt } : addLine({ ...state, firstAt }, { kind: 'text', text: clip(text.trim(), MAX_TEXT_CHARS) })
    }
    case 'tool_use': {
      const line = part === null ? null : toolLine(part)
      return line === null ? { ...state, firstAt } : addLine({ ...state, firstAt }, line)
    }
    case 'step_finish':
      return {
        ...state,
        firstAt,
        costUsd: state.costUsd + asNumber(part?.cost),
        tokens: state.tokens + asNumber(asRecord(part?.tokens)?.total)
      }
    case 'error':
      return addLine({ ...state, firstAt }, errorLine(event))
    default:
      return { ...state, firstAt }
  }
}

function addLine(state: WorkerLogState, line: WorkerLine): WorkerLogState {
  const lines = [...state.lines, line]
  return { ...state, lines: lines.length > MAX_WORKER_LINES ? lines.slice(lines.length - MAX_WORKER_LINES) : lines }
}

/** Feeds the next chunk of a worker's JSONL log. Unparseable lines (a cut-off first line, noise) are skipped. */
export function appendLogChunk(state: WorkerLogState, chunk: string): WorkerLogState {
  const pieces = (state.carry + chunk).split('\n')
  const carry = pieces.pop() ?? ''
  let next: WorkerLogState = { ...state, carry }
  for (const raw of pieces) {
    const text = raw.trim()
    if (text.length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      continue
    }
    const event = asRecord(parsed)
    if (event !== null) next = applyEvent(next, event)
  }
  return next
}
