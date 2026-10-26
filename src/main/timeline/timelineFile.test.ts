import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { TimelineTurn } from '../../shared/types'
import { TIMELINE_MAX_AGE_DAYS, TIMELINE_PROMPT_MAX } from '../../shared/types'
import {
  loadTimelineDocument,
  loadTimelineFile,
  parseTimelineDocument,
  parseTimelineFile,
  saveTimelineDocument,
  saveTimelineFile,
  serializeTimelineDocument,
  serializeTimelineFile,
  timelineFilePath
} from './timelineFile'

const NOW = 1_700_000_000_000
const DAY_MS = 86_400_000

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'timeline-file-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function turn(overrides: Partial<TimelineTurn> = {}): TimelineTurn {
  return {
    id: '1-0',
    sessionId: 's1',
    prompt: 'do the thing',
    startedAt: NOW - 1_000,
    endedAt: NOW,
    end: 'finished',
    costUsd: 0.25,
    neededYou: false,
    ...overrides
  }
}

describe('parseTimelineFile', () => {
  it('keeps valid turns of version 1', () => {
    const turns = parseTimelineFile({ version: 1, turns: [turn()] }, NOW)
    expect(turns).toEqual([turn()])
  })

  it('returns null for a non-object, a wrong version or a missing turns array', () => {
    expect(parseTimelineFile(null, NOW)).toBeNull()
    expect(parseTimelineFile([], NOW)).toBeNull()
    expect(parseTimelineFile({ version: 2, turns: [] }, NOW)).toBeNull()
    expect(parseTimelineFile({ version: 1 }, NOW)).toBeNull()
    expect(parseTimelineFile({ version: 1, turns: 'x' }, NOW)).toBeNull()
  })

  it('drops individually invalid turns and keeps the valid ones', () => {
    const raw = {
      version: 1,
      turns: [turn({ id: 'a' }), 'junk', turn({ id: '' }), turn({ id: 'b', sessionId: 7 as unknown as string })]
    }
    expect(parseTimelineFile(raw, NOW)?.map((t) => t.id)).toEqual(['a'])
  })

  it('drops a turn whose field has the wrong type', () => {
    const bad: unknown[] = [
      { ...turn(), prompt: 5 },
      { ...turn(), startedAt: 'now' },
      { ...turn(), startedAt: -1 },
      { ...turn(), endedAt: 'later' },
      { ...turn(), end: 'done' },
      { ...turn(), costUsd: '1' },
      { ...turn(), costUsd: -0.5 },
      { ...turn(), neededYou: 'yes' }
    ]
    expect(parseTimelineFile({ version: 1, turns: bad }, NOW)).toEqual([])
  })

  it('drops a finished turn whose endedAt is before its startedAt', () => {
    const raw = { version: 1, turns: [turn({ startedAt: NOW, endedAt: NOW - 5 })] }
    expect(parseTimelineFile(raw, NOW)).toEqual([])
  })

  it('a turn loaded with end null becomes exited with endedAt = startedAt', () => {
    const raw = { version: 1, turns: [turn({ endedAt: null, end: null, startedAt: NOW - 500 })] }
    const [loaded] = parseTimelineFile(raw, NOW) ?? []
    expect(loaded.end).toBe('exited')
    expect(loaded.endedAt).toBe(NOW - 500)
  })

  it('cuts a prompt longer than TIMELINE_PROMPT_MAX', () => {
    const raw = { version: 1, turns: [turn({ prompt: 'x'.repeat(TIMELINE_PROMPT_MAX + 10) })] }
    expect(parseTimelineFile(raw, NOW)?.[0].prompt).toHaveLength(TIMELINE_PROMPT_MAX)
  })

  it('drops turns older than TIMELINE_MAX_AGE_DAYS by startedAt and keeps newer ones', () => {
    const old = turn({ id: 'old', startedAt: NOW - (TIMELINE_MAX_AGE_DAYS + 1) * DAY_MS, endedAt: NOW - (TIMELINE_MAX_AGE_DAYS + 1) * DAY_MS + 1 })
    const fresh = turn({ id: 'fresh', startedAt: NOW - (TIMELINE_MAX_AGE_DAYS - 1) * DAY_MS })
    const ids = parseTimelineFile({ version: 1, turns: [old, fresh] }, NOW)?.map((t) => t.id)
    expect(ids).toEqual(['fresh'])
  })

  it('drops a duplicate turn id within the same session', () => {
    const raw = { version: 1, turns: [turn({ id: 'same' }), turn({ id: 'same', prompt: 'again' })] }
    const turns = parseTimelineFile(raw, NOW)
    expect(turns?.map((t) => t.prompt)).toEqual(['do the thing'])
  })
})

describe('serializeTimelineFile', () => {
  it('round-trips through parseTimelineFile', () => {
    const turns = [turn({ id: 'a' }), turn({ id: 'b', end: null, endedAt: null, costUsd: null, neededYou: true })]
    const parsed = parseTimelineFile(JSON.parse(serializeTimelineFile(turns)), NOW)
    expect(parsed?.map((t) => t.id)).toEqual(['a', 'b'])
    expect(parsed?.[1].end).toBe('exited')
    expect(parsed?.[1].neededYou).toBe(true)
  })

  it('writes the version field', () => {
    expect(JSON.parse(serializeTimelineFile([]))).toEqual({ version: 1, turns: [] })
  })
})

describe('sleep records in the timeline file', () => {
  it('round-trips sleep records with the turns', () => {
    const document = {
      turns: [turn({ id: 'a' })],
      sleeps: [
        { sessionId: 's1', at: NOW - 1000 },
        { sessionId: 's2', at: NOW - 500 }
      ]
    }
    const parsed = parseTimelineDocument(JSON.parse(serializeTimelineDocument(document)), NOW)
    expect(parsed?.turns.map((t) => t.id)).toEqual(['a'])
    expect(parsed?.sleeps).toEqual([
      { sessionId: 's1', at: NOW - 1000 },
      { sessionId: 's2', at: NOW - 500 }
    ])
  })

  it('omits the field when there is nothing to remember', () => {
    expect(JSON.parse(serializeTimelineDocument({ turns: [], sleeps: [] }))).toEqual({ version: 1, turns: [] })
  })

  it('keeps the newest sleep per session and drops invalid or old entries', () => {
    const raw = {
      version: 1,
      turns: [],
      sleeps: [
        { sessionId: 's1', at: NOW - 2000 },
        { sessionId: 's1', at: NOW - 1000 },
        { sessionId: '', at: NOW },
        { sessionId: 's2', at: 'x' },
        { sessionId: 's3', at: NOW - (TIMELINE_MAX_AGE_DAYS + 1) * DAY_MS },
        null,
        42
      ]
    }
    expect(parseTimelineDocument(raw, NOW)?.sleeps).toEqual([{ sessionId: 's1', at: NOW - 1000 }])
  })

  it('a missing sleeps field still reads as an empty list (old file)', () => {
    expect(parseTimelineDocument({ version: 1, turns: [] }, NOW)?.sleeps).toEqual([])
  })

  it('loads sleeps written by saveTimelineDocument', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'timeline.json')
    await saveTimelineDocument(file, { turns: [], sleeps: [{ sessionId: 's1', at: NOW - 10 }] })
    const document = await loadTimelineDocument(file, NOW, vi.fn())
    expect(document.sleeps).toEqual([{ sessionId: 's1', at: NOW - 10 }])
  })
})

describe('timelineFilePath', () => {
  it('puts the timeline file in the user data folder', () => {
    expect(path.basename(timelineFilePath('C:\\data'))).toBe('sessiondeck-timeline.json')
    expect(timelineFilePath('C:\\data')).toContain('data')
  })
})

describe('loadTimelineFile', () => {
  it('a missing file is an empty timeline and not an error', async () => {
    const onError = vi.fn()
    const dir = tempDir()
    const turns = await loadTimelineFile(path.join(dir, 'nope.json'), NOW, onError)
    expect(turns).toEqual([])
    expect(onError).not.toHaveBeenCalled()
  })

  it('a corrupt JSON file is an empty timeline and reports the error', async () => {
    const onError = vi.fn()
    const dir = tempDir()
    const file = path.join(dir, 'timeline.json')
    writeFileSync(file, '{ not json', 'utf-8')
    expect(await loadTimelineFile(file, NOW, onError)).toEqual([])
    expect(onError).toHaveBeenCalledWith('timeline load', expect.any(Error))
  })

  it('a file with the wrong shape is an empty timeline and reports the error', async () => {
    const onError = vi.fn()
    const dir = tempDir()
    const file = path.join(dir, 'timeline.json')
    writeFileSync(file, JSON.stringify({ version: 9, turns: [] }), 'utf-8')
    expect(await loadTimelineFile(file, NOW, onError)).toEqual([])
    expect(onError).toHaveBeenCalledWith('timeline load', expect.any(Error))
  })

  it('loads the turns that were saved', async () => {
    const onError = vi.fn()
    const dir = tempDir()
    const file = path.join(dir, 'timeline.json')
    writeFileSync(file, serializeTimelineFile([turn({ id: 'x' })]), 'utf-8')
    const turns = await loadTimelineFile(file, NOW, onError)
    expect(turns.map((t) => t.id)).toEqual(['x'])
    expect(onError).not.toHaveBeenCalled()
  })
})

describe('saveTimelineFile', () => {
  it('writes the file and leaves no temporary file behind', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'nested', 'timeline.json')
    await saveTimelineFile(file, [turn({ id: 'saved' })])
    expect(existsSync(`${file}.tmp`)).toBe(false)
    const parsed = parseTimelineFile(JSON.parse(readFileSync(file, 'utf-8')), NOW)
    expect(parsed?.map((t) => t.id)).toEqual(['saved'])
  })

  it('replaces an existing file with the new content', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'timeline.json')
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, serializeTimelineFile([turn({ id: 'old' })]), 'utf-8')
    await saveTimelineFile(file, [turn({ id: 'new' })])
    const parsed = parseTimelineFile(JSON.parse(readFileSync(file, 'utf-8')), NOW)
    expect(parsed?.map((t) => t.id)).toEqual(['new'])
  })
})
