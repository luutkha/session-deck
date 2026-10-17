import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { emptyQuotaMarkers, EMPTY_QUOTA_MARKER, type QuotaLevel, type QuotaMarker, type QuotaMarkers } from './quotaGuard'

export const QUOTA_MARKERS_FILE = 'quota-markers.json'

const LEVELS: readonly QuotaLevel[] = ['none', 'warn', 'critical']

export function quotaMarkersFilePath(userDataDir: string): string {
  return path.join(userDataDir, QUOTA_MARKERS_FILE)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseMarker(value: unknown): QuotaMarker {
  if (!isRecord(value)) return EMPTY_QUOTA_MARKER
  const { resetsAt, level, percent } = value
  if (resetsAt !== null && (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt))) return EMPTY_QUOTA_MARKER
  if (typeof level !== 'string' || !LEVELS.includes(level as QuotaLevel)) return EMPTY_QUOTA_MARKER
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return EMPTY_QUOTA_MARKER
  return {
    resetsAt,
    level: level as QuotaLevel,
    percent: Math.min(100, Math.max(0, percent))
  }
}

/** Validates untrusted JSON. Anything malformed becomes the empty marker for that window. */
export function parseQuotaMarkers(raw: unknown): QuotaMarkers {
  if (!isRecord(raw)) return emptyQuotaMarkers()
  return {
    fiveHour: parseMarker(raw.fiveHour),
    sevenDay: parseMarker(raw.sevenDay)
  }
}

export function serializeQuotaMarkers(markers: QuotaMarkers): string {
  return JSON.stringify({ version: 1, fiveHour: markers.fiveHour, sevenDay: markers.sevenDay }, null, 2)
}

/** Reads the markers file. A missing or corrupt file yields empty markers (never throws). */
export function loadQuotaMarkers(filePath: string): QuotaMarkers {
  try {
    return parseQuotaMarkers(JSON.parse(readFileSync(filePath, 'utf-8')))
  } catch {
    return emptyQuotaMarkers()
  }
}

/** Writes to a temporary file first, then renames it over the target, so a crash never leaves half a file. */
export function saveQuotaMarkers(filePath: string, markers: QuotaMarkers): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, serializeQuotaMarkers(markers), 'utf-8')
  renameSync(tmp, filePath)
}
