import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHookServer, type HookServer } from './HookServer'
import { statusLineCommand } from './claudeSettings'

/** On Windows the bash on PATH may be the WSL launcher; prefer Git for Windows' bash (it ships curl). */
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'
const BASH = process.platform === 'win32' && existsSync(GIT_BASH) ? GIT_BASH : 'bash'

function hasTool(command: string): boolean {
  const result = spawnSync(BASH, ['-c', command], { stdio: 'ignore' })
  return result.status === 0
}

const TOOLS_AVAILABLE = hasTool('echo ok') && hasTool('command -v curl')

/** Shape of a real Claude Code 2.1.x statusLine payload (trimmed to the fields the app reads, plus extras it ignores). */
const SAMPLE_PAYLOAD = {
  session_id: 'claude-session-abc',
  cwd: '/home/user/project',
  model: { id: 'claude-sonnet-5-5', display_name: 'Sonnet 5.5' },
  effort: { level: 'medium' },
  cost: { total_cost_usd: 0.4215, total_duration_ms: 90210 },
  context_window: {
    total_input_tokens: 15234,
    total_output_tokens: 4521,
    context_window_size: 200000,
    used_percentage: 8,
    remaining_percentage: 92
  },
  rate_limits: {
    five_hour: { used_percentage: 38, resets_at: 1791894600 },
    seven_day: { used_percentage: 34, resets_at: 1792332000 }
  },
  version: '2.1.285'
}

interface RunResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

function runStatusLine(command: string, stdin: string, env: Record<string, string>): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(BASH, ['-c', command], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }))
    child.stdin.end(stdin)
  })
}

describe.skipIf(!TOOLS_AVAILABLE)('statusLineCommand through bash against a real HookServer', () => {
  let server: HookServer
  let port: number
  let tempDir: string
  let sessionId: string
  const token = 'bash-test-token'
  let received: Array<{ sessionId: string; payload: unknown }> = []

  beforeEach(async () => {
    received = []
    sessionId = randomUUID()
    tempDir = mkdtempSync(join(tmpdir(), 'sessiondeck-sl-'))
    server = createHookServer({
      token,
      isKnownSession: (id) => id === sessionId,
      onEvent: () => {},
      onStatusLine: (id, payload) => received.push({ sessionId: id, payload })
    })
    ;({ port } = await server.start())
  })

  afterEach(async () => {
    await server.stop()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function env(): Record<string, string> {
    return {
      SESSIONDECK_SESSION_ID: sessionId,
      SESSIONDECK_PORT: String(port),
      SESSIONDECK_TOKEN: token,
      // Forward slashes: bash (Git Bash) handles them on every platform.
      TMPDIR: tempDir.replace(/\\/g, '/')
    }
  }

  it('POSTs the payload, prints nothing and exits 0', async () => {
    const result = await runStatusLine(statusLineCommand(), JSON.stringify(SAMPLE_PAYLOAD), env())

    expect(result.code).toBe(0)
    expect(result.stdout).toBe('')
    expect(received).toHaveLength(1)
    expect(received[0].sessionId).toBe(sessionId)
    expect(received[0].payload).toEqual(SAMPLE_PAYLOAD)
  })

  it('throttles a second immediate call for the same session', async () => {
    const first = await runStatusLine(statusLineCommand(), JSON.stringify(SAMPLE_PAYLOAD), env())
    const second = await runStatusLine(
      statusLineCommand(),
      JSON.stringify({ ...SAMPLE_PAYLOAD, cost: { total_cost_usd: 0.5 } }),
      env()
    )

    expect(first.code).toBe(0)
    expect(second.code).toBe(0)
    expect(second.stdout).toBe('')
    expect(received).toHaveLength(1)

    const stamp = join(tempDir, `sessiondeck-sl-${sessionId}`)
    expect(existsSync(stamp)).toBe(true)
    expect(Number(readFileSync(stamp, 'utf8').trim())).toBeGreaterThan(0)
  })

  it('exits 0 and stays silent when the session is unknown', async () => {
    const result = await runStatusLine(
      statusLineCommand(),
      JSON.stringify(SAMPLE_PAYLOAD),
      { ...env(), SESSIONDECK_SESSION_ID: randomUUID() }
    )
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('')
    expect(received).toHaveLength(0)
  })

  it('exits 0 when the server is not listening', async () => {
    const result = await runStatusLine(
      statusLineCommand(),
      JSON.stringify(SAMPLE_PAYLOAD),
      { ...env(), SESSIONDECK_PORT: '1' }
    )
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('')
  })
})
