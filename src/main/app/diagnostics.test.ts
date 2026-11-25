import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createDiagnostics,
  DEFAULT_PROBE_TIMEOUT_MS,
  DIAGNOSTIC_TOOLS,
  errorLogPath,
  MAX_LOG_LINE_CHARS,
  MAX_LOG_TAIL_LINES,
  redactLine
} from './diagnostics'
import type { DiagnosticsDeps } from './diagnostics'
import { MAIN_ERROR_LOG_FILE } from './errorLog'

const HOME = 'C:\\Users\\Alice'
const USER_DATA = `${HOME}\\AppData\\Roaming\\SessionDeck`
const WORKTREES = `${HOME}\\SessionDeck\\worktrees`
const APP_INFO = {
  version: '1.2.3',
  electron: '31.0.0',
  chrome: '126.0.0',
  node: '20.11.0',
  platform: 'win32',
  arch: 'x64'
}

function makeDeps(overrides: Partial<DiagnosticsDeps> = {}): DiagnosticsDeps {
  return {
    appInfo: APP_INFO,
    probeTool: async (name) => ({ path: `C:\\tools\\${name}.exe`, version: `${name} 1.0.0` }),
    dirs: [
      { name: 'userData', path: USER_DATA },
      { name: 'worktrees', path: WORKTREES },
      { name: 'claude', path: `${HOME}\\.claude` },
      { name: 'cursor', path: `${HOME}\\.cursor` }
    ],
    pathExists: (path) => path === USER_DATA || path === `${HOME}\\.claude`,
    readLogTail: () => ['[info] session started', '[warn] slow tool'],
    now: () => 1_700_000_000_000,
    homeDir: HOME,
    ...overrides
  }
}

describe('createDiagnostics: tools', () => {
  it('reports every tool found, in the constant order', async () => {
    const report = await createDiagnostics(makeDeps())()
    expect(report.tools.map((tool) => tool.name)).toEqual([...DIAGNOSTIC_TOOLS])
    expect(report.tools.every((tool) => tool.found)).toBe(true)
    expect(report.tools[0]).toEqual({
      name: 'claude',
      found: true,
      path: 'C:\\tools\\claude.exe',
      version: 'claude 1.0.0'
    })
    expect(DIAGNOSTIC_TOOLS).toEqual(['claude', 'opencode', 'cursor-agent', 'git', 'gh', 'node'])
  })

  it('reports empty probe results as not found', async () => {
    const report = await createDiagnostics(makeDeps({ probeTool: async () => ({}) }))()
    expect(report.tools).toEqual(DIAGNOSTIC_TOOLS.map((name) => ({ name, found: false })))
  })

  it('accepts a path or a version on its own, and rejects blank fields', async () => {
    const report = await createDiagnostics(
      makeDeps({
        probeTool: async (name) =>
          name === 'claude'
            ? { path: '/usr/local/bin/claude' }
            : name === 'opencode'
              ? { version: 'opencode 0.2.1' }
              : { path: '   ', version: '' }
      })
    )()
    expect(report.tools[0]).toEqual({ name: 'claude', found: true, path: '/usr/local/bin/claude' })
    expect(report.tools[1]).toEqual({ name: 'opencode', found: true, version: 'opencode 0.2.1' })
    expect(report.tools[2]).toEqual({ name: 'cursor-agent', found: false })
  })

  it('a probe that throws becomes found:false and does not reject the report', async () => {
    const report = await createDiagnostics(
      makeDeps({
        probeTool: async (name) => {
          if (name === 'git') throw new Error('probe crashed')
          return { path: `/bin/${name}` }
        }
      })
    )()
    expect(report.tools.find((tool) => tool.name === 'git')).toEqual({ name: 'git', found: false })
    expect(report.tools.filter((tool) => tool.found)).toHaveLength(DIAGNOSTIC_TOOLS.length - 1)
  })

  it('a slow probe times out with the injected timeout', async () => {
    const never = (): Promise<{ path?: string; version?: string }> => new Promise(() => {})
    const report = await createDiagnostics(
      makeDeps({
        probeTimeoutMs: 10,
        probeTool: (name) => (name === 'gh' ? never() : Promise.resolve({ path: `/bin/${name}` }))
      })
    )()
    expect(report.tools.find((tool) => tool.name === 'gh')).toEqual({ name: 'gh', found: false })
    expect(report.tools.filter((tool) => tool.found)).toHaveLength(DIAGNOSTIC_TOOLS.length - 1)
  })

  it('runs the probes in parallel', async () => {
    const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
    const start = Date.now()
    const report = await createDiagnostics(
      makeDeps({
        probeTimeoutMs: 300,
        probeTool: async (name) => {
          await wait(50)
          return { path: `/bin/${name}` }
        }
      })
    )()
    expect(Date.now() - start).toBeLessThan(250)
    expect(report.tools.every((tool) => tool.found)).toBe(true)
    expect(DEFAULT_PROBE_TIMEOUT_MS).toBe(3000)
  })
})

describe('redactLine', () => {
  it.each([
    ['key sk-ant-api03-abcdefghijklmnop ok', 'key [redacted] ok'],
    ['key sk_live_abcdefghijklmnop ok', 'key [redacted] ok'],
    ['token ghp_abcdefghijklmnopqrstuvwxyz0123456789 done', 'token [redacted] done'],
    ['Authorization: Bearer abcDEF123._~+/=xyz end', 'Authorization: [redacted] end'],
    ['sha=0123456789abcdef0123456789abcdef01234567 end', 'sha=[redacted] end'],
    ['blob AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA== end', 'blob [redacted] end'],
    ['password=hunter2 ok', 'password=[redacted] ok'],
    ['token: "abc123xyz" ok', 'token: [redacted] ok'],
    ['api_key=abcdef ok', 'api_key=[redacted] ok'],
    ['secret = topsecret ok', 'secret = [redacted] ok'],
    ['plain session text', 'plain session text']
  ])('redacts %s', (input, expected) => {
    expect(redactLine(input, HOME)).toBe(expected)
  })

  it('replaces the home folder prefix with ~ for both separator styles', () => {
    expect(redactLine(`${HOME}\\.claude\\settings.json`, HOME)).toBe('~\\.claude\\settings.json')
    expect(redactLine(`${HOME}/.cursor`, HOME)).toBe('~/.cursor')
    expect(redactLine(`file in ${HOME}\\docs`, HOME)).toBe('file in ~\\docs')
    expect(redactLine('C:\\Program Files\\tool', HOME)).toBe('C:\\Program Files\\tool')
    expect(redactLine('no home here', '')).toBe('no home here')
  })

  it('does not leak a token when the home path is redacted too', () => {
    expect(redactLine(`${HOME}\\.claude key sk-ant-abcdefghij`, HOME)).toBe('~\\.claude key [redacted]')
  })
})

describe('createDiagnostics: dirs and log', () => {
  it('records only name, path and exists for each dir', async () => {
    const report = await createDiagnostics(makeDeps())()
    expect(report.dirs).toEqual([
      { name: 'userData', path: USER_DATA, exists: true },
      { name: 'worktrees', path: WORKTREES, exists: false },
      { name: 'claude', path: `${HOME}\\.claude`, exists: true },
      { name: 'cursor', path: `${HOME}\\.cursor`, exists: false }
    ])
  })

  it('caps the number of lines and the length of each line', async () => {
    // Short words separated by spaces: a long run of one character would (correctly) look like a secret.
    const filler = 'ab '.repeat(MAX_LOG_LINE_CHARS)
    const readLogTail = vi.fn((_maxLines: number) =>
      Array.from({ length: MAX_LOG_TAIL_LINES + 20 }, (_, index) => `line-${index} ${filler}`)
    )
    const report = await createDiagnostics(makeDeps({ readLogTail }))()
    expect(readLogTail).toHaveBeenCalledWith(MAX_LOG_TAIL_LINES)
    expect(report.logTail).toHaveLength(MAX_LOG_TAIL_LINES)
    expect(report.logTail[0]).toBe(`line-20 ${filler}`.slice(0, MAX_LOG_LINE_CHARS))
    expect(report.logTail[0]).toHaveLength(MAX_LOG_LINE_CHARS)
    expect(report.logTail.every((line) => line.length <= MAX_LOG_LINE_CHARS)).toBe(true)
  })

  it('redacts log lines and uses [] when the log cannot be read', async () => {
    const report = await createDiagnostics(
      makeDeps({
        readLogTail: () => [`opened ${HOME}\\.claude`, 'key sk-ant-abcdefghijklmnop']
      })
    )()
    expect(report.logTail).toEqual(['opened ~\\.claude', 'key [redacted]'])

    const broken = await createDiagnostics(
      makeDeps({
        readLogTail: () => {
          throw new Error('log locked')
        },
        pathExists: () => {
          throw new Error('access denied')
        }
      })
    )()
    expect(broken.logTail).toEqual([])
    expect(broken.dirs.every((dir) => dir.exists === false)).toBe(true)
  })

  it('builds the documented report shape', async () => {
    const report = await createDiagnostics(makeDeps())()
    expect(Object.keys(report)).toEqual(['generatedAt', 'app', 'tools', 'dirs', 'logTail'])
    expect(Object.keys(report.app)).toEqual(['version', 'electron', 'chrome', 'node', 'platform', 'arch'])
    expect(report.app).toEqual(APP_INFO)
    expect(report.generatedAt).toBe(1_700_000_000_000)
    expect(report.logTail).toEqual(['[info] session started', '[warn] slow tool'])
  })
})

describe('errorLogPath', () => {
  it('points at the file errorLog.ts writes', () => {
    expect(errorLogPath(USER_DATA)).toBe(join(USER_DATA, MAIN_ERROR_LOG_FILE))
  })
})
