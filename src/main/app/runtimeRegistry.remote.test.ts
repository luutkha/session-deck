import { describe, it, expect, beforeEach } from 'vitest'
import { createRuntimeRegistry, type RuntimeRegistry } from './runtimeRegistry'
import type { RuntimeState } from '../../shared/types'

describe('runtimeRegistry remote control', () => {
  let registry: RuntimeRegistry
  let emitted: RuntimeState[]

  beforeEach(() => {
    registry = createRuntimeRegistry()
    emitted = []
    registry.markRunning('s1')
    registry.subscribe((state) => emitted.push(state))
  })

  it('setRemoteControl marks the running session once and stays quiet when unchanged', () => {
    registry.setRemoteControl('s1', true)
    registry.setRemoteControl('s1', true)

    expect(registry.get('s1')?.remoteControl).toBe(true)
    expect(emitted).toHaveLength(1)
  })

  it('setRemoteControl false removes the field', () => {
    registry.setRemoteControl('s1', true)
    registry.setRemoteControl('s1', false)

    expect(registry.get('s1')).not.toHaveProperty('remoteControl')
  })

  it('a restart, an exit and a sleep each end Remote Control', () => {
    registry.setRemoteControl('s1', true)
    registry.markSleeping('s1')
    expect(registry.get('s1')).not.toHaveProperty('remoteControl')

    registry.markRunning('s1')
    registry.setRemoteControl('s1', true)
    registry.markExited('s1', 0)
    expect(registry.get('s1')).not.toHaveProperty('remoteControl')
  })
})
