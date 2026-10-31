import { beforeEach, describe, expect, it } from 'vitest'
import type { Id, RuntimeState, Session } from '../../shared/types'
import { createLaunchResume, parseResumeFile, RESUME_STAGGER_MS, serializeResumeFile, type LaunchResume } from './launchResume'

function session(id: Id, extra: Partial<Session> = {}): Session {
  return { id, name: id, cwd: 'C:/p', groupId: null, statusId: null, order: 0, createdAt: 0, claudeArgs: [], ...extra }
}
const state = (sessionId: Id, extra: Partial<RuntimeState> = {}): RuntimeState => ({ sessionId, run: 'running', exitCode: null, attention: null, ...extra })

let sessions: Session[]
let listeners: ((s: RuntimeState) => void)[]
let file: string | null
let written: string[]
let resumed: Id[]
let enabled: boolean
let clock: number
let timers: { at: number; run: () => void; done: boolean }[]
let resume: LaunchResume

function emit(s: RuntimeState): void {
  for (const listener of listeners) listener(s)
}
async function advance(ms: number): Promise<void> {
  clock += ms
  for (const timer of timers) {
    if (!timer.done && timer.at <= clock) {
      timer.done = true
      timer.run()
    }
  }
  await Promise.resolve()
}
const lastWritten = (): readonly Id[] => parseResumeFile(written[written.length - 1] ?? '')

beforeEach(() => {
  sessions = [session('a'), session('b'), session('c', { closedAt: 1 })]
  listeners = []
  file = null
  written = []
  resumed = []
  enabled = true
  clock = 0
  timers = []
  resume = createLaunchResume({
    readFile: async () => {
      if (file === null) throw new Error('ENOENT')
      return file
    },
    writeFile: async (text) => {
      written.push(text)
    },
    getSessions: () => sessions,
    subscribeRuntime: (listener) => {
      listeners.push(listener)
      return () => {
        listeners = listeners.filter((l) => l !== listener)
      }
    },
    resume: (id) => {
      resumed.push(id)
      return true
    },
    enabled: () => enabled,
    setTimeout: (run, ms) => {
      const timer = { at: clock + ms, run, done: false }
      timers.push(timer)
      return timer as unknown as ReturnType<typeof setTimeout>
    },
    clearTimeout: (timer) => {
      ;(timer as unknown as { done: boolean }).done = true
    },
    onError: () => undefined
  })
})

describe('file format', () => {
  it('round trips and rejects anything unexpected', () => {
    expect(parseResumeFile(serializeResumeFile(['a', 'b']))).toEqual(['a', 'b'])
    expect(parseResumeFile('nope')).toEqual([])
    expect(parseResumeFile('{"version":2,"ids":["a"]}')).toEqual([])
    expect(parseResumeFile('{"version":1,"ids":["a",3,""]}')).toEqual(['a'])
  })
})

describe('createLaunchResume', () => {
  it('loads nothing on the first launch', async () => {
    expect(await resume.loadSaved()).toEqual([])
  })

  it('tracks running sessions (not asleep, not closed) and saves after a pause', async () => {
    resume.startTracking()
    emit(state('a'))
    emit(state('b'))
    emit(state('c'))
    expect(written).toEqual([])
    await advance(1000)
    expect(lastWritten()).toEqual(['a', 'b'])
    emit(state('a', { run: 'exited', sleeping: true }))
    emit(state('b', { run: 'exited' }))
    await advance(1000)
    expect(lastWritten()).toEqual([])
  })

  it('stop() saves the list BEFORE the shutdown kills empty it, and stops listening', async () => {
    resume.startTracking()
    emit(state('a'))
    await resume.stop()
    expect(lastWritten()).toEqual(['a'])
    emit(state('a', { run: 'exited' }))
    await advance(2000)
    expect(lastWritten()).toEqual(['a'])
  })

  it('resumes saved sessions one by one, skipping closed and removed ones', async () => {
    resume.resumeSaved(['a', 'gone', 'c', 'b'])
    await advance(0)
    expect(resumed).toEqual(['a'])
    await advance(RESUME_STAGGER_MS)
    expect(resumed).toEqual(['a', 'b'])
  })

  it('does nothing when the setting is off', async () => {
    enabled = false
    resume.resumeSaved(['a', 'b'])
    await advance(5000)
    expect(resumed).toEqual([])
  })

  it('a quick quit keeps the sessions that were still waiting for their start', async () => {
    resume.startTracking()
    resume.resumeSaved(['a', 'b'])
    await advance(0)
    emit(state('a'))
    await resume.stop()
    expect([...lastWritten()].sort()).toEqual(['a', 'b'])
    expect(resumed).toEqual(['a'])
  })
})
