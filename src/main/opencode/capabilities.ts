import { execFile, spawnSync } from 'node:child_process'
import type { OpencodeInfo } from '../../shared/types'

/**
 * OpenCode capabilities, detected from the installed CLI instead of its version number (installs are v1.x and v2.x,
 * and forks/rebuilds report arbitrary versions). `--standalone` (a private per-session server that honors this
 * process' injected plugin env) only exists on v2.x; v1.x prints help and exits when it gets the flag.
 */
export function parseSupportsStandalone(helpText: string): boolean {
  return helpText.includes('--standalone')
}

/** First version-looking token of `opencode --version` output (`2.1.4`, `1.4.0-beta.2`), or null when there is none (D74). */
export function parseOpencodeVersion(text: string): string | null {
  const match = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?)/.exec(text)
  return match === null ? null : match[1]
}

/** Runs one `opencode <arg>` probe: the combined output, or null when the process could not run (D74). */
export type OpencodeProbeRunner = (arg: '--help' | '--version') => Promise<string | null>

export interface OpencodeProbeResult {
  readonly version: string | null
  readonly supportsStandalone: boolean
}

const PROBE_TIMEOUT_MS = 8000
const PROBE_MAX_BUFFER = 1024 * 1024

/** `execFile` (never spawnSync), `shell: true` on win32 so `opencode.cmd` resolves like in the user's terminal. */
function defaultRunner(arg: '--help' | '--version'): Promise<string | null> {
  return new Promise((resolve): void => {
    const shell = process.platform === 'win32'
    // The argument is one of two literals, so building the shell command here is safe (no user text).
    const file = shell ? `opencode ${arg}` : 'opencode'
    const args = shell ? [] : [arg]
    try {
      execFile(
        file,
        args,
        { shell, timeout: PROBE_TIMEOUT_MS, windowsHide: true, encoding: 'utf8', maxBuffer: PROBE_MAX_BUFFER },
        (error, stdout, stderr): void => {
          if (error !== null) {
            resolve(null)
            return
          }
          resolve(`${stdout ?? ''}${stderr ?? ''}`)
        }
      )
    } catch {
      resolve(null)
    }
  })
}

let runner: OpencodeProbeRunner = defaultRunner

/** Cache: `checkedAt` 0 means no async probe finished yet (a sync fallback may still fill it). */
let cached: OpencodeInfo = { supportsStandalone: true, version: null, checkedAt: 0, probing: false }
/** Test override for the synchronous answer (`opencodeSupportsStandalone`). */
let supportsStandaloneOverride: boolean | undefined
let inFlight: Promise<OpencodeInfo> | null = null

/** Combines both probes. A probe that cannot run keeps the D72 rule (`--standalone` assumed) and no version. */
async function runProbe(): Promise<OpencodeProbeResult> {
  const [helpText, versionText] = await Promise.all([runner('--help'), runner('--version')])
  const supportsStandalone =
    helpText === null || helpText.trim().length === 0 ? true : parseSupportsStandalone(helpText)
  const version = versionText === null ? null : parseOpencodeVersion(versionText)
  return { supportsStandalone, version }
}

/**
 * Probes `opencode --help` and `opencode --version` off the main thread's critical path, updates the cache and
 * returns the new info (D74). Concurrent calls share one in-flight probe; it never rejects.
 */
export function probeOpencode(): Promise<OpencodeInfo> {
  if (inFlight !== null) return inFlight
  cached = { ...cached, probing: true }
  inFlight = runProbe()
    .then((result): OpencodeInfo => {
      cached = { ...result, checkedAt: Date.now(), probing: false }
      return { ...cached }
    })
    .catch((): OpencodeInfo => {
      // The D72 fallback: an unreadable CLI behaves like a v2 install.
      cached = { supportsStandalone: true, version: null, checkedAt: Date.now(), probing: false }
      return { ...cached }
    })
    .finally((): void => {
      inFlight = null
    })
  return inFlight
}

/** The cache as a snapshot. Never blocks and never starts a probe (D74). */
export function getOpencodeInfo(): OpencodeInfo {
  return { ...cached }
}

/** Drops the cached answer and probes again (Settings > Agents "Re-check", D74). */
export function recheckOpencode(): Promise<OpencodeInfo> {
  cached = { supportsStandalone: true, version: null, checkedAt: 0, probing: inFlight !== null }
  return probeOpencode()
}

/** Fire-and-forget warm-up at app start, so the first OpenCode session finds an answer (D74). */
export function warmOpencodeProbe(): void {
  void probeOpencode().catch((): void => undefined)
}

/** The synchronous probe blocks the MAIN thread, so it gets a much shorter leash than the async one (review fix). */
const SYNC_PROBE_TIMEOUT_MS = 3000

/**
 * Synchronous probe kept for a session launched before the async warm-up finished (D72 behaviour). Returns null when the
 * probe could not give an answer (it timed out, the CLI is missing, empty output): the caller uses the D72 default for that
 * launch but does NOT store it, so one failed probe cannot fix a wrong answer for the whole run.
 */
function detectSupportsStandaloneSync(): boolean | null {
  try {
    const shell = process.platform === 'win32'
    const result = shell
      ? spawnSync('opencode --help', { shell: true, timeout: SYNC_PROBE_TIMEOUT_MS, windowsHide: true, encoding: 'utf8' })
      : spawnSync('opencode', ['--help'], { timeout: SYNC_PROBE_TIMEOUT_MS, windowsHide: true, encoding: 'utf8' })
    if (result.error !== undefined) return null
    const helpText = `${result.stdout ?? ''}${result.stderr ?? ''}`
    if (helpText.trim().length === 0) return null
    return parseSupportsStandalone(helpText)
  } catch {
    return null
  }
}

/**
 * Whether the installed `opencode` accepts `--standalone`. A finished probe or a test override answers from the
 * cache; otherwise (nothing probed yet) the synchronous probe runs; only a REAL answer is stored (D72/D74).
 */
export function opencodeSupportsStandalone(): boolean {
  if (supportsStandaloneOverride !== undefined) return supportsStandaloneOverride
  if (cached.checkedAt > 0) return cached.supportsStandalone
  const answer = detectSupportsStandaloneSync()
  if (answer === null) return true
  cached = { ...cached, supportsStandalone: answer, checkedAt: Date.now() }
  return answer
}

/** Clears the cache, the in-flight probe and the test seams (tests only). */
export function resetOpencodeCapabilitiesForTests(): void {
  cached = { supportsStandalone: true, version: null, checkedAt: 0, probing: false }
  supportsStandaloneOverride = undefined
  inFlight = null
  runner = defaultRunner
}

/** Forces the cached probe result (`undefined` clears it), so tests never spawn the real CLI (tests only). */
export function setOpencodeSupportsStandaloneForTests(v: boolean | undefined): void {
  supportsStandaloneOverride = v
}

/** Replaces the process runner so tests never spawn the real CLI (tests only). */
export function setOpencodeRunnerForTests(fn: OpencodeProbeRunner): void {
  runner = fn
}
