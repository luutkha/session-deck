import { open, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Id, WorkerInfo } from '../../shared/types'
import { appendLogChunk, EMPTY_LOG_STATE, type WorkerLogState } from './logParser'
import { candidateDirs, parseRegistration, runPhase } from './registration'

export const WORKER_POLL_MS = 1000
/** First read of a big log starts this far from its end (the cut first line is skipped by the parser). */
const MAX_INITIAL_READ_BYTES = 2 * 1024 * 1024
/** Finished workers are forgotten by the watcher after this long (the UI hides them much sooner). */
const FORGET_FINISHED_MS = 30 * 60 * 1000

export interface WatchedSession {
  readonly id: Id
  readonly cwd: string
}

export interface WorkerWatcherDeps {
  readonly getSessions: () => readonly WatchedSession[]
  readonly onChange: (workers: readonly WorkerInfo[]) => void
  readonly onError: (where: string, error: unknown) => void
  readonly now: () => number
  readonly pollMs?: number
}

export interface WorkerWatcher {
  start(): void
  stop(): void
  /** One scan; resolves when done. Exposed for tests and the first read after start. */
  pollOnce(): Promise<void>
  getWorkers(): readonly WorkerInfo[]
}

interface Tracked {
  readonly info: WorkerInfo
  readonly log: WorkerLogState
  readonly offset: number
  readonly logPath: string
}

function dirKey(dir: string): string {
  return path.resolve(dir).toLowerCase()
}

/** Folder -> ids of the sessions that look at it. */
export function ownersByDir(sessions: readonly WatchedSession[]): Map<string, { dir: string; owners: Id[] }> {
  const map = new Map<string, { dir: string; owners: Id[] }>()
  for (const session of sessions) {
    for (const dir of candidateDirs(session.cwd)) {
      const key = dirKey(dir)
      const entry = map.get(key)
      if (entry === undefined) map.set(key, { dir, owners: [session.id] })
      else if (!entry.owners.includes(session.id)) entry.owners.push(session.id)
    }
  }
  return map
}

/** Folders never worth looking into for a registry. */
const SKIP_CHILD = new Set(['node_modules', '.git', 'out', 'dist', 'build', 'release', 'reference'])

/** Adds each session's immediate subfolders: a batch is often started in a project folder but runs inside a subfolder. */
async function addChildDirs(
  map: Map<string, { dir: string; owners: Id[] }>,
  sessions: readonly WatchedSession[]
): Promise<void> {
  for (const session of sessions) {
    let entries
    try {
      entries = await readdir(session.cwd, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP_CHILD.has(entry.name)) continue
      const dir = path.join(session.cwd, entry.name)
      const key = dirKey(dir)
      const found = map.get(key)
      if (found === undefined) map.set(key, { dir, owners: [session.id] })
      else if (!found.owners.includes(session.id)) found.owners.push(session.id)
    }
  }
}

async function readNew(logPath: string, offset: number, size: number): Promise<{ text: string; next: number }> {
  const from = offset === 0 && size > MAX_INITIAL_READ_BYTES ? size - MAX_INITIAL_READ_BYTES : offset
  const length = size - from
  if (length <= 0) return { text: '', next: size }
  const handle = await open(logPath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, from)
    return { text: buffer.toString('utf8', 0, bytesRead), next: from + bytesRead }
  } finally {
    await handle.close()
  }
}

async function statOrNull(file: string): Promise<{ mtimeMs: number; size: number } | null> {
  try {
    const s = await stat(file)
    return { mtimeMs: s.mtimeMs, size: s.size }
  } catch {
    return null
  }
}

function signature(workers: readonly WorkerInfo[]): string {
  return workers
    .map((w) => `${w.id}|${w.status}|${w.statusDetail}|${w.lines.length}|${w.costUsd}|${w.tokens}|${w.ownerSessionIds.join(',')}`)
    .join('\n')
}

/**
 * Finds OpenCode workers that Claude sessions started in the background. The runner registers every worker in
 * `<folder>/.opencode-runs/sessions/<name>.json` and streams its events to a JSONL log; this watcher polls those
 * files for the folders of the open sessions and turns them into read-only WorkerInfo snapshots. Workers that had
 * already finished before the app started are ignored.
 */
export function createWorkerWatcher(deps: WorkerWatcherDeps): WorkerWatcher {
  const startedAt = deps.now()
  const tracked = new Map<string, Tracked>()
  let timer: NodeJS.Timeout | null = null
  let polling = false
  let lastSignature = ''

  async function scanDir(dir: string, owners: readonly Id[], seen: Set<string>): Promise<void> {
    const runsDir = path.join(dir, '.opencode-runs')
    const registryDir = path.join(runsDir, 'sessions')
    let names: string[]
    try {
      names = (await readdir(registryDir)).filter((n) => n.toLowerCase().endsWith('.json'))
    } catch {
      return // no registry here
    }
    for (const file of names) {
      await scanRegistration(path.join(registryDir, file), file.slice(0, -5), runsDir, dir, owners, seen)
    }
  }

  async function scanRegistration(
    file: string,
    name: string,
    runsDir: string,
    dir: string,
    owners: readonly Id[],
    seen: Set<string>
  ): Promise<void> {
    const regStat = await statOrNull(file)
    if (regStat === null) return
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch {
      return
    }
    const reg = parseRegistration(text, runsDir)
    if (reg === null) return
    const logStat = await statOrNull(reg.log)
    const lastChange = Math.max(regStat.mtimeMs, logStat?.mtimeMs ?? 0)
    const phase = runPhase(reg, lastChange, deps.now())
    const id = `${reg.sessionID}:${path.basename(reg.log)}`
    const known = tracked.get(id)
    // Runs that were already over before SessionDeck started are history, not news.
    if (known === undefined && phase.status !== 'running' && lastChange < startedAt) return
    seen.add(id)

    let log = known?.log ?? EMPTY_LOG_STATE
    let offset = known?.offset ?? 0
    if (logStat !== null && logStat.size < offset) {
      log = EMPTY_LOG_STATE
      offset = 0
    }
    if (logStat !== null && logStat.size > offset) {
      try {
        const chunk = await readNew(reg.log, offset, logStat.size)
        log = appendLogChunk(log, chunk.text)
        offset = chunk.next
      } catch (error) {
        deps.onError('workers: read log', error)
      }
    }
    const finished = phase.status !== 'running'
    const finishedAt = finished ? known?.info.finishedAt ?? lastChange : null
    const info: WorkerInfo = {
      id,
      name,
      model: reg.model,
      status: phase.status,
      statusDetail: phase.detail,
      startedAt: log.firstAt ?? known?.info.startedAt ?? lastChange,
      finishedAt,
      costUsd: log.costUsd,
      tokens: log.tokens,
      dir,
      ownerSessionIds: owners,
      lines: log.lines
    }
    tracked.set(id, { info, log, offset, logPath: reg.log })
  }

  function snapshot(): readonly WorkerInfo[] {
    return [...tracked.values()].map((t) => t.info).sort((a, b) => a.startedAt - b.startedAt)
  }

  async function pollOnce(): Promise<void> {
    if (polling) return
    polling = true
    try {
      const seen = new Set<string>()
      const sessions = deps.getSessions()
      const folders = ownersByDir(sessions)
      await addChildDirs(folders, sessions)
      for (const { dir, owners } of folders.values()) {
        await scanDir(dir, owners, seen)
      }
      const now = deps.now()
      for (const [id, entry] of tracked) {
        const gone = !seen.has(id)
        const old = entry.info.finishedAt !== null && now - entry.info.finishedAt > FORGET_FINISHED_MS
        if (gone || old) tracked.delete(id)
      }
      const workers = snapshot()
      const sig = signature(workers)
      if (sig !== lastSignature) {
        lastSignature = sig
        deps.onChange(workers)
      }
    } catch (error) {
      deps.onError('workers: poll', error)
    } finally {
      polling = false
    }
  }

  return {
    start(): void {
      if (timer !== null) return
      void pollOnce()
      timer = setInterval(() => void pollOnce(), deps.pollMs ?? WORKER_POLL_MS)
    },
    stop(): void {
      if (timer !== null) clearInterval(timer)
      timer = null
    },
    pollOnce,
    getWorkers: snapshot
  }
}
