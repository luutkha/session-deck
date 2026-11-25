// Settings > Diagnostics (G6): a compact, read-only view of the main-process self-check (D86).
// Formatting and health rules live in diagnosticsFormat.ts so they can be tested without a DOM.
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { AlertTriangle, CheckCircle2, Copy, RefreshCw } from 'lucide-react'
import type { DiagnosticsReport } from '../../shared/types'
import { errorMessage } from '../../shared/guards'
import { Button } from '@/components/ui/button'
import {
  ALL_OK_TEXT,
  CHECKING_TEXT,
  EMPTY_LOG_TEXT,
  healthSummary,
  optionalToolNotes,
  reportToText
} from './diagnosticsFormat'

/** How long the "Copied" feedback stays up after a successful clipboard write. */
const COPIED_RESET_MS = 2_000
/** Starting a new fetch invalidates the previous one without unmounting the section. */
const FIRST_ATTEMPT = 0
const ERROR_LOG_SUMMARY = 'Error log (last lines)'

/** Plain vite dev has no bridge; guard it the same way the OpenCode probe row does. */
function apiOrNull(): Window['api'] | null {
  return typeof window !== 'undefined' && typeof window.api?.getDiagnostics === 'function' ? window.api : null
}

/** Settings > Diagnostics: tools, folders, versions and the redacted error-log tail. */
export function DiagnosticsSection(): ReactElement {
  const [report, setReport] = useState<DiagnosticsReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)
  const [copied, setCopied] = useState(false)
  const [attempt, setAttempt] = useState(FIRST_ATTEMPT)
  const copyTimer = useRef<number | undefined>(undefined)

  useEffect((): (() => void) => {
    let cancelled = false
    setChecking(true)
    setError(null)
    const api = apiOrNull()
    if (api === null) {
      setChecking(false)
      setError('Diagnostics are available only in the desktop app.')
      return (): void => {
        cancelled = true
      }
    }
    void api
      .getDiagnostics()
      .then((next: DiagnosticsReport): void => {
        if (cancelled) return
        setReport(next)
        setChecking(false)
      })
      .catch((err: unknown): void => {
        if (cancelled) return
        setError(errorMessage(err))
        setChecking(false)
      })
    return (): void => {
      cancelled = true
    }
  }, [attempt])

  // A second "Run again" click must not leave the "Copied" label up after the new report arrives.
  useEffect(
    (): (() => void) => (): void => {
      if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current)
    },
    []
  )

  async function copyReport(): Promise<void> {
    if (report === null) return
    try {
      await navigator.clipboard.writeText(reportToText(report))
      setCopied(true)
      if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout((): void => setCopied(false), COPIED_RESET_MS)
    } catch (err: unknown) {
      setError(errorMessage(err))
    }
  }

  const health = report === null ? null : healthSummary(report)
  const notes = report === null ? [] : optionalToolNotes(report)

  return (
    <div className="flex flex-col gap-3" data-diagnostics="">
      {checking ? <p role="status" className="text-xs text-muted-foreground">{CHECKING_TEXT}</p> : null}

      {!checking && error !== null ? (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-xs text-destructive">{error}</p>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="self-start text-xs"
            data-diagnostics-refresh=""
            onClick={(): void => setAttempt((previous: number): number => previous + 1)}
          >
            <RefreshCw aria-hidden="true" />
            Run again
          </Button>
        </div>
      ) : null}

      {!checking && error === null && report !== null && health !== null ? (
        <>
          {health.ok ? (
            <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              {ALL_OK_TEXT}
            </p>
          ) : (
            <div role="alert" className="flex flex-col gap-0.5 text-xs text-destructive">
              {health.problems.map((problem: string): ReactElement => (
                <p key={problem} className="flex items-center gap-1.5">
                  <AlertTriangle className="size-3.5" aria-hidden="true" />
                  {problem}
                </p>
              ))}
            </div>
          )}

          {notes.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Not installed (optional): {notes.join(', ')}
            </p>
          ) : null}

          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-foreground">Tools</span>
            <table className="w-full table-fixed text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="w-28 font-medium">Tool</th>
                  <th className="w-12 font-medium">Status</th>
                  <th className="w-32 font-medium">Version</th>
                  <th className="font-medium">Path</th>
                </tr>
              </thead>
              <tbody>
                {report.tools.map((tool) => (
                  <tr key={tool.name} data-diagnostics-tool={tool.name} className="border-t border-border/60">
                    <td className="py-1 pr-2 font-medium">{tool.name}</td>
                    <td className="py-1 pr-2">
                      <span
                        className={`inline-block size-1.5 rounded-full ${tool.found ? 'bg-emerald-500' : 'bg-destructive'}`}
                        aria-label={tool.found ? 'found' : 'not found'}
                        title={tool.found ? 'found' : 'not found'}
                      />
                    </td>
                    <td className="truncate py-1 pr-2 text-muted-foreground">{tool.version ?? '—'}</td>
                    <td className="truncate py-1 text-muted-foreground">{tool.path ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-foreground">Folders</span>
            <table className="w-full table-fixed text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="w-28 font-medium">Folder</th>
                  <th className="w-12 font-medium">Status</th>
                  <th className="font-medium">Path</th>
                </tr>
              </thead>
              <tbody>
                {report.dirs.map((dir) => (
                  <tr key={dir.name} data-diagnostics-dir={dir.name} className="border-t border-border/60">
                    <td className="py-1 pr-2 font-medium">{dir.name}</td>
                    <td className="py-1 pr-2">
                      <span
                        className={`inline-block size-1.5 rounded-full ${dir.exists ? 'bg-emerald-500' : 'bg-destructive'}`}
                        aria-label={dir.exists ? 'exists' : 'missing'}
                        title={dir.exists ? 'exists' : 'missing'}
                      />
                    </td>
                    <td className="truncate py-1 text-muted-foreground">{dir.path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            App {report.app.version} · Electron {report.app.electron} · Chrome {report.app.chrome} · Node{' '}
            {report.app.node} · {report.app.platform} ({report.app.arch})
          </p>

          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">{ERROR_LOG_SUMMARY}</summary>
            <pre className="mt-1 max-h-40 overflow-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-[11px]">
              {report.logTail.length > 0 ? report.logTail.join('\n') : EMPTY_LOG_TEXT}
            </pre>
          </details>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="text-xs"
              data-diagnostics-refresh=""
              onClick={(): void => setAttempt((previous: number): number => previous + 1)}
            >
              <RefreshCw aria-hidden="true" />
              Run again
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="text-xs"
              data-diagnostics-copy=""
              onClick={(): void => void copyReport()}
            >
              {copied ? <CheckCircle2 aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy report'}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  )
}
