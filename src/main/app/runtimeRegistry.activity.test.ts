import { describe, it, expect, beforeEach } from 'vitest'
import { createRuntimeRegistry, type RuntimeRegistry } from './runtimeRegistry'
import type { RuntimeState } from '../../shared/types'

describe('runtimeRegistry activity', () => {
  let registry: RuntimeRegistry

  beforeEach(() => {
    registry = createRuntimeRegistry()
  })

  it('setActivity stores activity, message and time, and emits the full state', () => {
    const emitted: RuntimeState[] = []
    registry.subscribe((s) => emitted.push(s))
    registry.markRunning('s1')

    registry.setActivity('s1', 'needs-input', 'Allow write?', 1000)

    const state = registry.get('s1')!
    expect(state.activity).toBe('needs-input')
    expect(state.activityMessage).toBe('Allow write?')
    expect(state.activityAt).toBe(1000)
    expect(emitted[emitted.length - 1]).toEqual(state)
  })

  it('setActivity keeps run, exitCode and attention untouched', () => {
    registry.markRunning('s1')
    registry.setAttention('s1', 'done')
    registry.setActivity('s1', 'finished', null, 5)
    const state = registry.get('s1')!
    expect(state.run).toBe('running')
    expect(state.exitCode).toBeNull()
    expect(state.attention).toBe('done')
  })

  it('markExited resets activity to null (message and time cleared)', () => {
    registry.markRunning('s1')
    registry.setActivity('s1', 'working', null, 1)
    registry.markExited('s1', 0)
    const state = registry.get('s1')!
    expect(state.activity).toBeNull()
    expect(state.activityMessage).toBeNull()
    expect(state).not.toHaveProperty('activityAt')
  })

  it('markRunning (restart) resets activity to null', () => {
    registry.markRunning('s1')
    registry.setActivity('s1', 'needs-input', 'x', 1)
    registry.markRunning('s1')
    const state = registry.get('s1')!
    expect(state.activity).toBeNull()
    expect(state.activityMessage).toBeNull()
    expect(state).not.toHaveProperty('activityAt')
  })

  it('forget drops the activity with the session', () => {
    registry.markRunning('s1')
    registry.setActivity('s1', 'working', null, 1)
    registry.forget('s1')
    expect(registry.get('s1')).toBeUndefined()
  })

  it('get returns undefined for an unknown session', () => {
    expect(registry.get('nobody')).toBeUndefined()
  })
})
