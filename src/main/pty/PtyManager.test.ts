import { describe, it, expect, vi, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IPty } from 'node-pty'
import { PtyManager, sanitizeChildEnv } from './PtyManager'
import type { SpawnFn, StartOptions, DataListener, ExitListener } from './PtyManager'

class FakePty {
  readonly dataListeners = new Set<(data: string) => void>()
  readonly exitListeners = new Set<(e: { exitCode: number; signal?: number }) => void>()
  readonly writes: string[] = []
  readonly resizes: Array<{ cols: number; rows: number }> = []
  killed = false
  pid = 0

  onData(cb: (data: string) => void): { dispose(): void } {
    this.dataListeners.add(cb)
    return {
      dispose: () => {
        this.dataListeners.delete(cb)
      }
    }
  }

  onExit(cb: (e: { exitCode: number; signal?: number }) => void): { dispose(): void } {
    this.exitListeners.add(cb)
    return {
      dispose: () => {
        this.exitListeners.delete(cb)
      }
    }
  }

  write(data: string): void {
    this.writes.push(data)
  }

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows })
  }

  kill(): void {
    this.killed = true
  }

  fireData(data: string): void {
    for (const cb of [...this.dataListeners]) {
      cb(data)
    }
  }

  fireExit(code: number): void {
    for (const cb of [...this.exitListeners]) {
      cb({ exitCode: code })
    }
  }
}

interface SpawnCall {
  readonly file: string
  readonly args: string[]
  readonly options: Record<string, unknown>
}

interface SpawnHarness {
  readonly spawn: SpawnFn
  readonly ptys: FakePty[]
  readonly calls: SpawnCall[]
  setError(err: Error): void
}

function makeSpawnHarness(): SpawnHarness {
  const ptys: FakePty[] = []
  const calls: SpawnCall[] = []
  let nextError: Error | null = null

  const spawn = ((file: string, args: string[] | string, options: unknown): IPty => {
    if (nextError) {
      throw nextError
    }
    calls.push({
      file,
      args: Array.isArray(args) ? args : [args],
      options: options as Record<string, unknown>
    })
    const pty = new FakePty()
    ptys.push(pty)
    return pty as unknown as IPty
  }) as unknown as SpawnFn

  return {
    spawn,
    ptys,
    calls,
    setError: (err: Error) => {
      nextError = err
    }
  }
}

const createdDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sessiondeck-pty-'))
  createdDirs.push(dir)
  return dir
}

function startOpts(overrides: Partial<StartOptions> = {}): StartOptions {
  return {
    sessionId: 's1',
    cwd: tempDir(),
    claudeArgs: [],
    internalArgs: [],
    env: {},
    cols: 80,
    rows: 24,
    ...overrides
  }
}

afterAll(() => {
  for (const dir of createdDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('PtyManager', () => {
  it('emits data with increasing per-session sequence numbers', () => {
    const { spawn, ptys } = makeSpawnHarness()
    const manager = new PtyManager({ spawn, platform: 'linux' })
    const events: Array<{ id: string; data: string; seq: number }> = []
    manager.onData((id, data, seq) => events.push({ id, data, seq }))
    manager.start(startOpts())

    ptys[0].fireData('foo')
    ptys[0].fireData('bar')

    expect(events).toEqual([
      { id: 's1', data: 'foo', seq: 1 },
      { id: 's1', data: 'bar', seq: 2 }
    ])
  })

  it('trims the replay buffer at the configured limit', () => {
    const { spawn, ptys } = makeSpawnHarness()
    const manager = new PtyManager({ spawn, platform: 'linux', bufferLimit: 5 })
    manager.start(startOpts())

    ptys[0].fireData('aaa')
    ptys[0].fireData('bbb')
    ptys[0].fireData('c')

    expect(manager.replay('s1')).toEqual({ data: 'bbbc', seq: 3 })
  })

  it('keeps replay seq consistent with the last live emitted seq', () => {
    const { spawn, ptys } = makeSpawnHarness()
    const manager = new PtyManager({ spawn, platform: 'linux' })
    let lastSeq = 0
    manager.onData((_id, _data, seq) => {
      lastSeq = seq
    })
    manager.start(startOpts())

    ptys[0].fireData('x')
    ptys[0].fireData('y')

    expect(manager.replay('s1')).toEqual({ data: 'xy', seq: lastSeq })
  })

  it('keeps the buffer for replay after exit', () => {
    const { spawn, ptys } = makeSpawnHarness()
    const manager = new PtyManager({ spawn, platform: 'linux' })
    manager.start(startOpts())

    ptys[0].fireData('before exit')
    ptys[0].fireExit(0)

    expect(manager.isRunning('s1')).toBe(false)
    expect(manager.replay('s1')).toEqual({ data: 'before exit', seq: 1 })
  })

  it('emits the exit code exactly once', () => {
    const { spawn, ptys } = makeSpawnHarness()
    const manager = new PtyManager({ spawn, platform: 'linux' })
    const exits: Array<{ id: string; code: number | null }> = []
    manager.onExit((id, code) => exits.push({ id, code }))
    manager.start(startOpts())

    ptys[0].fireExit(7)

    expect(exits).toEqual([{ id: 's1', code: 7 }])
  })

  it('restart kills the old process, clears the buffer, and seq keeps increasing', () => {
    const { spawn, ptys } = makeSpawnHarness()
    const manager = new PtyManager({ spawn, platform: 'linux' })
    const opts = startOpts()
    manager.start(opts)
    ptys[0].fireData('old')

    manager.restart(opts)

    expect(ptys[0].killed).toBe(true)
    expect(manager.replay('s1')).toEqual({ data: '', seq: 0 })
    expect(ptys.length).toBe(2)

    ptys[1].fireData('new')
    expect(manager.replay('s1')).toEqual({ data: 'new', seq: 2 })
  })

  it('throws when writing to an exited session', () => {
    const { spawn, ptys } = makeSpawnHarness()
    const manager = new PtyManager({ spawn, platform: 'linux' })
    manager.start(startOpts())
    ptys[0].fireExit(0)

    expect(() => manager.write('s1', 'hi')).toThrow('Session not running: s1')
  })

  it('throws when starting an already-running session', () => {
    const { spawn } = makeSpawnHarness()
    const manager = new PtyManager({ spawn, platform: 'linux' })
    const opts = startOpts()
    manager.start(opts)

    expect(() => manager.start(opts)).toThrow('Session already running: s1')
  })

  it('clamps cols and rows to the valid range', () => {
    const { spawn, ptys, calls } = makeSpawnHarness()
    const manager = new PtyManager({ spawn, platform: 'linux' })
    manager.start(startOpts({ cols: 1, rows: 5000 }))

    expect(calls[0].options.cols).toBe(2)
    expect(calls[0].options.rows).toBe(1000)

    manager.resize('s1', 0, 9999)
    expect(ptys[0].resizes).toEqual([{ cols: 2, rows: 1000 }])
  })

  it('rejects unsafe claude arguments on start', () => {
    const { spawn } = makeSpawnHarness()
    const manager = new PtyManager({ spawn, platform: 'win32' })
    expect(() => manager.start(startOpts({ claudeArgs: ['a&b'] }))).toThrow(
      'Unsafe claude argument: a&b'
    )
  })

  it('throws when cwd does not exist', () => {
    const { spawn } = makeSpawnHarness()
    const manager = new PtyManager({ spawn, platform: 'linux' })
    const missing = join(tmpdir(), 'sessiondeck-definitely-missing')
    expect(() => manager.start(startOpts({ cwd: missing }))).toThrow(
      `Directory not found: ${missing}`
    )
  })

  it('does not register a session when spawn throws', () => {
    const { spawn, setError } = makeSpawnHarness()
    setError(new Error('boom'))
    const manager = new PtyManager({ spawn, platform: 'linux' })

    expect(() => manager.start(startOpts())).toThrow('boom')
    expect(manager.isRunning('s1')).toBe(false)
    expect(manager.replay('s1')).toEqual({ data: '', seq: 0 })
  })

  it('returns a no-op unsubscribe function for data and exit listeners', () => {
    const { spawn, ptys } = makeSpawnHarness()
    const manager = new PtyManager({ spawn, platform: 'linux' })
    const onData: DataListener = vi.fn()
    const onExit: ExitListener = vi.fn()
    const unsubscribeData = manager.onData(onData)
    const unsubscribeExit = manager.onExit(onExit)

    unsubscribeData()
    unsubscribeExit()

    manager.start(startOpts())
    ptys[0].fireData('x')
    ptys[0].fireExit(0)

    expect(onData).not.toHaveBeenCalled()
    expect(onExit).not.toHaveBeenCalled()
  })

  it('killAll kills every running session', () => {
    const { spawn, ptys } = makeSpawnHarness()
    const manager = new PtyManager({ spawn, platform: 'linux' })
    manager.start(startOpts({ sessionId: 'a' }))
    manager.start(startOpts({ sessionId: 'b' }))

    manager.killAll()

    expect(ptys[0].killed).toBe(true)
    expect(ptys[1].killed).toBe(true)
  })

  it('injects the expected environment and terminal settings into the pty', () => {
    const { spawn, calls } = makeSpawnHarness()
    const manager = new PtyManager({ spawn, platform: 'win32' })
    manager.start(startOpts({ env: { FOO: 'bar' } }))

    const options = calls[0].options
    expect(options.name).toBe('xterm-256color')
    expect(options.useConpty).toBe(true)
    const env = options.env as Record<string, string | undefined>
    expect(env.TERM).toBe('xterm-256color')
    expect(env.COLORTERM).toBe('truecolor')
    expect(env.FOO).toBe('bar')
  })

  it('uses cmd.exe on win32 and claude directly elsewhere', () => {
    const win = makeSpawnHarness()
    const winManager = new PtyManager({ spawn: win.spawn, platform: 'win32' })
    winManager.start(startOpts())
    expect(win.calls[0].file).toBe('cmd.exe')
    expect(win.calls[0].args).toEqual(['/d', '/c', 'claude'])

    const posix = makeSpawnHarness()
    const posixManager = new PtyManager({ spawn: posix.spawn, platform: 'linux' })
    posixManager.start(startOpts())
    expect(posix.calls[0].file).toBe('claude')
    expect(posix.calls[0].args).toEqual([])
  })

  it('passes internalArgs before claudeArgs on win32', () => {
    const win = makeSpawnHarness()
    const winManager = new PtyManager({ spawn: win.spawn, platform: 'win32' })
    winManager.start(startOpts({
      internalArgs: ['--settings', 'path with spaces'],
      claudeArgs: ['--continue']
    }))
    expect(win.calls[0].args).toEqual(['/d', '/c', 'claude', '--settings', 'path with spaces', '--continue'])
  })

  it('passes internalArgs before claudeArgs on linux', () => {
    const posix = makeSpawnHarness()
    const posixManager = new PtyManager({ spawn: posix.spawn, platform: 'linux' })
    posixManager.start(startOpts({
      internalArgs: ['--settings', 'path with spaces'],
      claudeArgs: ['--continue']
    }))
    expect(posix.calls[0].args).toEqual(['--settings', 'path with spaces', '--continue'])
  })

  it('validates claudeArgs but not internalArgs', () => {
    const win = makeSpawnHarness()
    const winManager = new PtyManager({ spawn: win.spawn, platform: 'win32' })
    expect(() => winManager.start(startOpts({
      sessionId: 's1',
      internalArgs: ['--settings', 'path with spaces & more'],
      claudeArgs: ['--continue']
    }))).not.toThrow()
    expect(() => winManager.start(startOpts({
      sessionId: 's2',
      internalArgs: [],
      claudeArgs: ['--unsafe&arg']
    }))).toThrow('Unsafe claude argument: --unsafe&arg')
  })

  it('restart also uses internalArgs', () => {
    const win = makeSpawnHarness()
    const winManager = new PtyManager({ spawn: win.spawn, platform: 'win32' })
    const opts = startOpts({ internalArgs: ['--internal'], claudeArgs: ['--user'] })
    winManager.start(opts)
    winManager.restart(opts)
    expect(win.calls.length).toBe(2)
    expect(win.calls[0].args).toEqual(['/d', '/c', 'claude', '--internal', '--user'])
    expect(win.calls[1].args).toEqual(['/d', '/c', 'claude', '--internal', '--user'])
  })
})

describe('PtyManager.onStart', () => {
  it('fires once per successful start and once per restart', () => {
    const { spawn, ptys } = makeSpawnHarness()
    const manager = new PtyManager({ spawn, platform: 'linux' })
    const starts: string[] = []
    const opts = startOpts()
    manager.onStart((id) => starts.push(id))
    manager.start(opts)
    manager.restart(startOpts())
    expect(starts).toEqual(['s1', 's1'])
    expect(manager.onData(() => {})).toBeTruthy() // sanity: the manager keeps working
    void ptys
  })

  it('does not fire when the spawn throws', () => {
    const { spawn, setError } = makeSpawnHarness()
    setError(new Error('boom'))
    const manager = new PtyManager({ spawn, platform: 'linux' })
    const starts: string[] = []
    manager.onStart((id) => starts.push(id))
    expect(() => manager.start(startOpts())).toThrow('boom')
    expect(starts).toEqual([])
  })

  it('unsubscribing stops it', () => {
    const { spawn, ptys } = makeSpawnHarness()
    const manager = new PtyManager({ spawn, platform: 'linux' })
    const starts: string[] = []
    const off = manager.onStart((id) => starts.push(id))
    manager.start(startOpts())
    off()
    manager.restart(startOpts())
    expect(starts).toEqual(['s1'])
    void ptys
  })
})

describe('sanitizeChildEnv colour handling', () => {
  it('removes NO_COLOR and NODE_DISABLE_COLORS so sessions keep their colours', () => {
    const result = sanitizeChildEnv({ NO_COLOR: '1', NODE_DISABLE_COLORS: '1', PATH: 'x' })
    expect(result).toEqual({ PATH: 'x' })
  })

  it('removes FORCE_COLOR only when it disables colour', () => {
    expect(sanitizeChildEnv({ FORCE_COLOR: '0' })).toEqual({})
    expect(sanitizeChildEnv({ FORCE_COLOR: 'false' })).toEqual({})
    expect(sanitizeChildEnv({ FORCE_COLOR: '' })).toEqual({})
    expect(sanitizeChildEnv({ FORCE_COLOR: '3' })).toEqual({ FORCE_COLOR: '3' })
  })
})

describe('sanitizeChildEnv', () => {
  it('removes CLAUDECODE exact match', () => {
    const env = { CLAUDECODE: '1', OTHER: 'value' }
    const result = sanitizeChildEnv(env)
    expect(result).toEqual({ OTHER: 'value' })
  })

  it('removes CLAUDE_CODE_ prefix', () => {
    const env = { CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_SOMETHING: '2', KEEP: 'value' }
    const result = sanitizeChildEnv(env)
    expect(result).toEqual({ KEEP: 'value' })
  })

  it('removes CLAUDE_AGENT_ prefix', () => {
    const env = { CLAUDE_AGENT_SESSION: '1', CLAUDE_AGENT_OTHER: '2', KEEP: 'value' }
    const result = sanitizeChildEnv(env)
    expect(result).toEqual({ KEEP: 'value' })
  })

  it('keeps unrelated variables', () => {
    const env = { PATH: '/usr/bin', HOME: '/home/user', TERM: 'xterm' }
    const result = sanitizeChildEnv(env)
    expect(result).toEqual(env)
  })

  it('keeps variables that partially match but not at start', () => {
    const env = { MY_CLAUDE_CODE_VAR: '1', PREFIX_CLAUDE_AGENT: '2', KEEP: 'value' }
    const result = sanitizeChildEnv(env)
    expect(result).toEqual({ MY_CLAUDE_CODE_VAR: '1', PREFIX_CLAUDE_AGENT: '2', KEEP: 'value' })
  })

  it('handles empty env', () => {
    const result = sanitizeChildEnv({})
    expect(result).toEqual({})
  })

  it('does not mutate input', () => {
    const env = { CLAUDECODE: '1', KEEP: 'value' }
    const original = { ...env }
    sanitizeChildEnv(env)
    expect(env).toEqual(original)
  })
})

describe('PtyManager stops the whole process tree', () => {
  function fakeKiller() {
    const calls: string[] = []
    const pending: Array<() => void> = []
    return {
      calls,
      pending,
      killer: {
        killAsync: (pids: readonly number[], done: () => void): void => { calls.push(`async:${pids.join(',')}`); pending.push(done) },
        killSync: (pids: readonly number[]): void => { calls.push(`sync:${pids.join(',')}`) }
      }
    }
  }

  it('kill() asks the tree killer first and only plain-kills the pty after the tree is gone', () => {
    const { spawn, ptys } = makeSpawnHarness()
    const { calls, pending, killer } = fakeKiller()
    const manager = new PtyManager({ spawn, platform: 'win32', treeKiller: killer })
    manager.start(startOpts({ cwd: tempDir() }))
    ptys[0].pid = 4321
    manager.kill('s1')
    expect(calls).toEqual(['async:4321'])
    expect(ptys[0].killed).toBe(false)
    pending[0]()
    expect(ptys[0].killed).toBe(true)
  })

  it('kill() falls back to a plain kill when the pty has no usable pid', () => {
    const { spawn, ptys } = makeSpawnHarness()
    const { calls, killer } = fakeKiller()
    const manager = new PtyManager({ spawn, platform: 'win32', treeKiller: killer })
    manager.start(startOpts({ cwd: tempDir() }))
    ptys[0].pid = 0
    manager.kill('s1')
    expect(calls).toEqual([])
    expect(ptys[0].killed).toBe(true)
  })

  it('killAll() stops every session tree with ONE blocking call (the app is quitting)', () => {
    const { spawn, ptys } = makeSpawnHarness()
    const { calls, killer } = fakeKiller()
    const manager = new PtyManager({ spawn, platform: 'win32', treeKiller: killer })
    manager.start(startOpts({ sessionId: 'a', cwd: tempDir() }))
    manager.start(startOpts({ sessionId: 'b', cwd: tempDir() }))
    ptys[0].pid = 11
    ptys[1].pid = 22
    manager.killAll()
    expect(calls).toEqual(['sync:11,22'])
    expect(ptys.every((p) => p.killed)).toBe(true)
  })

  it('restart() kills the previous tree before launching the replacement', () => {
    const { spawn, ptys } = makeSpawnHarness()
    const { calls, killer } = fakeKiller()
    const manager = new PtyManager({ spawn, platform: 'win32', treeKiller: killer })
    manager.start(startOpts({ cwd: tempDir() }))
    ptys[0].pid = 99
    manager.restart(startOpts({ cwd: tempDir() }))
    expect(calls).toEqual(['sync:99'])
    expect(ptys).toHaveLength(2)
  })

  it('a pty that throws when killed (already dead) does not break kill/killAll', () => {
    const { spawn, ptys } = makeSpawnHarness()
    const { killer, pending } = fakeKiller()
    const manager = new PtyManager({ spawn, platform: 'win32', treeKiller: killer })
    manager.start(startOpts({ cwd: tempDir() }))
    ptys[0].pid = 5
    ptys[0].kill = () => { throw new Error('already exited') }
    manager.kill('s1')
    expect(() => pending[0]()).not.toThrow()
    expect(() => manager.killAll()).not.toThrow()
  })
})
