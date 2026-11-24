import { afterEach, describe, expect, it } from 'vitest'
import {
  CURSOR_INSTALL_HINT,
  detectCursorCommand,
  resetCursorCommandCache,
  setCursorCommandRunnerForTests,
  type CursorCommand
} from './command'

// The runner seam replaces the PATH probe: these tests never spawn `where`/`command -v`.
afterEach(() => setCursorCommandRunnerForTests(null))

function installed(names: readonly CursorCommand[]): CursorCommand[] {
  const calls: CursorCommand[] = []
  setCursorCommandRunnerForTests((command) => {
    calls.push(command)
    return names.includes(command)
  })
  return calls
}

describe('detectCursorCommand', () => {
  it('prefers cursor-agent over agent', () => {
    installed(['cursor-agent', 'agent'])
    expect(detectCursorCommand()).toBe('cursor-agent')
  })

  it('falls back to agent when cursor-agent is missing', () => {
    installed(['agent'])
    expect(detectCursorCommand()).toBe('agent')
  })

  it('returns null when neither binary is installed', () => {
    installed([])
    expect(detectCursorCommand()).toBeNull()
  })

  it('caches the answer: a session start probes PATH only once', () => {
    const calls = installed(['cursor-agent'])
    expect(detectCursorCommand()).toBe('cursor-agent')
    expect(detectCursorCommand()).toBe('cursor-agent')
    expect(calls).toEqual(['cursor-agent'])
  })

  it('resetCursorCommandCache() probes again (e.g. after an install)', () => {
    const calls = installed([])
    expect(detectCursorCommand()).toBeNull()
    resetCursorCommandCache()
    expect(detectCursorCommand()).toBeNull()
    expect(calls).toEqual(['cursor-agent', 'agent', 'cursor-agent', 'agent'])
  })

  it('the install hint names the platform installer', () => {
    expect(CURSOR_INSTALL_HINT).toContain(process.platform === 'win32' ? 'irm' : 'curl')
    expect(CURSOR_INSTALL_HINT).toContain('cursor.com/install')
  })
})
