import { spawn as nodePtySpawn } from 'node-pty'
import type { IPty, IWindowsPtyForkOptions } from 'node-pty'
import { statSync } from 'node:fs'
import type { Id } from '../../shared/types'
import type { PtyReplay } from '../../shared/ipc'
import { RingBuffer, DEFAULT_LIMIT_CHARS } from './RingBuffer'
import { buildCommandLaunch, type LaunchCommand } from './launch'
import { createTreeKiller, NOOP_TREE_KILLER, type TreeKiller } from './treeKiller'

const TERM_NAME = 'xterm-256color'
const COLORTERM_VALUE = 'truecolor'
const MIN_DIM = 2
const MAX_DIM = 1000

const CLAUDE_CODE_EXACT = 'CLAUDECODE'
const CLAUDE_CODE_PREFIX = 'CLAUDE_CODE_'
const CLAUDE_AGENT_PREFIX = 'CLAUDE_AGENT_'

// The PTY is a full truecolor terminal, so colour-disabling flags inherited from whatever launched the app
// (NO_COLOR=1, FORCE_COLOR=0, ...) must not turn the sessions monochrome.
const COLOR_DISABLING_VARS: ReadonlySet<string> = new Set(['NO_COLOR', 'NODE_DISABLE_COLORS'])
const FORCE_COLOR_VAR = 'FORCE_COLOR'
const FORCE_COLOR_OFF_VALUES: ReadonlySet<string> = new Set(['0', 'false', ''])

/** Drops variables that must not leak into a session: parent Claude Code markers and colour-disabling flags. */
export function sanitizeChildEnv(env: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (COLOR_DISABLING_VARS.has(key)) continue
    if (key === FORCE_COLOR_VAR && FORCE_COLOR_OFF_VALUES.has(value.toLowerCase())) continue
    if (key === CLAUDE_CODE_EXACT) continue
    if (key.startsWith(CLAUDE_CODE_PREFIX)) continue
    if (key.startsWith(CLAUDE_AGENT_PREFIX)) continue
    result[key] = value
  }
  return result
}

export type SpawnFn = typeof nodePtySpawn

export interface PtyManagerDeps {
  readonly spawn?: SpawnFn
  readonly platform?: NodeJS.Platform
  readonly bufferLimit?: number
  /** How processes are stopped. Defaults to a real process-tree killer, or a no-op when fake PTYs are injected. */
  readonly treeKiller?: TreeKiller
}

export interface StartOptions {
  readonly sessionId: Id
  readonly cwd: string
  readonly claudeArgs: readonly string[]
  readonly internalArgs: readonly string[]
  readonly env: Record<string, string>
  readonly cols: number
  readonly rows: number
  /** Which agent binary to launch. Absent = 'claude'. */
  readonly command?: LaunchCommand
}

export type DataListener = (id: Id, data: string, seq: number) => void
export type ExitListener = (id: Id, code: number | null) => void
export type StartListener = (id: Id) => void

function realPid(proc: IPty): number | null {
  return typeof proc.pid === 'number' && proc.pid > 0 ? proc.pid : null
}

function safeKill(proc: IPty): void {
  try {
    proc.kill()
  } catch {
    // The process already exited (killing a dead pty throws); the goal is reached.
  }
}

export class PtyManager {
  private readonly spawn: SpawnFn
  private readonly platform: NodeJS.Platform
  private readonly bufferLimit: number
  private readonly treeKiller: TreeKiller
  private readonly processes = new Map<Id, IPty>()
  private readonly buffers = new Map<Id, RingBuffer>()
  private readonly dataListeners = new Set<DataListener>()
  private readonly exitListeners = new Set<ExitListener>()
  private readonly startListeners = new Set<StartListener>()

  constructor(deps: PtyManagerDeps = {}) {
    this.spawn = deps.spawn ?? nodePtySpawn
    this.platform = deps.platform ?? process.platform
    this.bufferLimit = deps.bufferLimit ?? DEFAULT_LIMIT_CHARS
    this.treeKiller = deps.treeKiller ?? (deps.spawn ? NOOP_TREE_KILLER : createTreeKiller(this.platform))
  }

  start(opts: StartOptions): void {
    if (this.processes.has(opts.sessionId)) {
      throw new Error(`Session already running: ${opts.sessionId}`)
    }
    this.launch(opts, this.getOrCreateBuffer(opts.sessionId))
  }

  restart(opts: StartOptions): void {
    const previous = this.processes.get(opts.sessionId)
    if (previous) {
      this.terminateSync([previous])
    }
    const buffer = this.getOrCreateBuffer(opts.sessionId)
    buffer.clear()
    this.launch(opts, buffer)
  }

  onData(cb: DataListener): () => void {
    this.dataListeners.add(cb)
    return () => {
      this.dataListeners.delete(cb)
    }
  }

  onExit(cb: ExitListener): () => void {
    this.exitListeners.add(cb)
    return () => {
      this.exitListeners.delete(cb)
    }
  }

  /** Fires after every successful start (or restart): the listener pattern mirrors onExit. */
  onStart(cb: StartListener): () => void {
    this.startListeners.add(cb)
    return () => {
      this.startListeners.delete(cb)
    }
  }

  write(id: Id, data: string): void {
    const proc = this.processes.get(id)
    if (!proc) {
      throw new Error(`Session not running: ${id}`)
    }
    proc.write(data)
  }

  resize(id: Id, cols: number, rows: number): void {
    const proc = this.processes.get(id)
    if (!proc) {
      return
    }
    proc.resize(clampDim(cols), clampDim(rows))
  }

  /** Stops the session's process AND everything it started (a running command, a dev server...). */
  kill(id: Id): void {
    const proc = this.processes.get(id)
    if (!proc) return
    const pid = realPid(proc)
    if (pid === null) {
      proc.kill()
      return
    }
    // Tree first, while the parent is still alive (children are found through it); the plain kill is the backstop.
    this.treeKiller.killAsync([pid], () => safeKill(proc))
  }

  killAll(): void {
    this.terminateSync([...this.processes.values()])
  }

  /** Blocking tree kill for several processes at once (app quit, restart). */
  private terminateSync(procs: readonly IPty[]): void {
    const pids = procs.map(realPid).filter((pid): pid is number => pid !== null)
    this.treeKiller.killSync(pids)
    procs.forEach(safeKill)
  }

  replay(id: Id): PtyReplay {
    const buffer = this.buffers.get(id)
    if (!buffer) {
      return { data: '', seq: 0 }
    }
    return buffer.snapshot()
  }

  isRunning(id: Id): boolean {
    return this.processes.has(id)
  }

  dispose(): void {
    this.killAll()
    this.processes.clear()
    this.buffers.clear()
    this.dataListeners.clear()
    this.exitListeners.clear()
    this.startListeners.clear()
  }

  private getOrCreateBuffer(id: Id): RingBuffer {
    const existing = this.buffers.get(id)
    if (existing) {
      return existing
    }
    const buffer = new RingBuffer(this.bufferLimit)
    this.buffers.set(id, buffer)
    return buffer
  }

  private launch(opts: StartOptions, buffer: RingBuffer): void {
    this.validateCwd(opts.cwd)
    const id = opts.sessionId
    const { file, args } = buildCommandLaunch(this.platform, opts.command ?? 'claude', opts.claudeArgs, opts.internalArgs)
    const mergedEnv = {
      ...process.env,
      ...opts.env,
      TERM: TERM_NAME,
      COLORTERM: COLORTERM_VALUE
    }
    const sanitizedEnv = sanitizeChildEnv(mergedEnv)
    const options: IWindowsPtyForkOptions = {
      name: TERM_NAME,
      cwd: opts.cwd,
      env: sanitizedEnv,
      cols: clampDim(opts.cols),
      rows: clampDim(opts.rows),
      useConpty: this.platform === 'win32'
    }

    let proc: IPty
    try {
      proc = this.spawn(file, args, options)
    } catch (err) {
      throw new Error(toErrorMessage(err))
    }

    this.processes.set(id, proc)
    this.emitStart(id)

    proc.onData((data) => {
      if (this.processes.get(id) !== proc) {
        return
      }
      const seq = buffer.append(data)
      this.emitData(id, data, seq)
    })

    proc.onExit((event) => {
      if (this.processes.get(id) !== proc) {
        return
      }
      this.processes.delete(id)
      this.emitExit(id, event.exitCode)
    })
  }

  private validateCwd(cwd: string): void {
    let stats: ReturnType<typeof statSync>
    try {
      stats = statSync(cwd)
    } catch {
      throw new Error(`Directory not found: ${cwd}`)
    }
    if (!stats.isDirectory()) {
      throw new Error(`Directory not found: ${cwd}`)
    }
  }

  private emitData(id: Id, data: string, seq: number): void {
    for (const cb of this.dataListeners) {
      cb(id, data, seq)
    }
  }

  private emitStart(id: Id): void {
    for (const cb of this.startListeners) {
      cb(id)
    }
  }

  private emitExit(id: Id, code: number): void {
    for (const cb of this.exitListeners) {
      cb(id, code)
    }
  }
}

function clampDim(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_DIM
  }
  return Math.min(MAX_DIM, Math.max(MIN_DIM, Math.trunc(value)))
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
