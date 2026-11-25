// Slice G3 (D86): main-side self-diagnostics. Every OS touch is injected so a report can be built in a unit test;
// defaultProbeTool is the real execFile-based probe main passes in. The report never contains prompts or file contents.
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { DiagnosticDir, DiagnosticTool, DiagnosticsReport } from '../../shared/types'
import { MAIN_ERROR_LOG_FILE } from './errorLog'

// Re-exported so a main-process caller only needs this module.
export type { DiagnosticDir, DiagnosticTool, DiagnosticsReport } from '../../shared/types'

/** Tools shown in the report, in display order. */
export const DIAGNOSTIC_TOOLS = ['claude', 'opencode', 'cursor-agent', 'git', 'gh', 'node'] as const

/** How many error-log lines and how much of each line the report may carry. */
export const MAX_LOG_TAIL_LINES = 60
export const MAX_LOG_LINE_CHARS = 500

/** A probe that hangs longer than this is reported as not found instead of blocking the report. */
export const DEFAULT_PROBE_TIMEOUT_MS = 3000
/** Separate 3 s cap for the real `<tool> --version` child process. */
const VERSION_TIMEOUT_MS = 3000

const REDACTED = '[redacted]'

/** Provider-style keys, GitHub tokens, bearer headers, key=value secrets, then broad hex/base64 runs. */
const SK_TOKEN_RE = /\b(?:sk-|sk_live_|sk_test_)[A-Za-z0-9_-]{6,}/g
const GH_TOKEN_RE = /\bghp_[A-Za-z0-9]{16,}\b/g
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi
const KEY_VALUE_RE = /(\b(?:password|passwd|token|secret|api[_-]?key|key)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi
const HEX_RUN_RE = /\b[A-Fa-f0-9]{32,}={0,2}(?![A-Za-z0-9+/=])/g
const BASE64_RUN_RE = /\b[A-Za-z0-9+/]{32,}={0,2}(?![A-Za-z0-9+/=])/g

export interface DiagnosticsAppInfo {
  readonly version: string
  readonly electron: string
  readonly chrome: string
  readonly node: string
  readonly platform: string
  readonly arch: string
}

/** What one probe learned about a tool. An empty result means "not installed". */
export interface DiagnosticsProbeResult {
  readonly path?: string
  readonly version?: string
}

export interface DiagnosticsDeps {
  readonly appInfo: DiagnosticsAppInfo
  readonly probeTool: (name: string) => Promise<DiagnosticsProbeResult>
  readonly dirs: readonly { readonly name: string; readonly path: string }[]
  readonly pathExists: (path: string) => boolean
  /** Returns the last lines of <userData>/main-errors.log, oldest first. */
  readonly readLogTail: (maxLines: number) => readonly string[]
  readonly now: () => number
  readonly probeTimeoutMs?: number
  /** Injected in tests; defaults to os.homedir() so the report can hide the user's folder prefix. */
  readonly homeDir?: string
}

/** Path of the error log the injected readLogTail should tail (written by errorLog.ts). */
export function errorLogPath(userDataDir: string): string {
  return join(userDataDir, MAIN_ERROR_LOG_FILE)
}

/** Matches the home folder with either separator style, case-insensitively where paths are case-insensitive. */
function homeRegExp(homeDir: string): RegExp | null {
  const trimmed = homeDir.trim().replace(/[\\/]+$/, '')
  if (trimmed.length === 0) return null
  const escaped = trimmed
    .replace(/[\\/]+/g, '/')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\//g, '[\\\\/]')
  return new RegExp(escaped, process.platform === 'win32' ? 'gi' : 'g')
}

/**
 * Removes anything that could be a credential or identify the user's account folder from one log line.
 * Specific patterns run before the broad hex/base64 runs so their `[redacted]` marker stays intact.
 */
export function redactLine(line: string, homeDir: string): string {
  const home = homeRegExp(homeDir)
  const text = typeof line === 'string' ? line : String(line ?? '')
  const withoutHome = home === null ? text : text.replace(home, '~')
  return withoutHome
    .replace(BEARER_RE, REDACTED)
    .replace(SK_TOKEN_RE, REDACTED)
    .replace(GH_TOKEN_RE, REDACTED)
    .replace(KEY_VALUE_RE, `$1${REDACTED}`)
    .replace(HEX_RUN_RE, REDACTED)
    .replace(BASE64_RUN_RE, REDACTED)
}

/** First non-empty line of a child's stdout, or undefined when it printed nothing usable. */
function firstLine(text: string): string | undefined {
  const line = text.split(/\r?\n/, 1)[0]?.trim() ?? ''
  return line.length > 0 ? line : undefined
}

const execFileAsync = promisify(execFile)

async function runProbe(file: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(file, args, { timeout: VERSION_TIMEOUT_MS, windowsHide: true })
    return firstLine(stdout)
  } catch {
    // Not installed, timed out or refused: a missing path/version is all the report needs to know.
    return undefined
  }
}

/** Real tool probe: locate the binary without a shell, then ask it for its version (first line only). */
export async function defaultProbeTool(name: string): Promise<DiagnosticsProbeResult> {
  const locator = process.platform === 'win32' ? 'where' : 'which'
  const path = await runProbe(locator, [name])
  if (path === undefined) return {}
  const version = await runProbe(name, ['--version'])
  return version === undefined ? { path } : { path, version }
}

function toTool(name: string, result: DiagnosticsProbeResult | null | undefined): DiagnosticTool {
  const path = typeof result?.path === 'string' && result.path.trim().length > 0 ? result.path : undefined
  const version = typeof result?.version === 'string' && result.version.trim().length > 0 ? result.version : undefined
  if (path === undefined && version === undefined) return { name, found: false }
  return {
    name,
    found: true,
    ...(path !== undefined ? { path } : {}),
    ...(version !== undefined ? { version } : {})
  }
}

/** Runs one probe with a deadline. Never rejects, and never settles twice. */
function probeWithTimeout(
  name: string,
  probe: DiagnosticsDeps['probeTool'],
  timeoutMs: number
): Promise<DiagnosticTool> {
  return new Promise((resolve) => {
    let done = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (tool: DiagnosticTool): void => {
      if (done) return
      done = true
      if (timer !== undefined) clearTimeout(timer)
      resolve(tool)
    }
    timer = setTimeout(() => finish({ name, found: false }), timeoutMs)
    Promise.resolve()
      .then(() => probe(name))
      .then((result) => finish(toTool(name, result)))
      .catch(() => finish({ name, found: false }))
  })
}

function safeExists(pathExists: DiagnosticsDeps['pathExists'], path: string): boolean {
  try {
    return pathExists(path) === true
  } catch {
    return false
  }
}

function safeNow(now: DiagnosticsDeps['now']): number {
  try {
    const value = now()
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

function buildLogTail(deps: DiagnosticsDeps, homeDir: string): readonly string[] {
  try {
    const lines = deps.readLogTail(MAX_LOG_TAIL_LINES) ?? []
    return lines
      .slice(-MAX_LOG_TAIL_LINES)
      .map((line) => redactLine(line, homeDir).slice(0, MAX_LOG_LINE_CHARS))
  } catch {
    // A missing or locked log is normal; the rest of the report is still useful.
    return []
  }
}

/** Builds the report builder. Call the returned function whenever the user opens Settings > Diagnostics. */
export function createDiagnostics(deps: DiagnosticsDeps): () => Promise<DiagnosticsReport> {
  const timeoutMs = deps.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
  const homeDir = deps.homeDir ?? homedir()
  return async () => {
    // All probes start together: a slow CLI must not add its latency to the other five.
    const tools = await Promise.all(DIAGNOSTIC_TOOLS.map((name) => probeWithTimeout(name, deps.probeTool, timeoutMs)))
    const dirs: DiagnosticDir[] = deps.dirs.map((dir) => ({
      name: dir.name,
      path: dir.path,
      exists: safeExists(deps.pathExists, dir.path)
    }))
    return {
      generatedAt: safeNow(deps.now),
      app: {
        version: deps.appInfo.version,
        electron: deps.appInfo.electron,
        chrome: deps.appInfo.chrome,
        node: deps.appInfo.node,
        platform: deps.appInfo.platform,
        arch: deps.appInfo.arch
      },
      tools,
      dirs,
      logTail: buildLogTail(deps, homeDir)
    }
  }
}
