import { spawnSync } from 'node:child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getOpencodeInfo,
  opencodeSupportsStandalone,
  parseOpencodeVersion,
  parseSupportsStandalone,
  probeOpencode,
  recheckOpencode,
  resetOpencodeCapabilitiesForTests,
  setOpencodeRunnerForTests,
  setOpencodeSupportsStandaloneForTests,
  warmOpencodeProbe
} from './capabilities'

// No probe may touch the real CLI from a unit test: the async runner is injected, and a sync spawn fails loudly.
vi.mock('node:child_process', () => ({
  spawnSync: vi.fn((): never => {
    throw new Error('spawnSync must not run in tests')
  }),
  execFile: vi.fn((): never => {
    throw new Error('execFile must not run in tests')
  })
}))

// Help output shapes, trimmed to the lines that matter (the probe itself is injected and never spawned in tests).
const HELP_V2 = `opencode [project]

Commands:
  opencode [project]                                  start the TUI

Options:
  -s, --session <id>                                  resume a session
      --standalone                                    use a private server for this process
  -h, --help                                          show help
`

const HELP_V1 = `opencode [project]

Options:
  -s, --session <id>                                  resume a session
  -h, --help                                          show help
`

beforeEach((): void => resetOpencodeCapabilitiesForTests())

describe('parseSupportsStandalone', () => {
  it('finds the flag in v2.x help text', () => {
    expect(parseSupportsStandalone(HELP_V2)).toBe(true)
  })
  it('reports no support for v1-style help without the flag', () => {
    expect(parseSupportsStandalone(HELP_V1)).toBe(false)
  })
  it('reports no support for empty help text', () => {
    expect(parseSupportsStandalone('')).toBe(false)
  })
})

describe('parseOpencodeVersion', () => {
  it('reads a plain version line', () => {
    expect(parseOpencodeVersion('opencode 2.1.4\n')).toBe('2.1.4')
  })
  it('accepts a leading v and a prerelease suffix', () => {
    expect(parseOpencodeVersion('v1.4.0-beta.2')).toBe('1.4.0-beta.2')
  })
  it('does not swallow a trailing sentence dot', () => {
    expect(parseOpencodeVersion('1.4.0-beta.2.')).toBe('1.4.0-beta.2')
    expect(parseOpencodeVersion('opencode 2.1.4.')).toBe('2.1.4')
  })
  it('skips noise before the version token', () => {
    expect(parseOpencodeVersion('warning: update available (0.9.0)\nopencode 2.1.4')).toBe('0.9.0')
  })
  it('returns null without a three-part version', () => {
    expect(parseOpencodeVersion('opencode 2.1')).toBeNull()
    expect(parseOpencodeVersion('no version here')).toBeNull()
  })
  it('returns null for empty output', () => {
    expect(parseOpencodeVersion('')).toBeNull()
  })
})

describe('probeOpencode', () => {
  it('fills the cache with the version and the flag support', async () => {
    setOpencodeRunnerForTests(async (arg): Promise<string | null> => (arg === '--help' ? HELP_V2 : 'opencode 2.1.4\n'))
    expect(getOpencodeInfo()).toEqual({ supportsStandalone: true, version: null, checkedAt: 0, probing: false })

    const info = await probeOpencode()

    expect(info.supportsStandalone).toBe(true)
    expect(info.version).toBe('2.1.4')
    expect(info.checkedAt).toBeGreaterThan(0)
    expect(info.probing).toBe(false)
    expect(getOpencodeInfo()).toEqual(info)
  })

  it('shares one in-flight probe between concurrent calls', async () => {
    let calls = 0
    let release: () => void = (): void => undefined
    const gate = new Promise<void>((resolve): void => {
      release = resolve
    })
    setOpencodeRunnerForTests(async (arg): Promise<string | null> => {
      calls += 1
      await gate
      return arg === '--help' ? HELP_V2 : '2.1.4'
    })

    const first = probeOpencode()
    const second = probeOpencode()
    expect(second).toBe(first)
    expect(getOpencodeInfo().probing).toBe(true)

    release()
    const [a, b] = await Promise.all([first, second])

    expect(a).toBe(b)
    expect(calls).toBe(2)
    expect(getOpencodeInfo().probing).toBe(false)
  })

  it('keeps --standalone and no version when the probe cannot run', async () => {
    setOpencodeRunnerForTests(async (): Promise<string | null> => null)

    const info = await probeOpencode()

    expect(info.supportsStandalone).toBe(true)
    expect(info.version).toBeNull()
    expect(info.probing).toBe(false)
    expect(info.checkedAt).toBeGreaterThan(0)
  })

  it('keeps --standalone when help runs but prints nothing', async () => {
    setOpencodeRunnerForTests(async (arg): Promise<string | null> => (arg === '--help' ? '' : null))
    expect((await probeOpencode()).supportsStandalone).toBe(true)
  })

  it('reports no support for v1 help', async () => {
    setOpencodeRunnerForTests(async (arg): Promise<string | null> => (arg === '--help' ? HELP_V1 : 'v1.4.0'))
    const info = await probeOpencode()
    expect(info.supportsStandalone).toBe(false)
    expect(info.version).toBe('1.4.0')
  })
})

describe('getOpencodeInfo', () => {
  it('never starts a probe by itself', () => {
    let calls = 0
    setOpencodeRunnerForTests(async (): Promise<string | null> => {
      calls += 1
      return HELP_V2
    })

    const info = getOpencodeInfo()

    expect(info).toEqual({ supportsStandalone: true, version: null, checkedAt: 0, probing: false })
    expect(calls).toBe(0)
  })
})

describe('recheckOpencode', () => {
  it('clears the cached answer and probes again', async () => {
    let help = HELP_V1
    let sawClearedCache = false
    setOpencodeRunnerForTests(async (arg): Promise<string | null> => {
      if (getOpencodeInfo().checkedAt === 0) sawClearedCache = true
      return arg === '--help' ? help : '1.4.0'
    })
    await probeOpencode()
    sawClearedCache = false

    help = HELP_V2
    const info = await recheckOpencode()

    expect(sawClearedCache).toBe(true)
    expect(info.supportsStandalone).toBe(true)
    expect(info.version).toBe('1.4.0')
    expect(getOpencodeInfo().checkedAt).toBe(info.checkedAt)
  })

  it('hands back the same in-flight probe when one is running', async () => {
    let release: () => void = (): void => undefined
    const gate = new Promise<void>((resolve): void => {
      release = resolve
    })
    setOpencodeRunnerForTests(async (arg): Promise<string | null> => {
      await gate
      return arg === '--help' ? HELP_V2 : '2.1.4'
    })

    const first = probeOpencode()
    const second = recheckOpencode()
    expect(second).toBe(first)

    release()
    await Promise.all([first, second])
    expect(getOpencodeInfo().version).toBe('2.1.4')
  })
})

describe('opencodeSupportsStandalone', () => {
  it('answers from the cache after a probe and does not spawn again', async () => {
    // A v1 answer: the synchronous path must return the cached false instead of probing the real CLI (v2 here).
    let calls = 0
    setOpencodeRunnerForTests(async (arg): Promise<string | null> => {
      calls += 1
      return arg === '--help' ? HELP_V1 : '1.4.0'
    })
    await probeOpencode()
    const callsAfterProbe = calls

    expect(opencodeSupportsStandalone()).toBe(false)
    expect(opencodeSupportsStandalone()).toBe(false)
    expect(calls).toBe(callsAfterProbe)
    expect(vi.mocked(spawnSync)).not.toHaveBeenCalled()
  })

  it('prefers a forced test result and still does not spawn', () => {
    setOpencodeSupportsStandaloneForTests(false)
    expect(opencodeSupportsStandalone()).toBe(false)
    setOpencodeSupportsStandaloneForTests(undefined)
  })
})

describe('warmOpencodeProbe', () => {
  it('starts a probe without throwing and shares it with later callers', async () => {
    let calls = 0
    setOpencodeRunnerForTests(async (arg): Promise<string | null> => {
      calls += 1
      return arg === '--help' ? HELP_V2 : '2.1.4'
    })

    expect((): void => warmOpencodeProbe()).not.toThrow()
    const info = await probeOpencode()

    expect(info.version).toBe('2.1.4')
    expect(calls).toBe(2)
  })
})
