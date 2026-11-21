import { describe, it, expect, beforeEach } from 'vitest'
import { createRuntimeRegistry, type RuntimeRegistry } from './runtimeRegistry'
import type { RuntimeState, SessionRun, AttentionReason } from '../../shared/types'

function assertState(
  state: RuntimeState,
  expected: { run: SessionRun; exitCode: number | null; attention: AttentionReason | null }
): void {
  expect(state.run).toBe(expected.run)
  expect(state.exitCode).toBe(expected.exitCode)
  expect(state.attention).toBe(expected.attention)
}

describe('runtimeRegistry', () => {
  let registry: RuntimeRegistry

  beforeEach(() => {
    registry = createRuntimeRegistry()
  })

  it('initial state for unknown session is exited with null exitCode and null attention', () => {
    const snap = registry.snapshot()
    const state = snap.find((s) => s.sessionId === 'unknown')
    expect(state).toBeUndefined()
    // getOrCreate is internal; snapshot only returns known sessions
    // but markRunning on new id creates it
    registry.markRunning('s1')
    const s1 = registry.snapshot().find((s) => s.sessionId === 's1')!
    assertState(s1, { run: 'running', exitCode: null, attention: null })
  })

  it('markRunning sets run=running and clears exitCode', () => {
    registry.markRunning('s1')
    registry.markExited('s1', 0)
    registry.markRunning('s1')
    const state = registry.snapshot().find((s) => s.sessionId === 's1')!
    assertState(state, { run: 'running', exitCode: null, attention: null })
  })

  it('markExited sets run=exited with given code', () => {
    registry.markRunning('s1')
    registry.markExited('s1', 130)
    const state = registry.snapshot().find((s) => s.sessionId === 's1')!
    assertState(state, { run: 'exited', exitCode: 130, attention: null })
  })

  it('markExited with null code preserves attention', () => {
    registry.markRunning('s1')
    registry.setAttention('s1', 'idle')
    registry.markExited('s1', null)
    const state = registry.snapshot().find((s) => s.sessionId === 's1')!
    assertState(state, { run: 'exited', exitCode: null, attention: 'idle' })
  })

  it('setAttention updates attention reason', () => {
    registry.markRunning('s1')
    registry.setAttention('s1', 'permission')
    let state = registry.snapshot().find((s) => s.sessionId === 's1')!
    assertState(state, { run: 'running', exitCode: null, attention: 'permission' })

    registry.setAttention('s1', 'done')
    state = registry.snapshot().find((s) => s.sessionId === 's1')!
    assertState(state, { run: 'running', exitCode: null, attention: 'done' })

    registry.setAttention('s1', null)
    state = registry.snapshot().find((s) => s.sessionId === 's1')!
    assertState(state, { run: 'running', exitCode: null, attention: null })
  })

  it('setAttention with same reason does not emit', () => {
    let emissions = 0
    const unsub = registry.subscribe(() => {
      emissions++
    })
    registry.markRunning('s1')
    registry.setAttention('s1', 'idle')
    registry.setAttention('s1', 'idle')
    expect(emissions).toBe(2) // markRunning + first setAttention
    unsub()
  })

  it('forget removes session and emits initial state', () => {
    registry.markRunning('s1')
    registry.setAttention('s1', 'done')
    registry.forget('s1')
    const snap = registry.snapshot()
    expect(snap.find((s) => s.sessionId === 's1')).toBeUndefined()

    // subscribe and check initial state emitted
    let emitted: RuntimeState | null = null
    const unsub = registry.subscribe((s) => {
      emitted = s
    })
    registry.forget('s2') // never existed
    expect(emitted).toEqual({
      sessionId: 's2',
      run: 'exited',
      exitCode: null,
      attention: null
    })
    unsub()
  })

  it('snapshot returns all known sessions', () => {
    registry.markRunning('s1')
    registry.markRunning('s2')
    registry.markExited('s3', 0)
    const snap = registry.snapshot()
    expect(snap.length).toBe(3)
    const ids = snap.map((s) => s.sessionId).sort()
    expect(ids).toEqual(['s1', 's2', 's3'])
  })

  it('subscribe receives all emissions', () => {
    const received: RuntimeState[] = []
    const unsub = registry.subscribe((s) => received.push(s))
    registry.markRunning('s1')
    registry.setAttention('s1', 'bell')
    registry.markExited('s1', 0)
    unsub()
    expect(received.length).toBe(3)
    expect(received[0].run).toBe('running')
    expect(received[1].attention).toBe('bell')
    expect(received[2].run).toBe('exited')
  })

  it('unsubscribe stops receiving emissions', () => {
    const received: RuntimeState[] = []
    const unsub = registry.subscribe((s) => received.push(s))
    registry.markRunning('s1')
    unsub()
    registry.markExited('s1', 0)
    expect(received.length).toBe(1)
  })

  it('multiple subscribers all receive emissions', () => {
    const r1: RuntimeState[] = []
    const r2: RuntimeState[] = []
    const unsub1 = registry.subscribe((s) => r1.push(s))
    const unsub2 = registry.subscribe((s) => r2.push(s))
    registry.markRunning('s1')
    unsub1()
    registry.markExited('s1', 0)
    expect(r1.length).toBe(1)
    expect(r2.length).toBe(2)
    unsub2()
  })

  it('stamps attentionAt when attention is raised and drops it when cleared', () => {
    let clock = 500
    const timed = createRuntimeRegistry(() => clock)
    timed.markRunning('s1')
    timed.setAttention('s1', 'done')
    expect(timed.get('s1')?.attentionAt).toBe(500)
    clock = 900
    timed.setAttention('s1', 'permission')
    expect(timed.get('s1')?.attentionAt).toBe(900)
    timed.setAttention('s1', null)
    expect(timed.get('s1')?.attention).toBeNull()
    expect(timed.get('s1')).not.toHaveProperty('attentionAt')
  })

  it('D79: setOpencodePlugin records the health, emits once, and a restart starts unknown', () => {
    let emissions = 0
    registry.subscribe(() => {
      emissions++
    })
    registry.markRunning('s1')
    registry.setOpencodePlugin('s1', 'missing')
    expect(registry.get('s1')?.opencodePlugin).toBe('missing')
    expect(emissions).toBe(2)
    registry.setOpencodePlugin('s1', 'missing')
    expect(emissions).toBe(2)

    registry.markRunning('s1')
    expect(registry.get('s1')).not.toHaveProperty('opencodePlugin')
    registry.setOpencodePlugin('s1', 'ok')
    expect(registry.get('s1')?.opencodePlugin).toBe('ok')
  })
})
