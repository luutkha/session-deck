import { beforeEach, describe, expect, it } from 'vitest'
import type { Id, QueuedPrompt, RuntimeState, Session, StoreData } from '../../shared/types'
import { canTypeInto, createPromptQueue, queuedText, QUEUE_ENTER_DELAY_MS, QUEUE_SENT_GUARD_MS, type PromptQueue } from './promptQueue'

function session(id: Id, extra: Partial<Session> = {}): Session {
  return { id, name: id, cwd: 'C:/p', groupId: null, statusId: null, order: 0, createdAt: 0, claudeArgs: [], ...extra }
}

function prompt(id: string, text = `do ${id}`): QueuedPrompt {
  return { id, text, addedAt: 1 }
}

let data: StoreData
let runtime: Map<Id, RuntimeState>
let listeners: ((state: RuntimeState) => void)[]
let writes: [Id, string][]
let timers: { at: number; run: () => void; done: boolean }[]
let clock: number
let errors: unknown[]
let queue: PromptQueue

function setQueue(id: Id, items: readonly QueuedPrompt[]): void {
  data = { ...data, sessions: data.sessions.map((s) => (s.id === id ? { ...s, queue: items } : s)) }
}

function emit(id: Id, patch: Partial<RuntimeState>): void {
  const next: RuntimeState = { ...(runtime.get(id) ?? { sessionId: id, run: 'running', exitCode: null, attention: null }), ...patch }
  runtime.set(id, next)
  for (const listener of listeners) listener(next)
}

function advance(ms: number): void {
  clock += ms
  for (const timer of timers) {
    if (!timer.done && timer.at <= clock) {
      timer.done = true
      timer.run()
    }
  }
}

beforeEach(() => {
  data = { version: 1, sessions: [session('a'), session('b', { agent: 'opencode' }), session('sh', { agent: 'shell' })], groups: [], statuses: [], groupOrder: [] }
  runtime = new Map()
  listeners = []
  writes = []
  timers = []
  clock = 0
  errors = []
  queue = createPromptQueue({
    getData: () => data,
    setQueue,
    getRuntime: (id) => runtime.get(id),
    subscribeRuntime: (listener) => {
      listeners.push(listener)
      return () => {
        listeners = listeners.filter((l) => l !== listener)
      }
    },
    write: (id, text) => writes.push([id, text]),
    setTimeout: (run, ms) => {
      const timer = { at: clock + ms, run, done: false }
      timers.push(timer)
      return timer as unknown as ReturnType<typeof setTimeout>
    },
    clearTimeout: (timer) => {
      ;(timer as unknown as { done: boolean }).done = true
    },
    onError: (_where, error) => errors.push(error)
  })
})

describe('createPromptQueue', () => {
  it('types the first prompt when the running turn finishes, then Enter after a pause', () => {
    emit('a', { activity: 'working' })
    setQueue('a', [prompt('1'), prompt('2')])
    queue.onQueueChanged('a')
    expect(writes).toEqual([])
    emit('a', { activity: 'finished' })
    expect(writes).toEqual([['a', 'do 1']])
    advance(QUEUE_ENTER_DELAY_MS)
    expect(writes).toEqual([['a', 'do 1'], ['a', '\r']])
    expect(data.sessions[0]?.queue?.map((p) => p.id)).toEqual(['2'])
  })

  it('sends one prompt per finished turn, in order', () => {
    setQueue('a', [prompt('1'), prompt('2')])
    emit('a', { activity: 'working' })
    emit('a', { activity: 'finished' })
    emit('a', { activity: 'working' })
    emit('a', { activity: 'finished' })
    advance(QUEUE_ENTER_DELAY_MS)
    expect(writes.filter(([, text]) => text !== '\r')).toEqual([['a', 'do 1'], ['a', 'do 2']])
    expect(data.sessions[0]?.queue).toEqual([])
  })

  it('sends at once when the session is already idle, but only one prompt until the next turn starts', () => {
    emit('a', { activity: 'finished' })
    setQueue('a', [prompt('1')])
    queue.onQueueChanged('a')
    setQueue('a', [...(data.sessions[0]?.queue ?? []), prompt('2')])
    queue.onQueueChanged('a')
    expect(writes).toEqual([['a', 'do 1']])
    emit('a', { activity: 'working' })
    emit('a', { activity: 'finished' })
    expect(writes.filter(([, text]) => text !== '\r')).toEqual([['a', 'do 1'], ['a', 'do 2']])
  })

  it('lets the next prompt go after the guard expires when no new turn was reported', () => {
    emit('a', { activity: 'finished' })
    setQueue('a', [prompt('1'), prompt('2')])
    queue.onQueueChanged('a')
    advance(QUEUE_SENT_GUARD_MS)
    queue.onQueueChanged('a')
    expect(writes.filter(([, text]) => text !== '\r').map(([, text]) => text)).toEqual(['do 1', 'do 2'])
  })

  it('never types into a sleeping, exited, closed or shell session', () => {
    setQueue('a', [prompt('1')])
    emit('a', { activity: 'finished', sleeping: true })
    emit('a', { activity: 'finished', run: 'exited', sleeping: undefined })
    data = { ...data, sessions: data.sessions.map((s) => (s.id === 'a' ? { ...s, closedAt: 5 } : s)) }
    emit('a', { run: 'running', activity: 'working' })
    emit('a', { activity: 'finished' })
    setQueue('sh', [prompt('s')])
    emit('sh', { activity: 'working' })
    emit('sh', { activity: 'finished' })
    expect(writes).toEqual([])
  })

  it('works for OpenCode sessions too', () => {
    setQueue('b', [prompt('1')])
    emit('b', { activity: 'working' })
    emit('b', { activity: 'finished' })
    expect(writes).toEqual([['b', 'do 1']])
  })

  it('does not resend on a repeated finished event', () => {
    setQueue('a', [prompt('1'), prompt('2')])
    emit('a', { activity: 'working' })
    emit('a', { activity: 'finished' })
    emit('a', { activity: 'finished', activityMessage: 'again' })
    expect(writes).toEqual([['a', 'do 1']])
  })

  it('sendNow types the chosen prompt and removes it, even while a turn runs', () => {
    emit('a', { activity: 'working' })
    setQueue('a', [prompt('1'), prompt('2')])
    queue.sendNow('a', '2')
    expect(writes).toEqual([['a', 'do 2']])
    expect(data.sessions[0]?.queue?.map((p) => p.id)).toEqual(['1'])
  })

  it('sendNow refuses a stopped session and an unknown prompt', () => {
    setQueue('a', [prompt('1')])
    expect(() => queue.sendNow('a', '1')).toThrow('not running')
    emit('a', { activity: 'working' })
    expect(() => queue.sendNow('a', 'nope')).toThrow('no longer in the queue')
    expect(writes).toEqual([])
  })

  it('normalizes line endings so only the separate Enter submits', () => {
    setQueue('a', [prompt('1', 'line one\r\nline two\rthree')])
    emit('a', { activity: 'working' })
    emit('a', { activity: 'finished' })
    expect(writes[0]).toEqual(['a', 'line one\nline two\nthree'])
  })

  it('stops listening after stop()', () => {
    queue.stop()
    setQueue('a', [prompt('1')])
    emit('a', { activity: 'working' })
    emit('a', { activity: 'finished' })
    expect(writes).toEqual([])
    expect(errors).toEqual([])
  })
})

describe('helpers', () => {
  it('canTypeInto needs an open, running, awake, non-shell session', () => {
    const running: RuntimeState = { sessionId: 'a', run: 'running', exitCode: null, attention: null }
    expect(canTypeInto(session('a'), running)).toBe(true)
    expect(canTypeInto(undefined, running)).toBe(false)
    expect(canTypeInto(session('a', { agent: 'shell' }), running)).toBe(false)
    expect(canTypeInto(session('a', { closedAt: 1 }), running)).toBe(false)
    expect(canTypeInto(session('a'), { ...running, sleeping: true })).toBe(false)
    expect(canTypeInto(session('a'), { ...running, run: 'exited' })).toBe(false)
  })

  it('queuedText turns CR and CRLF into LF', () => {
    expect(queuedText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
  })
})
