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

  it('markSleeping clears attention and activity', () => {
    registry.markRunning('s1')
    registry.setAttention('s1', 'permission')
    registry.setActivity('s1', 'needs-input', 'Allow write?', 100)

    registry.markSleeping('s1')

    const state = registry.get('s1')!
    expect(state.attention).toBeNull()
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
