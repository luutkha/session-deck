import { describe, it, expect, beforeEach } from 'vitest'
import { createRuntimeRegistry, type RuntimeRegistry } from './runtimeRegistry'
import type { RuntimeState } from '../../shared/types'

describe('runtimeRegistry sleeping', () => {
  let registry: RuntimeRegistry

  beforeEach(() => {
    registry = createRuntimeRegistry()
  })

  it('markSleeping sets run=exited with a null code and sleeping true', () => {
    registry.markRunning('s1')

    registry.markSleeping('s1')

    const state = registry.get('s1')!
    expect(state.run).toBe('exited')
    expect(state.exitCode).toBeNull()
    expect(state.sleeping).toBe(true)
  })

  it('markSleeping keeps the attention reason and its time', () => {
    let clock = 1000
    registry = createRuntimeRegistry(() => clock)
    registry.markRunning('s1')
    registry.setAttention('s1', 'done')
    const raisedAt = registry.get('s1')!.attentionAt
    clock = 5000

    registry.markSleeping('s1')

    const state = registry.get('s1')!
    expect(state.attention).toBe('done')
    expect(state.attentionAt).toBe(raisedAt)
  })

  it('markSleeping keeps a permission bell', () => {
    registry.markRunning('s1')
    registry.setAttention('s1', 'permission')

    registry.markSleeping('s1')

    expect(registry.get('s1')!.attention).toBe('permission')
  })

  it('markSleeping with no bell leaves attention null', () => {
    registry.markRunning('s1')

    registry.markSleeping('s1')

    expect(registry.get('s1')!.attention).toBeNull()
  })

  it('markRunning after sleep keeps the bell until the user clears it', () => {
    registry.markRunning('s1')
    registry.setAttention('s1', 'done')
    registry.markSleeping('s1')

    registry.markRunning('s1')

    expect(registry.get('s1')!.attention).toBe('done')
  })

  it('setAttention null after sleep clears the bell and its time', () => {
    registry.markRunning('s1')
    registry.setAttention('s1', 'done')
    registry.markSleeping('s1')

    registry.setAttention('s1', null)

    const state = registry.get('s1')!
    expect(state.attention).toBeNull()
    expect(state).not.toHaveProperty('attentionAt')
  })

  it('markSleeping clears activity', () => {
    registry.markRunning('s1')
    registry.setAttention('s1', 'permission')
    registry.setActivity('s1', 'needs-input', 'Allow write?', 100)

    registry.markSleeping('s1')

    const state = registry.get('s1')!
    expect(state.activity).toBeNull()
    expect(state.activityMessage).toBeNull()
    expect(state).not.toHaveProperty('activityAt')
  })

  it('markSleeping on an unknown session creates the state', () => {
    registry.markSleeping('ghost')
    expect(registry.get('ghost')?.sleeping).toBe(true)
  })

  it('markRunning clears sleeping (the field is omitted, not set to false)', () => {
    registry.markRunning('s1')
    registry.markSleeping('s1')

    registry.markRunning('s1')

    const state = registry.get('s1')!
    expect(state.run).toBe('running')
    expect(state).not.toHaveProperty('sleeping')
  })

  it('markExited clears sleeping after a real exit', () => {
    registry.markRunning('s1')
    registry.markSleeping('s1')

    registry.markExited('s1', 0)

    const state = registry.get('s1')!
    expect(state).not.toHaveProperty('sleeping')
  })

  it('does not carry sleeping on a freshly created session', () => {
    registry.markExited('s1', 1)
    expect(registry.get('s1')).not.toHaveProperty('sleeping')
  })

  it('emits the sleeping state to subscribers', () => {
    const emitted: RuntimeState[] = []
    registry.subscribe((s) => emitted.push(s))
    registry.markRunning('s1')
    registry.markSleeping('s1')

    expect(emitted.at(-1)?.sleeping).toBe(true)
  })
})
