import { isOpencodeSessionId } from '../opencode/values'

/** Hard caps on text from the plugin: the hook server is local but its input is still untrusted. */
export const MAX_EVENT_TEXT = 1200
const MAX_ID = 128
const MAX_DIR = 1024
const MAX_MODEL = 200

export type ToolState = 'running' | 'done' | 'error'

export type WorkerEvent =
  | { readonly kind: 'hello'; readonly proc: string }
  | { readonly kind: 'beat'; readonly proc: string }
  | { readonly kind: 'start'; readonly proc: string; readonly oc: string; readonly dir: string; readonly title: string }
  | { readonly kind: 'busy'; readonly proc: string; readonly oc: string; readonly dir: string }
  | { readonly kind: 'idle'; readonly proc: string; readonly oc: string }
  | { readonly kind: 'user' | 'text'; readonly proc: string; readonly oc: string; readonly partId: string; readonly text: string }
  | { readonly kind: 'tool'; readonly proc: string; readonly oc: string; readonly partId: string; readonly tool: string; readonly state: ToolState; readonly text: string }
  | { readonly kind: 'step'; readonly proc: string; readonly oc: string; readonly partId: string; readonly cost: number; readonly tokens: number }
  | { readonly kind: 'model'; readonly proc: string; readonly oc: string; readonly model: string }
  | { readonly kind: 'error'; readonly proc: string; readonly oc: string; readonly text: string }

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function str(value: unknown, max: number, allowEmpty = false): string | null {
  if (typeof value !== 'string') return null
  if (value.length === 0 && !allowEmpty) return null
  return value.length > max ? value.slice(0, max) : value
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/** Validates one plugin payload. Returns null for anything that is not a well-formed v1 event. */
export function parseWorkerEvent(payload: unknown): WorkerEvent | null {
  const p = record(payload)
  if (p === null || p.v !== 1) return null
  const proc = str(p.proc, MAX_ID)
  const kind = p.kind
  if (proc === null || typeof kind !== 'string') return null
  // hello: plugin initialization of (potentially) the owner process itself, before any session exists.
  if (kind === 'hello') return { kind, proc }
  if (kind === 'beat') return { kind, proc }
  if (!isOpencodeSessionId(p.oc)) return null
  const oc = p.oc
  const dir = str(p.dir, MAX_DIR, true) ?? ''
  switch (kind) {
    case 'start':
      return { kind, proc, oc, dir, title: str(p.title, 200, true) ?? '' }
    case 'busy':
      return { kind, proc, oc, dir }
    case 'idle':
      return { kind, proc, oc }
    case 'user':
    case 'text': {
      const partId = str(p.partId, MAX_ID)
      const text = str(p.text, MAX_EVENT_TEXT, true)
      return partId === null || text === null ? null : { kind, proc, oc, partId, text }
    }
    case 'tool': {
      const partId = str(p.partId, MAX_ID)
      const tool = str(p.tool, 80)
      const state = p.state === 'running' || p.state === 'done' || p.state === 'error' ? p.state : null
      const text = str(p.text, 400, true)
      return partId === null || tool === null || state === null || text === null ? null : { kind, proc, oc, partId, tool, state, text }
    }
    case 'step': {
      const partId = str(p.partId, MAX_ID)
      return partId === null ? null : { kind, proc, oc, partId, cost: num(p.cost), tokens: num(p.tokens) }
    }
    case 'model': {
      const model = str(p.model, MAX_MODEL)
      return model === null ? null : { kind, proc, oc, model }
    }
    case 'error': {
      const text = str(p.text, MAX_EVENT_TEXT, true)
      return text === null ? null : { kind, proc, oc, text }
    }
    default:
      return null
  }
}
