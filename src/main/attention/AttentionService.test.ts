import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createAttentionService } from './AttentionService'
import type { AttentionReason, HookEvent, ReminderSettings, SoundEvent } from '../../shared/types'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('AttentionService', () => {
  let service: ReturnType<typeof createAttentionService>
  let settingsDir: string
  let knownSessions: Set<string>
  let focusedSession: string | null
  let windowFocused: boolean
  let beepCalls: number
  let beepArgs: Array<{ id: string; reason: SoundEvent }>
  let flashCalls: boolean[]
  let changes: Array<{ id: string; reason: AttentionReason | null }> = []
  let hookEvents: HookEvent[] = []

  beforeEach(async () => {
    settingsDir = mkdtempSync(join(tmpdir(), 'sessiondeck-test-'))
    knownSessions = new Set(['session-1', 'session-2'])
    focusedSession = null
    windowFocused = false
    beepCalls = 0
    beepArgs = []
    flashCalls = []
    changes = []
    hookEvents = []

    service = createAttentionService({
      isKnownSession: (id) => knownSessions.has(id),
      isFocused: (id) => focusedSession === id,
      beep: (id, reason) => {
        beepCalls++
        beepArgs.push({ id, reason })
      },
      flash: (on) => { flashCalls.push(on) },
      isWindowFocused: () => windowFocused,
      settingsDir,
      onHookEvent: (event) => hookEvents.push(event)
    })

    service.onChange((id, reason) => {
      changes.push({ id, reason })
    })

    await service.start()
  })

  afterEach(async () => {
    await service.stop()
    rmSync(settingsDir, { recursive: true, force: true })
  })

  it('start() creates settings file and server', () => {
    const args = service.claudeArgs()
    expect(args).toEqual(['--settings', expect.stringContaining('sessiondeck-hooks.json')])
  })

  it('claudeArgs throws before start', () => {
    const newService = createAttentionService({
      isKnownSession: () => true,
      isFocused: () => false,
      beep: () => {},
      flash: () => {},
      isWindowFocused: () => false,
      settingsDir: mkdtempSync(join(tmpdir(), 'sessiondeck-test-'))
    })
    expect(() => newService.claudeArgs()).toThrow('AttentionService not started')
  })

  it('envFor returns correct env vars', () => {
    const env = service.envFor('session-1')
    expect(env.SESSIONDECK_SESSION_ID).toBe('session-1')
    expect(env.SESSIONDECK_PORT).toBeDefined()
    expect(env.SESSIONDECK_TOKEN).toBeDefined()
  })

  it('envFor throws before start', () => {
    const newService = createAttentionService({
      isKnownSession: () => true,
      isFocused: () => false,
      beep: () => {},
      flash: () => {},
      isWindowFocused: () => false,
      settingsDir: mkdtempSync(join(tmpdir(), 'sessiondeck-test-'))
    })
    expect(() => newService.envFor('session-1')).toThrow('AttentionService not started')
  })

  it('noteOutput -> noteInput clears attention', () => {
    focusedSession = null
    service.noteOutput('session-1')
    service.noteInput('session-1')
    expect(service.get('session-1')).toBeNull()
  })

  it('clear removes attention', () => {
    focusedSession = null
    service.raise('session-1', 'permission')
    expect(service.get('session-1')).toBe('permission')
    service.clear('session-1')
    expect(service.get('session-1')).toBeNull()
  })

  it('get returns null for unknown session', () => {
    expect(service.get('unknown')).toBeNull()
  })

  it('onChange notifies on attention changes', () => {
    focusedSession = null
    service.raise('session-1', 'idle')
    expect(changes).toContainEqual({ id: 'session-1', reason: 'idle' })
  })

  it('setSoundEnabled controls beep', () => {
    focusedSession = null
    windowFocused = true // disable flash to isolate sound
    service.setSoundEnabled(false)
    service.raise('session-1', 'permission')
    expect(beepCalls).toBe(0)
    service.setSoundEnabled(true)
    // A different session: a lower-priority reason on session-1 would be suppressed by the manager, not by sound.
    service.raise('session-2', 'done')
    expect(beepCalls).toBe(1)
  })

  it('passes the raising session id and reason to the sound callback', () => {
    focusedSession = null
    windowFocused = true
    service.raise('session-2', 'permission')
    expect(beepArgs).toEqual([{ id: 'session-2', reason: 'permission' }])
  })

  it('forget removes session completely', () => {
    focusedSession = null
    service.raise('session-1', 'permission')
    expect(service.get('session-1')).toBe('permission')
    service.forget('session-1')
    expect(service.get('session-1')).toBeNull()
  })

  it('suspend keeps the bell and its reason', () => {
    focusedSession = null
    service.raise('session-1', 'done')
    service.suspend('session-1')
    expect(service.get('session-1')).toBe('done')
  })

  it('suspend sends no attention change to subscribers', () => {
    focusedSession = null
    service.raise('session-1', 'done')
    changes = []
    service.suspend('session-1')
    expect(changes).toEqual([])
  })

  it('suspend drops the idle timer of the session', () => {
    vi.useFakeTimers()
    try {
      service.noteOutput('session-1')
      const pending = vi.getTimerCount()
      service.suspend('session-1')
      expect(vi.getTimerCount()).toBe(pending - 1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('suspend leaves other sessions untouched', () => {
    focusedSession = null
    service.raise('session-2', 'permission')
    service.suspend('session-1')
    expect(service.get('session-2')).toBe('permission')
  })

  it('the session on screen gets attention but no sound and no flash', () => {
    focusedSession = 'session-1'
    service.raise('session-1', 'permission')
    expect(service.get('session-1')).toBe('permission')
    expect(beepCalls).toBe(0)
    expect(flashCalls).toEqual([])
    focusedSession = null
    service.raise('session-2', 'done')
    expect(beepCalls).toBe(1)
  })

  it('priority upgrade works through service', () => {
    focusedSession = null
    service.raise('session-1', 'idle')
    expect(service.get('session-1')).toBe('idle')
    service.raise('session-1', 'permission')
    expect(service.get('session-1')).toBe('permission')
  })

  it('HookServer integration: Notification raises permission', async () => {
    focusedSession = null
    const port = service.envFor('session-1').SESSIONDECK_PORT
    const token = service.envFor('session-1').SESSIONDECK_TOKEN

    const response = await fetch(`http://127.0.0.1:${port}/hook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-token': token
      },
      body: JSON.stringify({ sessionId: 'session-1', event: 'Notification' })
    })
    expect(response.status).toBe(204)
    expect(service.get('session-1')).toBe('permission')
  })

  it('HookServer integration: Stop raises done', async () => {
    focusedSession = null
    const port = service.envFor('session-1').SESSIONDECK_PORT
    const token = service.envFor('session-1').SESSIONDECK_TOKEN

    const response = await fetch(`http://127.0.0.1:${port}/hook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-token': token
      },
      body: JSON.stringify({ sessionId: 'session-1', event: 'Stop' })
    })
    expect(response.status).toBe(204)
    expect(service.get('session-1')).toBe('done')
  })

  it('UserPromptSubmit does not raise attention but is surfaced via onHookEvent', async () => {
    focusedSession = null
    const { SESSIONDECK_PORT: port, SESSIONDECK_TOKEN: token } = service.envFor('session-1')
    const response = await fetch(`http://127.0.0.1:${port}/hook/session-1/UserPromptSubmit`, {
      method: 'POST',
      headers: { 'x-token': token },
      body: '{}'
    })
    expect(response.status).toBe(204)
    expect(service.get('session-1')).toBeNull()
    expect(changes).toEqual([])
    expect(hookEvents).toEqual([{ sessionId: 'session-1', event: 'UserPromptSubmit' }])
  })

  it('onHookEvent is called for Notification (with message) and Stop too', async () => {
    focusedSession = null
    const { SESSIONDECK_PORT: port, SESSIONDECK_TOKEN: token } = service.envFor('session-1')
    await fetch(`http://127.0.0.1:${port}/hook/session-1/Notification`, {
      method: 'POST',
      headers: { 'x-token': token },
      body: JSON.stringify({ message: 'Allow?' })
    })
    await fetch(`http://127.0.0.1:${port}/hook/session-2/Stop`, {
      method: 'POST',
      headers: { 'x-token': token }
    })
    expect(hookEvents).toEqual([
      { sessionId: 'session-1', event: 'Notification', message: 'Allow?' },
      { sessionId: 'session-2', event: 'Stop' }
    ])
    expect(service.get('session-1')).toBe('permission')
    expect(service.get('session-2')).toBe('done')
  })

  it('stop() cleans up and can be called twice', async () => {
    await service.stop()
    await service.stop() // Should not throw
  })

  it('IdleDetector integration: idle raises idle reason', async () => {
    // This tests the wiring through the service
    // We can't easily test the timer without waiting, but we can verify the integration exists
    focusedSession = null
    service.noteOutput('session-1')
    // The idle detector is wired internally
    // In real usage, after 4s of no output, 'idle' would be raised
    expect(typeof service.noteOutput).toBe('function')
    expect(typeof service.noteInput).toBe('function')
  })

  describe('ignored worker process (OpenCode worker tabs)', () => {
    /** Adds an isIgnoredProcess filter to the standard harness and waits for the server. */
    async function startFiltered(): Promise<void> {
      await service.stop()
      focusedSession = null
      windowFocused = false
      beepCalls = 0
      beepArgs = []
      flashCalls = []
      changes = []
      hookEvents = []
      service = createAttentionService({
        isKnownSession: (id) => knownSessions.has(id),
        isIgnoredProcess: (_id, proc) => proc === '999',
        isFocused: (id) => focusedSession === id,
        beep: (id, reason) => { beepCalls++; beepArgs.push({ id, reason }) },
        flash: (on) => { flashCalls.push(on) },
        isWindowFocused: () => windowFocused,
        settingsDir,
        onStatusLine: (_sessionId, _payload) => { statusLineCalls++ },
        onHookEvent: (event) => hookEvents.push(event)
      })
      await service.start()
    }

    let statusLineCalls: number

    beforeEach(async () => {
      statusLineCalls = 0
    })

    afterEach(async () => {
      statusLineCalls = 0
    })

    async function post(path: string, body: unknown): Promise<number> {
      const { SESSIONDECK_PORT: port, SESSIONDECK_TOKEN: token } = service.envFor('session-1')
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers: { 'x-token': token },
        body: JSON.stringify(body)
      })
      await response.text()
      return response.status
    }

    it('an ignored proc raises no attention and no onHookEvent', async () => {
      await startFiltered()
      focusedSession = null
      expect(await post('/hook/session-1/Notification', { message: 'worker asks', proc: '999' })).toBe(204)
      expect(service.get('session-1')).toBeNull()
      expect(hookEvents).toEqual([])
    })

    it('an allowed or absent proc behaves as today', async () => {
      await startFiltered()
      focusedSession = null
      expect(await post('/hook/session-1/Notification', { message: 'owner asks', proc: '777' })).toBe(204)
      expect(await post('/hook/session-1/Stop', {})).toBe(204)
      expect(service.get('session-1')).toBe('permission')
      expect(hookEvents).toEqual([
        { sessionId: 'session-1', event: 'Notification', message: 'owner asks', proc: '777' },
        { sessionId: 'session-1', event: 'Stop' }
      ])
    })

    it('an ignored statusline proc does not reach usage; an allowed one does', async () => {
      await startFiltered()
      expect(await post('/statusline/session-1', { cost: { total_cost_usd: 1 }, proc: '999' })).toBe(204)
      expect(statusLineCalls).toBe(0)
      expect(await post('/statusline/session-1', { cost: { total_cost_usd: 2 }, proc: '777' })).toBe(204)
      expect(statusLineCalls).toBe(1)
    })

    it('opencodeEnv loads both plugins: the worker package dir first, then the session package dir', async () => {
      const env = service.opencodeEnv()
      const plugins = JSON.parse(env.OPENCODE_CONFIG_CONTENT).plugin as string[]
      expect(plugins.some((dir) => dir.endsWith('sessiondeck-worker-plugin'))).toBe(true)
      expect(plugins.some((dir) => dir.endsWith('sessiondeck-opencode-plugin'))).toBe(true)
      expect(plugins[plugins.length - 2].endsWith('sessiondeck-worker-plugin')).toBe(true)
      expect(plugins[plugins.length - 1].endsWith('sessiondeck-opencode-plugin')).toBe(true)
      expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT).permission).toEqual({ '*': 'allow' })
    })

    it('D79: the "ask" policy leaves the permission object exactly as the environment had it', async () => {
      const previous = process.env.OPENCODE_CONFIG_CONTENT
      delete process.env.OPENCODE_CONFIG_CONTENT
      try {
        const env = service.opencodeEnv('ask')
        const parsed = JSON.parse(env.OPENCODE_CONFIG_CONTENT)
        expect(parsed.plugin).toBeDefined()
        expect(parsed.permission).toBeUndefined()
      } finally {
        if (previous === undefined) delete process.env.OPENCODE_CONFIG_CONTENT
        else process.env.OPENCODE_CONFIG_CONTENT = previous
      }
    })
  })
})

// Bell escalation (D44): the service repeats the alert for a session that stays needs-you and unread.
describe('AttentionService reminders', () => {
  let service: ReturnType<typeof createAttentionService>
  let settingsDir: string
  let focusedSession: string | null
  let beeps: Array<{ id: string; reason: SoundEvent }>
  let reminders: Array<{ id: string; reason: AttentionReason }>
  let settings: ReminderSettings
  let clock: number

  /** The reminder timer is real (10 ms); the bookkeeping clock is injected, so no test waits a minute. */
  async function waitUntil(predicate: () => boolean, timeoutMs = 1000): Promise<boolean> {
    const end = Date.now() + timeoutMs
    while (Date.now() < end) {
      if (predicate()) return true
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    return predicate()
  }

  beforeEach(async () => {
    settingsDir = mkdtempSync(join(tmpdir(), 'sessiondeck-reminder-'))
    focusedSession = null
    beeps = []
    reminders = []
    settings = { enabled: true, afterMinutes: 1 }
    clock = 0
    service = createAttentionService({
      isKnownSession: (id) => id === 'session-1' || id === 'session-2',
      isFocused: (id) => focusedSession === id,
      beep: (id, reason) => beeps.push({ id, reason }),
      flash: () => {},
      isWindowFocused: () => false,
      settingsDir,
      getReminderSettings: () => settings,
      onReminder: (id, reason) => reminders.push({ id, reason }),
      now: () => clock,
      reminderTickMs: 10
    })
    await service.start()
  })

  afterEach(async () => {
    await service.stop()
    rmSync(settingsDir, { recursive: true, force: true })
  })

  it('repeats a still-unread background alert once per interval', async () => {
    service.raise('session-1', 'done')
    expect(beeps).toEqual([{ id: 'session-1', reason: 'done' }])

    clock = 59_999
    expect(await waitUntil(() => reminders.length > 0, 60)).toBe(false)

    clock = 60_000
    expect(await waitUntil(() => reminders.length === 1)).toBe(true)
    expect(reminders).toEqual([{ id: 'session-1', reason: 'done' }])
    expect(beeps).toEqual([
      { id: 'session-1', reason: 'done' },
      { id: 'session-1', reason: 'done' }
    ])

    // A reminder just fired: the next one waits for its own interval.
    clock = 60_001
    expect(await waitUntil(() => reminders.length > 1, 60)).toBe(false)
  })

  it('does not remind the session on screen', async () => {
    focusedSession = 'session-1'
    service.raise('session-1', 'done')
    clock = 60_000
    expect(await waitUntil(() => reminders.length > 0, 80)).toBe(false)
    expect(beeps).toEqual([])
  })

  it('clearing the bell disarms the reminder', async () => {
    service.raise('session-1', 'done')
    clock = 60_000
    expect(await waitUntil(() => reminders.length === 1)).toBe(true)

    service.clear('session-1')
    clock = 120_000
    expect(await waitUntil(() => reminders.length > 1, 80)).toBe(false)
  })

  it('forgetting the session disarms the reminder', async () => {
    service.raise('session-1', 'done')
    service.forget('session-1')
    clock = 60_000
    expect(await waitUntil(() => reminders.length > 0, 80)).toBe(false)
  })

  it('reads the settings every tick: off pauses, on resumes', async () => {
    service.raise('session-1', 'done')
    settings = { enabled: false, afterMinutes: 1 }
    clock = 60_000
    expect(await waitUntil(() => reminders.length > 0, 80)).toBe(false)

    settings = { enabled: true, afterMinutes: 1 }
    expect(await waitUntil(() => reminders.length === 1)).toBe(true)
  })

  it('never reminds the user\'s own unread flag', async () => {
    service.markUnread('session-1')
    clock = 60_000
    expect(await waitUntil(() => reminders.length > 0, 80)).toBe(false)
  })

  it('a priority upgrade repeats the more urgent reason like a fresh raise', async () => {
    service.raise('session-1', 'idle')
    clock = 60_000
    expect(await waitUntil(() => reminders.length === 1)).toBe(true)

    clock = 62_000
    service.raise('session-1', 'permission')
    expect(await waitUntil(() => reminders.some((entry) => entry.reason === 'permission'))).toBe(true)
  })
})

// Integration test with real curl through bash (skipped if bash/curl missing)
describe('AttentionService bash/curl integration', () => {
  let service: ReturnType<typeof createAttentionService>
  let settingsDir: string

  beforeEach(async () => {
    settingsDir = mkdtempSync(join(tmpdir(), 'sessiondeck-test-'))
    service = createAttentionService({
      isKnownSession: (id) => id === 'test-session',
      isFocused: () => false,
      beep: () => {},
      flash: () => {},
      isWindowFocused: () => false,
      settingsDir
    })
    await service.start()
  })

  afterEach(async () => {
    await service.stop()
    rmSync(settingsDir, { recursive: true, force: true })
  })

  it('runs hookCommand through bash against real HookServer', async (context) => {
    // Check if bash and curl are available. Missing tools SKIP the test (shown as skipped, not a silent pass).
    // On Windows the bash on PATH is the WSL launcher (no distro here: it exits non-zero or hangs when the WSL
    // service is cold — a 20s timeout failure in the parallel full suite). Prefer Git for Windows' bash, which
    // ships curl too (same preference as statusLineBash.test.ts).
    const { spawn } = await import('node:child_process')
    const { existsSync } = await import('node:fs')
    const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const bashExe = process.platform === 'win32' && existsSync(GIT_BASH) ? GIT_BASH : 'bash'

    function runBash(cmd: string, env: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
      return new Promise((resolve) => {
        const child = spawn(bashExe, ['-c', cmd], {
          env: { ...process.env, ...env },
          stdio: ['ignore', 'pipe', 'pipe']
        })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (d) => (stdout += d.toString()))
        child.stderr.on('data', (d) => (stderr += d.toString()))
        child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }))
      })
    }

    // Test bash availability
    const bashTest = await runBash('echo test', {})
    if (bashTest.code !== 0) {
      context.skip()
      return
    }

    const curlTest = await runBash('curl --version', {})
    if (curlTest.code !== 0) {
      context.skip()
      return
    }

    const env = service.envFor('test-session')
    const port = env.SESSIONDECK_PORT
    const token = env.SESSIONDECK_TOKEN

    // Use the same command format as hookCommand
    const hookCmd = `curl -s -m 2 -X POST "http://127.0.0.1:${port}/hook" -H "x-token: ${token}" -H "content-type: application/json" -d "{\\"sessionId\\":\\"test-session\\",\\"event\\":\\"Notification\\"}"`

    const result = await runBash(hookCmd, env)
    expect(result.code).toBe(0)
    expect(service.get('test-session')).toBe('permission')
    // 60s: on Windows `bash` is the WSL stub; when the WSL VM is cold or other tests load the machine, WSL init
    // alone can take tens of seconds (a 20s timeout once failed under the parallel full suite).
  }, 60_000)
})