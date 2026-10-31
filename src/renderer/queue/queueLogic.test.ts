import { describe, expect, it } from 'vitest'
import { QUEUE_MAX_ITEMS, QUEUE_TEXT_MAX, type QueuedPrompt, type RuntimeState, type Session } from '../../shared/types'
import { addPrompt, broadcastPlan, broadcastTargets, movePromptUp, queueState, removePrompt } from './queueLogic'

const p = (id: string): QueuedPrompt => ({ id, text: id, addedAt: 0 })
const session = (extra: Partial<Session> = {}): Session => ({
  id: 's', name: 's', cwd: 'C:/p', groupId: null, statusId: null, order: 0, createdAt: 0, claudeArgs: [], ...extra
})
const running = (extra: Partial<RuntimeState> = {}): RuntimeState => ({ sessionId: 's', run: 'running', exitCode: null, attention: null, ...extra })

describe('addPrompt', () => {
  it('appends the trimmed text', () => {
    expect(addPrompt([p('a')], '  next  ', 'b', 7)).toEqual([p('a'), { id: 'b', text: 'next', addedAt: 7 }])
  })

  it('ignores blank, too long, or a full queue', () => {
    const queue = [p('a')]
    expect(addPrompt(queue, '   ', 'b', 0)).toBe(queue)
    expect(addPrompt(queue, 'x'.repeat(QUEUE_TEXT_MAX + 1), 'b', 0)).toBe(queue)
    const full = Array.from({ length: QUEUE_MAX_ITEMS }, (_, i) => p(`p${i}`))
    expect(addPrompt(full, 'more', 'b', 0)).toBe(full)
  })
})

describe('removePrompt / movePromptUp', () => {
  it('removes by id', () => {
    expect(removePrompt([p('a'), p('b')], 'a')).toEqual([p('b')])
  })

  it('moves an item one place earlier and leaves the first alone', () => {
    expect(movePromptUp([p('a'), p('b'), p('c')], 'c')).toEqual([p('a'), p('c'), p('b')])
    const queue = [p('a'), p('b')]
    expect(movePromptUp(queue, 'a')).toBe(queue)
    expect(movePromptUp(queue, 'zz')).toBe(queue)
  })
})

describe('queueState', () => {
  it('tells shell, stopped, busy and idle apart', () => {
    expect(queueState(session({ agent: 'shell' }), running({ activity: 'finished' }))).toBe('shell')
    expect(queueState(session(), undefined)).toBe('stopped')
    expect(queueState(session(), running({ sleeping: true }))).toBe('stopped')
    expect(queueState(session({ closedAt: 1 }), running())).toBe('stopped')
    expect(queueState(session(), running({ activity: 'working' }))).toBe('busy')
    expect(queueState(session(), running({ activity: null }))).toBe('busy')
    expect(queueState(session(), running({ activity: 'finished' }))).toBe('idle')
  })
})

describe('broadcastPlan / broadcastTargets (D48)', () => {
  it('splits a selection into now, later, not running and skipped, keeping selection order for targets', () => {
    const sessions: Session[] = [
      session({ id: 'idle' }),
      session({ id: 'busy' }),
      session({ id: 'asleep' }),
      session({ id: 'sh', agent: 'shell' }),
      session({ id: 'full', queue: Array.from({ length: QUEUE_MAX_ITEMS }, (_, i) => p(`f${i}`)) })
    ]
    const runtime = new Map<string, RuntimeState>([
      ['idle', running({ sessionId: 'idle', activity: 'finished' })],
      ['busy', running({ sessionId: 'busy', activity: 'working' })],
      ['asleep', running({ sessionId: 'asleep', sleeping: true })],
      ['sh', running({ sessionId: 'sh', activity: 'finished' })],
      ['full', running({ sessionId: 'full', activity: 'finished' })]
    ])
    const ids = ['busy', 'sh', 'idle', 'full', 'asleep', 'gone']
    const plan = broadcastPlan(ids, sessions, runtime)
    expect(plan).toEqual({ now: ['idle'], later: ['busy'], stopped: ['asleep'], skipped: ['sh', 'full'] })
    expect(broadcastTargets(plan, ids)).toEqual(['busy', 'idle', 'asleep'])
  })
})
