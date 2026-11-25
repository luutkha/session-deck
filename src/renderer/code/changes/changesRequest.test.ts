import { describe, expect, it, vi } from 'vitest'
import {
  requestChangesFile,
  requestChangesLayout,
  requestChangesStep,
  subscribeChangesFileRequest,
  subscribeChangesLayoutRequest,
  subscribeChangesStepRequest,
  takeChangesFileRequest,
  takeChangesLayoutRequest,
  takeChangesStepRequest
} from './changesRequest'

describe('changesRequest (D58/G9)', () => {
  it('hands a step to the worktree that asked for it, once', () => {
    takeChangesStepRequest('w1')
    const listener = vi.fn()
    const unsubscribe = subscribeChangesStepRequest(listener)
    requestChangesStep('w1', 1)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(takeChangesStepRequest('w2')).toBeNull()
    expect(takeChangesStepRequest('w1')).toBe(1)
    expect(takeChangesStepRequest('w1')).toBeNull()
    unsubscribe()
    requestChangesStep('w1', -1)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(takeChangesStepRequest('w1')).toBe(-1)
  })

  it('keeps only the layout fields that were given', () => {
    takeChangesLayoutRequest('w1')
    const listener = vi.fn()
    const unsubscribe = subscribeChangesLayoutRequest(listener)
    requestChangesLayout('w1', { tree: true })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(takeChangesLayoutRequest('w1')).toEqual({ worktreeId: 'w1', tree: true })
    expect(takeChangesLayoutRequest('w1')).toBeNull()
    requestChangesLayout('w1', { sideBySide: false })
    expect(takeChangesLayoutRequest('w1')).toEqual({ worktreeId: 'w1', sideBySide: false })
    requestChangesLayout('w1', { tree: false, sideBySide: true })
    expect(takeChangesLayoutRequest('w1')).toEqual({ worktreeId: 'w1', tree: false, sideBySide: true })
    expect(takeChangesLayoutRequest('w2')).toBeNull()
    unsubscribe()
  })

  it('keeps file, step and layout requests separate', () => {
    takeChangesFileRequest('w1')
    takeChangesStepRequest('w1')
    takeChangesLayoutRequest('w1')
    requestChangesFile({ worktreeId: 'w1', path: 'src/a.ts', view: 'diff' })
    requestChangesStep('w1', -1)
    requestChangesLayout('w1', { tree: true })
    expect(takeChangesFileRequest('w1')).toEqual({ worktreeId: 'w1', path: 'src/a.ts', view: 'diff' })
    expect(takeChangesStepRequest('w1')).toBe(-1)
    expect(takeChangesLayoutRequest('w1')).toEqual({ worktreeId: 'w1', tree: true })
  })

  it('still notifies file request listeners (D58)', () => {
    takeChangesFileRequest('w1')
    const listener = vi.fn()
    const unsubscribe = subscribeChangesFileRequest(listener)
    requestChangesFile({ worktreeId: 'w1', path: null, view: 'diff' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(takeChangesFileRequest('w1')).toEqual({ worktreeId: 'w1', path: null, view: 'diff' })
    unsubscribe()
  })
})
