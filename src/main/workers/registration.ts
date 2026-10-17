import path from 'node:path'
import type { WorkerStatus } from '../../shared/types'

/** A run still marked "running" whose files have not changed for this long is treated as dead (runner stall limit is 5 min). */
export const STALE_RUNNING_MS = 6 * 60 * 1000

/** What the runner (oc-run) writes to <dir>/.opencode-runs/sessions/<name>.json. */
export interface Registration {
  readonly sessionID: string
  readonly model: string
  readonly status: string
  /** Absolute path of the JSONL log, validated to sit inside the registry's .opencode-runs folder. */
  readonly log: string
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Parses a registration file. Returns null when it is not valid or its log points outside `<dir>/.opencode-runs`. */
export function parseRegistration(text: string, runsDir: string): Registration | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as Record<string, unknown>
  const sessionID = str(record.sessionID)
  const log = str(record.log)
  const status = str(record.status)
  if (sessionID === null || log === null || status === null) return null
  const resolved = path.resolve(log)
  const relative = path.relative(path.resolve(runsDir), resolved)
  if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return { sessionID, model: str(record.model) ?? 'unknown model', status, log: resolved }
}

export interface RunPhase {
  readonly status: WorkerStatus
  readonly detail: string
}

/** running = the runner says so and files changed recently; done = ok; anything else is failed. */
export function runPhase(reg: Registration, lastChangeMs: number, now: number): RunPhase {
  if (reg.status === 'running') {
    return now - lastChangeMs < STALE_RUNNING_MS ? { status: 'running', detail: 'running' } : { status: 'failed', detail: 'stalled' }
  }
  return reg.status === 'ok' ? { status: 'done', detail: 'ok' } : { status: 'failed', detail: reg.status }
}

/** Folders to look in for a session: its cwd and up to `levels` parents (a Claude session often sits below the project root). */
export function candidateDirs(cwd: string, levels = 2): readonly string[] {
  const dirs: string[] = []
  let current = path.resolve(cwd)
  for (let i = 0; i <= levels; i += 1) {
    dirs.push(current)
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return dirs
}
