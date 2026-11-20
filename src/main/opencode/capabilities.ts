import { spawnSync } from 'node:child_process'

/**
 * OpenCode capabilities, detected from the installed CLI instead of its version number (installs are v1.x and v2.x,
 * and forks/rebuilds report arbitrary versions). `--standalone` (a private per-session server that honors this
 * process' injected plugin env) only exists on v2.x; v1.x prints help and exits when it gets the flag.
 */
export function parseSupportsStandalone(helpText: string): boolean {
  return helpText.includes('--standalone')
}

/** Cached answer: `undefined` until the first detection, then the flag support. */
let cachedSupportsStandalone: boolean | undefined

/**
 * Detects `--standalone` support by running `opencode --help` once (spawnSync, so the first launch waits for it).
 * `shell: true` on win32 so `opencode.cmd` resolves like it does in the user's terminal. When the probe cannot run
 * (not installed yet, timeout, empty output) the answer is `true`, which keeps the previous launch behaviour.
 */
function detectSupportsStandalone(): boolean {
  try {
    const shell = process.platform === 'win32'
    const result = shell
      ? spawnSync('opencode --help', { shell: true, timeout: 8000, windowsHide: true, encoding: 'utf8' })
      : spawnSync('opencode', ['--help'], { timeout: 8000, windowsHide: true, encoding: 'utf8' })
    if (result.error !== undefined) return true
    const helpText = `${result.stdout ?? ''}${result.stderr ?? ''}`
    if (helpText.trim().length === 0) return true
    return parseSupportsStandalone(helpText)
  } catch {
    return true
  }
}

/** Whether the installed `opencode` accepts `--standalone` (probed once, cached for the process). */
export function opencodeSupportsStandalone(): boolean {
  if (cachedSupportsStandalone === undefined) cachedSupportsStandalone = detectSupportsStandalone()
  return cachedSupportsStandalone
}

/** Clears the cached probe so the next call runs `opencode --help` again (tests only). */
export function resetOpencodeCapabilitiesForTests(): void {
  cachedSupportsStandalone = undefined
}

/** Forces the cached probe result (`undefined` clears it), so tests never spawn the real CLI (tests only). */
export function setOpencodeSupportsStandaloneForTests(v: boolean | undefined): void {
  cachedSupportsStandalone = v
}
