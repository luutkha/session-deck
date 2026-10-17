import { execFile, execFileSync } from 'node:child_process'

/**
 * Stops a process AND everything it started. node-pty's `kill()` only ends the top process: on Windows the
 * children (for example the shell command Claude is running: powershell.exe -> PING.EXE, a dev server, a test
 * run) are orphaned and keep running after a session is closed.
 */
export interface TreeKiller {
  /** Kills the processes and all their descendants, then calls `done` (also when they were already gone). */
  killAsync(pids: readonly number[], done: () => void): void
  /** Same, blocking. Used while the app is quitting, when an async kill might not finish before exit. */
  killSync(pids: readonly number[]): void
}

/** For unit tests that inject fake PTYs: never touches real processes. */
export const NOOP_TREE_KILLER: TreeKiller = {
  killAsync: (_pids, done): void => done(),
  killSync: (): void => undefined
}

export interface TreeKillerDeps {
  readonly execFile?: typeof execFile
  readonly execFileSync?: typeof execFileSync
  readonly kill?: (pid: number, signal: NodeJS.Signals) => void
}

const TASKKILL = 'taskkill'
const SYNC_TIMEOUT_MS = 5000

/** `taskkill /PID a /PID b /T /F`: /T = the whole tree, /F = force. Must run while the parents are still alive. */
export function taskkillArgs(pids: readonly number[]): readonly string[] {
  return [...pids.flatMap((pid) => ['/PID', String(pid)]), '/T', '/F']
}

export function createTreeKiller(platform: NodeJS.Platform, deps: TreeKillerDeps = {}): TreeKiller {
  if (platform === 'win32') {
    const run = deps.execFile ?? execFile
    const runSync = deps.execFileSync ?? execFileSync
    return {
      killAsync(pids, done): void {
        if (pids.length === 0) {
          done()
          return
        }
        // taskkill exits non-zero when a process is already gone; that is the goal, so the result is not an error.
        run(TASKKILL, [...taskkillArgs(pids)], { windowsHide: true }, () => done())
      },
      killSync(pids): void {
        if (pids.length === 0) return
        try {
          runSync(TASKKILL, [...taskkillArgs(pids)], { windowsHide: true, stdio: 'ignore', timeout: SYNC_TIMEOUT_MS })
        } catch {
          // Non-zero exit = some processes were already gone. Nothing left to do either way.
        }
      }
    }
  }

  // POSIX: node-pty starts every pty as its own session, so signalling the negative pid reaches the whole group.
  const kill = deps.kill ?? ((pid: number, signal: NodeJS.Signals): void => { process.kill(pid, signal) })
  const killGroup = (pid: number): void => {
    for (const target of [-pid, pid]) {
      try {
        kill(target, 'SIGKILL')
      } catch {
        // ESRCH: the group/process is already gone.
      }
    }
  }
  return {
    killAsync(pids, done): void {
      pids.forEach(killGroup)
      done()
    },
    killSync(pids): void {
      pids.forEach(killGroup)
    }
  }
}
