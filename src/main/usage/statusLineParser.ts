import type { SessionUsage, UsageProvider, UsageWindow } from '../../shared/types'

/** Account windows as read from one payload (the caller adds updatedAt). */
export interface ParsedAccountWindows {
  readonly fiveHour: UsageWindow | null
  readonly sevenDay: UsageWindow | null
  /** OpenCode Go only; absent/null for a Claude payload. */
  readonly monthly?: UsageWindow | null
}

export interface ParsedStatusLine {
  /** Which account these windows belong to ('claude' when the payload carries no known source). */
  readonly provider: UsageProvider
  /** null when the payload carried no usable rate_limits. */
  readonly account: ParsedAccountWindows | null
  readonly session: Omit<SessionUsage, 'sessionId'>
}

type JsonObject = Record<string, unknown>

const MAX_TEXT_LENGTH = 60

function asObject(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null
}

function readText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().slice(0, MAX_TEXT_LENGTH)
  return trimmed.length > 0 ? trimmed : null
}

function readFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** A finite percentage clamped to 0..100, or null. */
export function clampPercent(value: unknown): number | null {
  const n = readFinite(value)
  return n === null ? null : Math.min(100, Math.max(0, n))
}

/** Cost in USD: a finite number >= 0, or null. */
function readCost(value: unknown): number | null {
  const n = readFinite(value)
  return n !== null && n >= 0 ? n : null
}

/**
 * Reset time as epoch SECONDS. Accepts a number, a numeric string, or an ISO date string.
 * Anything else (or a negative / non-finite value) yields null.
 */
export function parseResetsAt(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
  }
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text.length === 0) return null
  if (/^\d+(\.\d+)?$/.test(text)) {
    return Math.floor(Number(text))
  }
  const ms = Date.parse(text)
  return Number.isFinite(ms) && ms >= 0 ? Math.floor(ms / 1000) : null
}

function parseWindow(value: unknown): UsageWindow | null {
  const obj = asObject(value)
  if (!obj) return null
  const usedPercentage = clampPercent(obj.used_percentage)
  if (usedPercentage === null) return null
  return { usedPercentage, resetsAt: parseResetsAt(obj.resets_at) }
}

/**
 * Extracts plan usage and per-session fields from a Claude Code statusLine payload.
 * Pure and total: every field is optional and any input (null, arrays, wrong types) yields a valid result.
 */
export function parseStatusLine(payload: unknown, now: number): ParsedStatusLine {
  const root = asObject(payload) ?? {}
  const model = asObject(root.model)
  const effort = asObject(root.effort)
  const cost = asObject(root.cost)
  const context = asObject(root.context_window)
  const limits = asObject(root.rate_limits)
  const provider: UsageProvider = root.source === 'opencode-go' ? 'opencode-go' : 'claude'

  const fiveHour = limits ? parseWindow(limits.five_hour) : null
  const sevenDay = limits ? parseWindow(limits.seven_day) : null
  const monthly = provider === 'opencode-go' && limits ? parseWindow(limits.monthly) : null
  const account =
    fiveHour === null && sevenDay === null && monthly === null
      ? null
      : provider === 'opencode-go'
        ? { fiveHour, sevenDay, monthly }
        : { fiveHour, sevenDay }

  return {
    provider,
    account,
    session: {
      model: model ? readText(model.display_name) : null,
      contextPercent: context ? clampPercent(context.used_percentage) : null,
      costUsd: cost ? readCost(cost.total_cost_usd) : null,
      effort: effort ? readText(effort.level) : null,
      updatedAt: now
    }
  }
}
