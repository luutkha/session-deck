// D92: is an extra agent CLI (shared/cliAgents.ts) installed? A session start must fail with a clear message instead of
// a terminal that prints "not recognized" and closes. Not cached: the user may install the CLI while the app runs.
import { execFileSync } from 'node:child_process'
import type { CliCommand } from '../pty/launch'

/** How one binary name is probed: true when the command exists on PATH. Injected in tests (never spawns there). */
export type CommandProbe = (command: string) => boolean

const PROBE_TIMEOUT_MS = 3000
/** Registry commands are plain names (checked by the registry test), so the shell string cannot be abused. */
const SAFE_COMMAND = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function defaultProbe(command: string): boolean {
  if (!SAFE_COMMAND.test(command)) return false
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

let probe: CommandProbe = defaultProbe

/** Test seam: replace the PATH probe (null restores the real one). */
export function setCommandProbeForTests(next: CommandProbe | null): void {
  probe = next ?? defaultProbe
}

/** The registry command as a launchable type; throws for anything but a plain program name. */
export function asCliCommand(command: string): CliCommand {
  if (!SAFE_COMMAND.test(command)) throw new Error(`Unsafe agent command: ${command}`)
  return command as CliCommand
}

export function commandOnPath(command: string): boolean {
  return probe(command)
}
