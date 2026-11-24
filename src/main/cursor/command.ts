// Cursor CLI (D81): which binary starts a session, and the install hint shown when neither is found.
//
// Cursor installs both `cursor-agent` and `agent` (as .cmd files on Windows). `agent` is a generic name that another
// tool may own, so it is only the fallback. Detection is cached: a session start must not pay for two probes.
import { execFileSync } from 'node:child_process'

export type CursorCommand = 'cursor-agent' | 'agent'

/** How one binary name is probed: true when the command exists on PATH. Injected in tests (never spawns there). */
export type CursorCommandRunner = (command: CursorCommand) => boolean

const PROBE_TIMEOUT_MS = 3000

/** `where` on Windows, `command -v` elsewhere. The command is one of two literals, so the shell string is safe. */
function defaultRunner(command: CursorCommand): boolean {
  try {
    if (process.platform === 'win32') {
      execFileSync('where', [command], { stdio: 'ignore', timeout: PROBE_TIMEOUT_MS, windowsHide: true })
    } else {
      execFileSync('sh', ['-c', `command -v ${command}`], { stdio: 'ignore', timeout: PROBE_TIMEOUT_MS })
    }
    return true
  } catch {
    return false
  }
}

/** Shown when no Cursor CLI is installed; a Windows-first app, so the platform picks the command. */
export const CURSOR_INSTALL_HINT =
  process.platform === 'win32'
    ? "Install it with: irm 'https://cursor.com/install?win32=true' | iex"
    : 'Install it with: curl https://cursor.com/install -fsS | bash'

let runner: CursorCommandRunner = defaultRunner
/** undefined = not probed yet; null = probed and neither binary was found. */
let cached: CursorCommand | null | undefined

/** Test seam: replace the PATH probe (null restores the real one) and forget the cached answer. */
export function setCursorCommandRunnerForTests(next: CursorCommandRunner | null): void {
  runner = next ?? defaultRunner
  cached = undefined
}

/** Forget the cached answer so the next detectCursorCommand() probes PATH again. */
export function resetCursorCommandCache(): void {
  cached = undefined
}

/** `cursor-agent` when present, else `agent`, else null. Cached until resetCursorCommandCache(). */
export function detectCursorCommand(): CursorCommand | null {
  if (cached !== undefined) return cached
  cached = runner('cursor-agent') ? 'cursor-agent' : runner('agent') ? 'agent' : null
  return cached
}
