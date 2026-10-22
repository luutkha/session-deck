import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { QuotaAutopilotState } from '../../shared/types'
import {
  loadAutopilotState,
  parseAutopilotState,
  quotaAutopilotFilePath,
  saveAutopilotState,
  serializeAutopilotState
} from './autopilotStore'

const SAMPLE: QuotaAutopilotState = { sleptForQuota: ['a', 'b'], stoppedAtLimit: ['c'], resetsAt: 1_700_003_600 }

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'quota-autopilot-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('parseAutopilotState', () => {
  it('round-trips the serialized state', () => {
    expect(parseAutopilotState(JSON.parse(serializeAutopilotState(SAMPLE)))).toEqual(SAMPLE)
  })

  it('accepts a null reset time (no usage data yet)', () => {
    expect(parseAutopilotState({ version: 1, sleptForQuota: [], stoppedAtLimit: [], resetsAt: null }).resetsAt).toBeNull()
  })

  it('rejects a non-object, a wrong version and a missing list', () => {
    expect(() => parseAutopilotState(null)).toThrow()
    expect(() => parseAutopilotState({ version: 2, sleptForQuota: [], stoppedAtLimit: [], resetsAt: null })).toThrow()
    expect(() => parseAutopilotState({ version: 1, stoppedAtLimit: [], resetsAt: null })).toThrow()
  })

  it('rejects a reset time that is not a finite number or null', () => {
    expect(() => parseAutopilotState({ version: 1, sleptForQuota: [], stoppedAtLimit: [], resetsAt: 'soon' })).toThrow()
    expect(() => parseAutopilotState({ version: 1, sleptForQuota: [], stoppedAtLimit: [], resetsAt: Infinity })).toThrow()
  })

  it('rejects session ids that are not non-empty strings', () => {
    expect(() => parseAutopilotState({ version: 1, sleptForQuota: [42], stoppedAtLimit: [], resetsAt: null })).toThrow()
    expect(() => parseAutopilotState({ version: 1, sleptForQuota: [''], stoppedAtLimit: [], resetsAt: null })).toThrow()
  })

  it('removes duplicate ids from the lists', () => {
    const parsed = parseAutopilotState({ version: 1, sleptForQuota: ['a', 'a'], stoppedAtLimit: [], resetsAt: null })
    expect(parsed.sleptForQuota).toEqual(['a'])
  })
})

describe('loadAutopilotState', () => {
  it('returns the empty state when the file does not exist', async () => {
    const state = await loadAutopilotState(path.join(tempDir(), 'missing.json'))
    expect(state).toEqual({ sleptForQuota: [], stoppedAtLimit: [], resetsAt: null })
  })

  it('rejects a corrupt file so the caller can report it', async () => {
    const file = path.join(tempDir(), 'quota-autopilot.json')
    writeFileSync(file, '{ not json', 'utf-8')
    await expect(loadAutopilotState(file)).rejects.toThrow()
  })

  it('reads a saved state back', async () => {
    const file = path.join(tempDir(), 'quota-autopilot.json')
    saveAutopilotState(file, SAMPLE)
    await expect(loadAutopilotState(file)).resolves.toEqual(SAMPLE)
  })
})

describe('saveAutopilotState', () => {
  it('creates the folder and leaves no temporary file behind', () => {
    const file = path.join(tempDir(), 'nested', 'quota-autopilot.json')
    saveAutopilotState(file, SAMPLE)
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ version: 1, ...SAMPLE })
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })
})

describe('quotaAutopilotFilePath', () => {
  it('stores the state in the user data folder', () => {
    expect(quotaAutopilotFilePath('/data')).toBe(path.join('/data', 'quota-autopilot.json'))
  })
})
