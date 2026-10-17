import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  parseQuotaMarkers,
  serializeQuotaMarkers,
  loadQuotaMarkers,
  saveQuotaMarkers,
  quotaMarkersFilePath
} from './quotaMarkers'
import { emptyQuotaMarkers, type QuotaMarkers } from './quotaGuard'

const SAMPLE: QuotaMarkers = {
  fiveHour: { resetsAt: 1_700_003_600, level: 'warn', percent: 84.5 },
  sevenDay: { resetsAt: null, level: 'critical', percent: 97 }
}

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'quota-markers-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('parseQuotaMarkers', () => {
  it('round-trips the serialized markers', () => {
    expect(parseQuotaMarkers(JSON.parse(serializeQuotaMarkers(SAMPLE)))).toEqual(SAMPLE)
  })

  it('returns empty markers for non-object input', () => {
    expect(parseQuotaMarkers(null)).toEqual(emptyQuotaMarkers())
    expect(parseQuotaMarkers('text')).toEqual(emptyQuotaMarkers())
    expect(parseQuotaMarkers([1, 2])).toEqual(emptyQuotaMarkers())
  })

  it('resets only the broken window and keeps the valid one', () => {
    const parsed = parseQuotaMarkers({
      fiveHour: { resetsAt: 5, level: 'warn', percent: 90 },
      sevenDay: { resetsAt: 5, level: 'bogus', percent: 90 }
    })
    expect(parsed.fiveHour).toEqual({ resetsAt: 5, level: 'warn', percent: 90 })
    expect(parsed.sevenDay).toEqual(emptyQuotaMarkers().sevenDay)
  })

  it('rejects non-finite numbers and wrong types per field', () => {
    const parsed = parseQuotaMarkers({
      fiveHour: { resetsAt: 'soon', level: 'warn', percent: 90 },
      sevenDay: { resetsAt: 5, level: 'none', percent: Number.NaN }
    })
    expect(parsed.fiveHour).toEqual(emptyQuotaMarkers().fiveHour)
    expect(parsed.sevenDay).toEqual(emptyQuotaMarkers().sevenDay)
  })

  it('clamps an out-of-range percent into 0..100', () => {
    const parsed = parseQuotaMarkers({
      fiveHour: { resetsAt: null, level: 'critical', percent: 250 },
      sevenDay: { resetsAt: null, level: 'none', percent: -4 }
    })
    expect(parsed.fiveHour.percent).toBe(100)
    expect(parsed.sevenDay.percent).toBe(0)
  })

  it('ignores extra fields', () => {
    const parsed = parseQuotaMarkers({
      version: 1,
      fiveHour: { resetsAt: null, level: 'none', percent: 3, extra: true },
      sevenDay: { resetsAt: null, level: 'none', percent: 0 }
    })
    expect(parsed.fiveHour).toEqual({ resetsAt: null, level: 'none', percent: 3 })
  })
})

describe('loadQuotaMarkers / saveQuotaMarkers', () => {
  it('returns empty markers when the file is missing', () => {
    const file = path.join(tempDir(), 'quota-markers.json')
    expect(loadQuotaMarkers(file)).toEqual(emptyQuotaMarkers())
  })

  it('returns empty markers when the file is corrupt JSON', () => {
    const file = path.join(tempDir(), 'quota-markers.json')
    writeFileSync(file, '{not json', 'utf-8')
    expect(loadQuotaMarkers(file)).toEqual(emptyQuotaMarkers())
  })

  it('saves and loads the same markers', () => {
    const dir = tempDir()
    const file = quotaMarkersFilePath(dir)
    saveQuotaMarkers(file, SAMPLE)
    expect(loadQuotaMarkers(file)).toEqual(SAMPLE)
  })

  it('leaves no temporary file behind after a save', () => {
    const dir = tempDir()
    const file = quotaMarkersFilePath(dir)
    saveQuotaMarkers(file, SAMPLE)
    expect(existsSync(`${file}.tmp`)).toBe(false)
    expect(readFileSync(file, 'utf-8')).toBe(serializeQuotaMarkers(SAMPLE))
  })

  it('overwrites an existing file', () => {
    const dir = tempDir()
    const file = quotaMarkersFilePath(dir)
    saveQuotaMarkers(file, SAMPLE)
    saveQuotaMarkers(file, emptyQuotaMarkers())
    expect(loadQuotaMarkers(file)).toEqual(emptyQuotaMarkers())
  })

  it('creates the directory when it does not exist', () => {
    const dir = path.join(tempDir(), 'nested', 'userData')
    const file = quotaMarkersFilePath(dir)
    saveQuotaMarkers(file, SAMPLE)
    expect(loadQuotaMarkers(file)).toEqual(SAMPLE)
  })

  it('uses quota-markers.json inside userData', () => {
    expect(path.basename(quotaMarkersFilePath('x'))).toBe('quota-markers.json')
  })
})
