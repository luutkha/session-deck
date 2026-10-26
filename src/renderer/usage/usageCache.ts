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
 * Defensively parses one account object. Returns null for a corrupt shape; the provider is
 * optional (absent = Claude, the shape written before OpenCode Go existed).
 */
function parseAccount(record: unknown): AccountUsage | null {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return null
  const value = record as Record<string, unknown>
  const updatedAt = value.updatedAt
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null
  const provider = value.provider
  if (provider !== undefined && provider !== 'claude' && provider !== 'opencode-go') return null
  const fiveHour = parseWindow(value.fiveHour)
  const sevenDay = parseWindow(value.sevenDay)
  const monthly = parseWindow(value.monthly)
  if (fiveHour === undefined || sevenDay === undefined || monthly === undefined) return null
  const account: AccountUsage = { fiveHour, sevenDay, updatedAt }
  return provider === undefined ? account : { ...account, provider, ...(monthly === null ? {} : { monthly }) }
}

/**
 * Parses the multi-provider cache. Accepts the new array form and the legacy single
 * Claude account, which reads as a one-element list. Duplicate providers are dropped
 * (first wins). Returns null when nothing usable is stored.
 */
export function parseCachedAccounts(raw: string | null): readonly AccountUsage[] | null {
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) {
    const legacy = parseAccount(parsed)
    return legacy === null ? null : [legacy]
  }
  const byProvider = new Map<string, AccountUsage>()
  for (const entry of parsed) {
    const account = parseAccount(entry)
    if (account === null) continue
    const key = account.provider ?? 'claude'
    if (!byProvider.has(key)) byProvider.set(key, account)
  }
  return byProvider.size === 0 ? null : [...byProvider.values()]
}

/** Serializes the multi-provider account list (an array, read by parseCachedAccounts). */
export function serializeAccounts(accounts: readonly AccountUsage[]): string {
  return JSON.stringify(accounts)
}
