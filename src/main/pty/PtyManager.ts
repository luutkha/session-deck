import { spawn as nodePtySpawn } from 'node-pty'
import type { IPty, IWindowsPtyForkOptions } from 'node-pty'
import { statSync } from 'node:fs'
import type { Id } from '../../shared/types'
import type { PtyReplay } from '../../shared/ipc'
import { RingBuffer, DEFAULT_LIMIT_CHARS } from './RingBuffer'
import { buildCommandLaunch, type LaunchCommand } from './launch'
import { createTreeKiller, NOOP_TREE_KILLER, type TreeKiller } from './treeKiller'
import { errorMessage } from '../../shared/guards'

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

type TimerHandle = ReturnType<typeof setTimeout>

/** One flushed batch is appended/emitted as a whole; bigger batches wait no longer. */
export const FLUSH_THRESHOLD_CHARS = 65_536
export const DEFAULT_FLUSH_DELAY_MS = 16

export interface PtyManagerDeps {
  readonly spawn?: SpawnFn
  readonly platform?: NodeJS.Platform
  readonly bufferLimit?: number
  /** How processes are stopped. Defaults to a real process-tree killer, or a no-op when fake PTYs are injected. */
  readonly treeKiller?: TreeKiller
  /** How long output is batched before one append/emit. Per session: hidden terminals can wait longer. */
  readonly flushDelayMs?: (id: Id) => number
  /** Timer seams so tests control time. Defaults to setTimeout/clearTimeout. */
  readonly setTimer?: (callback: () => void, ms: number) => TimerHandle
  readonly clearTimer?: (handle: TimerHandle) => void
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

/** Output that has arrived but is not yet appended/emitted (batched per session). */
interface PendingOutput {
  readonly chunks: string[]
  chars: number
  timer: TimerHandle | null
}

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
  private readonly flushDelayMs: (id: Id) => number
  private readonly setTimer: (callback: () => void, ms: number) => TimerHandle
  private readonly clearTimer: (handle: TimerHandle) => void
  private readonly processes = new Map<Id, IPty>()
  private readonly buffers = new Map<Id, RingBuffer>()
  private readonly pending = new Map<Id, PendingOutput>()
  // Ids whose replay state was freed by forget(): late output from a dying, already-removed process is ignored.
  private readonly forgotten = new Set<Id>()
  private readonly dataListeners = new Set<DataListener>()
  private readonly exitListeners = new Set<ExitListener>()
  private readonly startListeners = new Set<StartListener>()

  constructor(deps: PtyManagerDeps = {}) {
    this.spawn = deps.spawn ?? nodePtySpawn
    this.platform = deps.platform ?? process.platform
    this.bufferLimit = deps.bufferLimit ?? DEFAULT_LIMIT_CHARS
    this.treeKiller = deps.treeKiller ?? (deps.spawn ? NOOP_TREE_KILLER : createTreeKiller(this.platform))
    this.flushDelayMs = deps.flushDelayMs ?? (() => DEFAULT_FLUSH_DELAY_MS)
    this.setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms))
    this.clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle))
  }

  start(opts: StartOptions): void {
    if (this.processes.has(opts.sessionId)) {
      throw new Error(`Session already running: ${opts.sessionId}`)
    }
    this.forgotten.delete(opts.sessionId)
    this.getOrCreateBuffer(opts.sessionId)
    this.launch(opts)
  }

  restart(opts: StartOptions): void {
    this.forgotten.delete(opts.sessionId)
    // Emit what the old process already printed before the buffer is cleared.
    this.flush(opts.sessionId)
    const previous = this.processes.get(opts.sessionId)
    if (previous) {
      this.terminateSync([previous])
    }
    const buffer = this.getOrCreateBuffer(opts.sessionId)
    buffer.clear()
    this.launch(opts)
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
    // Never lose output the old process already produced.
    this.flush(id)
    const proc = this.processes.get(id)
    if (!proc) return
    const pid = realPid(proc)
    if (pid === null) {
      safeKill(proc)
      return
    }
    // Tree first, while the parent is still alive (children are found through it); the plain kill is the backstop.
    this.treeKiller.killAsync([pid], () => safeKill(proc))
  }

  killAll(): void {
    this.flushAll()
    this.terminateSync([...this.processes.values()])
  }

  /** Blocking tree kill for several processes at once (app quit, restart). */
  private terminateSync(procs: readonly IPty[]): void {
    const pids = procs.map(realPid).filter((pid): pid is number => pid !== null)
    this.treeKiller.killSync(pids)
    procs.forEach(safeKill)
  }

  replay(id: Id): PtyReplay {
    if (this.forgotten.has(id)) {
      return { data: '', seq: 0 }
    }
    // A hydration must never miss output that is still sitting in the batch.
    this.flush(id)
    const buffer = this.buffers.get(id)
    if (!buffer) {
      return { data: '', seq: 0 }
    }
    return buffer.snapshot()
  }

  /**
   * Frees the replay state of a session that was REMOVED (not merely exited). Does not kill a process: the caller
   * stops it first; the forgotten guard keeps its dying process from rebuilding the buffer via late output.
   */
  forget(id: Id): void {
    this.forgotten.add(id)
    const pending = this.pending.get(id)
    if (pending) {
      if (pending.timer !== null) {
        this.clearTimer(pending.timer)
      }
      this.pending.delete(id)
    }
    this.buffers.delete(id)
  }

  /** Appends + emits this session's batched output now (one append, one emitData). No-op when nothing is pending. */
  flush(id: Id): void {
    if (this.forgotten.has(id)) {
      return
    }
    const pending = this.pending.get(id)
    if (!pending) {
      return
    }
    this.pending.delete(id)
    if (pending.timer !== null) {
      this.clearTimer(pending.timer)
      pending.timer = null
    }
    if (pending.chars === 0) {
      return
    }
    const data = pending.chunks.join('')
    const seq = this.getOrCreateBuffer(id).append(data)
    this.emitData(id, data, seq)
  }

  isRunning(id: Id): boolean {
    return this.processes.has(id)
  }

  /** The terminal size of a running session (D53 read_screen), or null when it is not running. */
  size(id: Id): { readonly cols: number; readonly rows: number } | null {
    const proc = this.processes.get(id)
    return proc ? { cols: proc.cols, rows: proc.rows } : null
  }

  dispose(): void {
    // killAll flushes pending output first, so nothing is lost on quit.
    this.killAll()
    this.pending.clear()
    this.processes.clear()
    this.buffers.clear()
    this.forgotten.clear()
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

  private launch(opts: StartOptions): void {
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
      throw new Error(errorMessage(err))
    }

    this.processes.set(id, proc)
    this.emitStart(id)

    proc.onData((data) => {
      if (this.processes.get(id) !== proc) {
        return
      }
      this.queueOutput(id, data)
    })

    proc.onExit((event) => {
      if (this.processes.get(id) !== proc) {
        return
      }
      // The last output must reach listeners (and the replay buffer) before the exit event.
      this.flush(id)
      this.processes.delete(id)
      this.emitExit(id, event.exitCode)
    })
  }

  private queueOutput(id: Id, data: string): void {
    if (this.forgotten.has(id)) {
      return
    }
    let pending = this.pending.get(id)
    if (!pending) {
      pending = { chunks: [], chars: 0, timer: null }
      this.pending.set(id, pending)
    }
    pending.chunks.push(data)
    pending.chars += data.length
    if (pending.chars >= FLUSH_THRESHOLD_CHARS) {
      this.flush(id)
      return
    }
    if (pending.timer === null) {
      pending.timer = this.setTimer(() => {
        // A manual flush/exit may already have taken this batch.
        if (this.pending.get(id) === pending) {
          pending.timer = null
          this.flush(id)
        }
      }, this.flushDelayMs(id))
    }
  }

  private flushAll(): void {
    for (const id of [...this.pending.keys()]) {
      this.flush(id)
    }
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

