// Pure formatting for Settings > Diagnostics (G6). No DOM, no IPC: the section and its tests share these rules.
import type { DiagnosticDir, DiagnosticTool, DiagnosticsReport } from '../../shared/types'

/** git is the only tool the app cannot run without; the rest are optional conveniences. */
export const REQUIRED_TOOL_NAME = 'git'
export const OPTIONAL_TOOL_NAMES: readonly string[] = ['claude', 'opencode', 'cursor-agent', 'gh']
/** The Cursor config is only needed for Cursor sessions, so its absence is not a broken setup. */
export const OPTIONAL_DIR_NAME = 'Cursor config'

export const CHECKING_TEXT = 'Checking...'
export const ALL_OK_TEXT = 'Everything needed is here'
export const NOT_FOUND_TEXT = 'NOT FOUND'
export const LOG_TAIL_HEADING = 'Log tail:'
export const EMPTY_LOG_TEXT = '(empty)'

export interface HealthSummary {
  ok: boolean
  problems: string[]
}

/** One line for a tool, e.g. `gh: NOT FOUND` or `claude: found C:\path (1.2.3)`. */
export function toolStatusLabel(tool: DiagnosticTool): string {
  if (!tool.found) return NOT_FOUND_TEXT
  const location = tool.path?.trim().length === 0 || tool.path === undefined ? 'unknown path' : tool.path
  const version = tool.version?.trim() ?? ''
  return `found ${location}${version.length > 0 ? ` (${version})` : ''}`
}

/** Only what is actually broken: missing required tools and missing required folders. */
export function healthSummary(report: DiagnosticsReport): HealthSummary {
  const problems: string[] = []
  const git = report.tools.find((tool) => tool.name === REQUIRED_TOOL_NAME)
  if (git === undefined || !git.found) {
    problems.push(`${REQUIRED_TOOL_NAME} is required but was not found`)
  }
  for (const dir of report.dirs) {
    if (!dir.exists && dir.name !== OPTIONAL_DIR_NAME) {
      problems.push(`${dir.name} folder is missing (${dir.path})`)
    }
  }
  return { ok: problems.length === 0, problems }
}

/** Missing optional CLIs are worth knowing about, but they are notes, never health problems. */
export function optionalToolNotes(report: DiagnosticsReport): string[] {
  return report.tools
    .filter((tool) => !tool.found && OPTIONAL_TOOL_NAMES.includes(tool.name))
    .map((tool) => `${tool.name} is not installed`)
}

function dirLine(dir: DiagnosticDir): string {
  return `${dir.name}: ${dir.path} (${dir.exists ? 'exists' : 'missing'})`
}

/** Plain text for "Copy report": versions, tool paths, folder paths and the redacted log tail. */
export function reportToText(report: DiagnosticsReport): string {
  const lines: string[] = [
    `App: ${report.app.version}`,
    `Electron: ${report.app.electron}`,
    `Chrome: ${report.app.chrome}`,
    `Node: ${report.app.node}`,
    `Platform: ${report.app.platform} (${report.app.arch})`,
    ...report.tools.map((tool) => `${tool.name}: ${toolStatusLabel(tool)}`),
    ...report.dirs.map(dirLine),
    LOG_TAIL_HEADING,
    ...(report.logTail.length > 0 ? report.logTail : [EMPTY_LOG_TEXT])
  ]
  return lines.join('\n')
}
