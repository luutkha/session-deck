import { describe, expect, it } from 'vitest'
import type { DiagnosticTool, DiagnosticsReport } from '../../shared/types'
import {
  EMPTY_LOG_TEXT,
  NOT_FOUND_TEXT,
  healthSummary,
  optionalToolNotes,
  reportToText,
  toolStatusLabel
} from './diagnosticsFormat'

function reportWith(overrides: Partial<DiagnosticsReport> = {}): DiagnosticsReport {
  return {
    generatedAt: 1_700_000_000_000,
    app: {
      version: '1.4.0',
      electron: '34.0.0',
      chrome: '132.0.0',
      node: '22.1.0',
      platform: 'win32',
      arch: 'x64'
    },
    tools: [
      { name: 'claude', found: true, path: 'C:\\Tools\\claude.cmd', version: '1.2.3' },
      { name: 'git', found: true, path: 'C:\\Git\\git.exe', version: '2.45.0' },
      { name: 'gh', found: false }
    ],
    dirs: [
      { name: 'Worktrees', path: 'C:\\Users\\me\\SessionDeck\\worktrees', exists: true },
      { name: 'Claude config', path: 'C:\\Users\\me\\.claude', exists: true },
      { name: 'Cursor config', path: 'C:\\Users\\me\\.cursor', exists: false }
    ],
    logTail: [],
    ...overrides
  }
}

const tool = (overrides: Partial<DiagnosticTool>): DiagnosticTool => ({ name: 'claude', found: true, ...overrides })

describe('toolStatusLabel', () => {
  it('shows the path and version of a found tool', () => {
    expect(toolStatusLabel(tool({ path: 'C:\\path', version: '1.2.3' }))).toBe('found C:\\path (1.2.3)')
  })

  it('leaves off the version when the probe could not read it', () => {
    expect(toolStatusLabel(tool({ path: 'C:\\path' }))).toBe('found C:\\path')
  })

  it('has a fallback when a found tool has no path', () => {
    expect(toolStatusLabel(tool({ version: '1.2.3' }))).toBe('found unknown path (1.2.3)')
  })

  it('says NOT FOUND for a missing tool', () => {
    expect(toolStatusLabel(tool({ found: false }))).toBe(NOT_FOUND_TEXT)
  })
})

describe('healthSummary', () => {
  it('is healthy with git and required folders, even with a missing optional tool or folder', () => {
    expect(healthSummary(reportWith())).toStrictEqual({ ok: true, problems: [] })
  })

  it('reports a missing required tool', () => {
    const report = reportWith({
      tools: [{ name: 'git', found: false }, { name: 'claude', found: false }]
    })
    const result = healthSummary(report)
    expect(result.ok).toBe(false)
    expect(result.problems).toHaveLength(1)
    expect(result.problems[0]).toContain('git')
  })

  it('reports a missing required tool when git is absent from the report entirely', () => {
    expect(healthSummary(reportWith({ tools: [] })).problems[0]).toContain('git')
  })

  it('reports a missing folder other than the Cursor config', () => {
    const report = reportWith({
      dirs: [
        { name: 'Worktrees', path: 'C:\\x', exists: false },
        { name: 'Cursor config', path: 'C:\\.cursor', exists: false }
      ]
    })
    const result = healthSummary(report)
    expect(result.ok).toBe(false)
    expect(result.problems).toHaveLength(1)
    expect(result.problems[0]).toContain('Worktrees')
    expect(result.problems[0]).toContain('C:\\x')
  })
})

describe('optionalToolNotes', () => {
  it('lists only the missing optional tools, never git', () => {
    expect(
      optionalToolNotes(
        reportWith({
          tools: [
            { name: 'claude', found: false },
            { name: 'opencode', found: true, path: 'C:\\oc' },
            { name: 'cursor-agent', found: false },
            { name: 'git', found: false },
            { name: 'gh', found: false }
          ]
        })
      )
    ).toStrictEqual(['claude is not installed', 'cursor-agent is not installed', 'gh is not installed'])
  })

  it('is empty when the optional tools are installed', () => {
    expect(optionalToolNotes(reportWith({ tools: [{ name: 'claude', found: true }] }))).toStrictEqual([])
  })
})

describe('reportToText', () => {
  it('writes versions, every tool, every folder and the log tail as plain lines', () => {
    const text = reportToText(
      reportWith({
        logTail: ['first error', 'second error']
      })
    )
    expect(text).toBe(
      [
        'App: 1.4.0',
        'Electron: 34.0.0',
        'Chrome: 132.0.0',
        'Node: 22.1.0',
        'Platform: win32 (x64)',
        'claude: found C:\\Tools\\claude.cmd (1.2.3)',
        'git: found C:\\Git\\git.exe (2.45.0)',
        'gh: NOT FOUND',
        'Worktrees: C:\\Users\\me\\SessionDeck\\worktrees (exists)',
        'Claude config: C:\\Users\\me\\.claude (exists)',
        'Cursor config: C:\\Users\\me\\.cursor (missing)',
        'Log tail:',
        'first error',
        'second error'
      ].join('\n')
    )
  })

  it('writes a placeholder when there is no log tail', () => {
    expect(reportToText(reportWith()).split('\n').at(-1)).toBe(EMPTY_LOG_TEXT)
  })
})
