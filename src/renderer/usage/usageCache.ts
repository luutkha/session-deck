import type { AccountUsage, UsageWindow } from '../../shared/types'

function clampPercent(percent: number): number {
  return Math.min(100, Math.max(0, percent))
}

/** Parses one window value. Returns null for absent/null, undefined for malformed input. */
function parseWindow(value: unknown): UsageWindow | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const used = record.usedPercentage
  if (typeof used !== 'number' || !Number.isFinite(used)) return undefined
  const resets = record.resetsAt
  let resetsAt: number | null
  if (resets === null || resets === undefined) {
    resetsAt = null
  } else if (typeof resets === 'number' && Number.isFinite(resets)) {
    resetsAt = resets
  } else {
    return undefined
  }
  return { usedPercentage: clampPercent(used), resetsAt }
}

/**
 * Defensively parses the persisted account-usage cache. Returns null for any
 * corrupt shape (bad JSON, wrong types, missing/invalid `updatedAt`). Window
 * percentages outside 0..100 are clamped rather than rejected.
 */
export function parseCachedAccountUsage(raw: string | null): AccountUsage | null {
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const updatedAt = record.updatedAt
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null
  const fiveHour = parseWindow(record.fiveHour)
  const sevenDay = parseWindow(record.sevenDay)
  if (fiveHour === undefined || sevenDay === undefined) return null
  return { fiveHour, sevenDay, updatedAt }
}

/** Serializes account usage for persistence in localStorage. */
export function serializeAccountUsage(usage: AccountUsage): string {
  return JSON.stringify(usage)
}
