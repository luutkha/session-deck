import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileDiff, WorktreeChanges } from '../../../shared/types'
import {
  CHANGES_LOAD_FAILED,
  DIFF_LOAD_FAILED,
  createRequestGate,
  isVisibleState,
  keepNewest,
  loadChanges,
  loadFileDiff,
  subscribeSafely
} from './changesLoad'

function snapshot(worktreeId: string, computedAt: number): WorktreeChanges {
  return { worktreeId, files: [], truncated: false, additions: 0, deletions: 0, computedAt }
}

function fileDiff(path: string): FileDiff {
  return { worktreeId: 'w1', path, diff: '', binary: false, truncated: false }
}

describe('loadChanges', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the changes when the IPC resolves', async () => {
    const result = await loadChanges('w1', async () => snapshot('w1', 5))
    expect(result).toEqual({ ok: true, value: snapshot('w1', 5) })
  })

  it('returns a short message and logs the cause when the IPC rejects, without throwing', async () => {
    const cause = new Error('boom')
    const result = await loadChanges('w1', async () => {
      throw cause
    })
    expect(result).toEqual({ ok: false, error: CHANGES_LOAD_FAILED })
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('w1'), cause)
  })
})

describe('loadFileDiff', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the diff when the IPC resolves', async () => {
    const result = await loadFileDiff('w1', 'a.ts', async () => fileDiff('a.ts'))
    expect(result).toEqual({ ok: true, value: fileDiff('a.ts') })
  })

  it('reports a rejected path (no longer changed) as a short message, without throwing', async () => {
    const result = await loadFileDiff('w1', 'gone.ts', async () => {
      throw new Error('not in list')
    })
    expect(result).toEqual({ ok: false, error: DIFF_LOAD_FAILED })
  })
})

describe('createRequestGate', () => {
  it('accepts the newest request only', () => {
    const gate = createRequestGate()
    const first = gate.begin()
    const second = gate.begin()
    expect(gate.isCurrent(first)).toBe(false)
    expect(gate.isCurrent(second)).toBe(true)
  })

  it('makes every outstanding request stale after cancel', () => {
    const gate = createRequestGate()
    const pending = gate.begin()
    gate.cancel()
    expect(gate.isCurrent(pending)).toBe(false)
  })

  it('accepts a request begun after a cancel', () => {
    const gate = createRequestGate()
    gate.begin()
    gate.cancel()
    const next = gate.begin()
    expect(gate.isCurrent(next)).toBe(true)
  })
})

describe('keepNewest', () => {
  it('returns the incoming snapshot when there is no current one', () => {
    expect(keepNewest(null, snapshot('w1', 2))).toEqual(snapshot('w1', 2))
  })

  it('keeps a newer current snapshot over an older incoming reply', () => {
    const current = snapshot('w1', 9)
    expect(keepNewest(current, snapshot('w1', 4))).toBe(current)
  })

  it('takes a newer incoming snapshot over the current one', () => {
    const incoming = snapshot('w1', 9)
    expect(keepNewest(snapshot('w1', 4), incoming)).toBe(incoming)
  })
})

describe('subscribeSafely', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the unsubscribe function of a working subscription', () => {
    const unsubscribe = vi.fn()
    const stop = subscribeSafely(() => unsubscribe)
    expect(unsubscribe).not.toHaveBeenCalled()
    stop()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('returns a no-op unsubscribe and logs when subscribing throws', () => {
    const unsubscribe = subscribeSafely(() => {
      throw new Error('no bridge')
    })
    expect(() => unsubscribe()).not.toThrow()
    expect(console.error).toHaveBeenCalled()
  })
})

describe('isVisibleState', () => {
  it('polls only while the document is visible', () => {
    expect(isVisibleState('visible')).toBe(true)
    expect(isVisibleState('hidden')).toBe(false)
  })
})
