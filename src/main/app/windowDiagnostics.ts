import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { BrowserWindow } from 'electron'

const LOG_FILE_NAME = 'window-events.log'
const MAX_MESSAGE_CHARS = 400
const CONSOLE_LEVEL_ERROR = 3

function formatLine(event: string, detail: string): string {
  return `${new Date().toISOString()} ${event}${detail ? ' ' + detail.slice(0, MAX_MESSAGE_CHARS) : ''}\n`
}

/**
 * Appends window lifecycle events (show, load failures, renderer crashes, renderer error messages) to
 * `<userData>/window-events.log`. A window that never appears leaves no other trace, so this file is the
 * first thing to read when "the app starts but I see nothing".
 */
export function attachWindowDiagnostics(window: BrowserWindow, userDataDir: string): void {
  const logPath = path.join(userDataDir, LOG_FILE_NAME)
  const write = (event: string, detail = ''): void => {
    try {
      mkdirSync(userDataDir, { recursive: true })
      appendFileSync(logPath, formatLine(event, detail))
    } catch {
      // Diagnostics must never break the app; a failed log write is the one error we may drop.
    }
  }

  write('window-created')
  window.once('ready-to-show', () => write('ready-to-show'))
  window.on('show', () => write('show'))
  window.on('hide', () => write('hide'))
  window.webContents.on('did-start-loading', () => write('did-start-loading'))
  window.webContents.on('did-finish-load', () => write('did-finish-load'))
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    write('did-fail-load', `${code} ${description} ${url}`)
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    write('render-process-gone', `${details.reason} exit=${details.exitCode}`)
  })
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level === CONSOLE_LEVEL_ERROR) {
      write('renderer-error', `${message} (${sourceId}:${line})`)
    }
  })
  window.on('unresponsive', () => write('unresponsive'))
}
