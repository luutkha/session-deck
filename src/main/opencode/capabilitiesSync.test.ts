import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawn = vi.hoisted(() => ({ result: { error: undefined, stdout: '', stderr: '' } as { error?: Error; stdout?: string; stderr?: string } }))

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(() => spawn.result),
  execFile: vi.fn()
}))

import { getOpencodeInfo, opencodeSupportsStandalone, resetOpencodeCapabilitiesForTests } from './capabilities'

beforeEach(() => {
  resetOpencodeCapabilitiesForTests()
  spawn.result = { error: undefined, stdout: '', stderr: '' }
})

describe('the synchronous fallback probe', () => {
  it('a probe that fails (timeout, CLI missing) answers true for that launch but stores NOTHING', () => {
    spawn.result = { error: new Error('spawnSync opencode ETIMEDOUT') }
    expect(opencodeSupportsStandalone()).toBe(true)
    expect(getOpencodeInfo().checkedAt).toBe(0)
  })

  it('an empty answer is not an answer either', () => {
    spawn.result = { stdout: '   ', stderr: '' }
    expect(opencodeSupportsStandalone()).toBe(true)
    expect(getOpencodeInfo().checkedAt).toBe(0)
  })

  it('a real answer is stored: an old OpenCode without --standalone stays false afterwards', () => {
    spawn.result = { stdout: 'opencode [project]\n  --model  --session', stderr: '' }
    expect(opencodeSupportsStandalone()).toBe(false)
    expect(getOpencodeInfo().checkedAt).toBeGreaterThan(0)
    // later calls use the cache (the mocked CLI would now answer differently)
    spawn.result = { stdout: 'opencode run --standalone', stderr: '' }
    expect(opencodeSupportsStandalone()).toBe(false)
  })

  it('after a failed probe the next launch tries again instead of trusting the failure', () => {
    spawn.result = { error: new Error('boom') }
    expect(opencodeSupportsStandalone()).toBe(true)
    spawn.result = { stdout: 'opencode [project]\n  --session', stderr: '' }
    expect(opencodeSupportsStandalone()).toBe(false)
  })
})
