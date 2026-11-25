import { appendFileSync, closeSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import { MAX_LOG_BYTES } from './errorLog'

const LOG_FILE_NAME = 'window-events.log'
const MAX_MESSAGE_CHARS = 400
const CONSOLE_LEVEL_ERROR = 3
/** Summarize a run of identical lines after this many skipped repeats. */
const REPEAT_SUMMARY_AFTER = 50
/** Keep roughly the last 256 KB of whole lines when the log passes MAX_LOG_BYTES (shared with main-errors.log). */
const KEEP_BYTES = 256 * 1024

function bodyOf(event: string, detail: string): string {
  return `${event}${detail ? ' ' + detail.slice(0, MAX_MESSAGE_CHARS) : ''}`
}

/** Reads the last `length` bytes of a file (the same tail read main-errors.log uses). */
function readTail(filePath: string, size: number, length: number): string {
  const fd = openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    let read = 0
    while (read < length) {
      const count = readSync(fd, buffer, read, length - read, size - length + read)
      if (count === 0) break
      read += count
    }
    return buffer.subarray(0, read).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/** Bounds the log before an append: a repeating renderer error must not fill the disk. Never throws. */
function capIfNeeded(filePath: string): void {
  let size: number
  try {
    size = statSync(filePath).size
  } catch {
    return
  }
  if (size <= MAX_LOG_BYTES) return
  try {
    const text = readTail(filePath, size, Math.min(size, KEEP_BYTES))
    const firstBreak = text.indexOf('\n')
    writeFileSync(filePath, firstBreak >= 0 ? text.slice(firstBreak + 1) : text, 'utf-8')
  } catch {
    // Keeping the old, larger file beats losing the next entry: the caller appends anyway.
  }
}

/**
 * Appends window lifecycle events (show, load failures, renderer crashes, renderer error messages) to
 * `<userData>/window-events.log`. A window that never appears leaves no other trace, so this file is the
 * first thing to read when "the app starts but I see nothing".
 */
export function attachWindowDiagnostics(window: BrowserWindow, userDataDir: string): void {
  const logPath = path.join(userDataDir, LOG_FILE_NAME)
  let dirReady = false
  let lastBody: string | null = null
  let repeats = 0

  function appendLine(body: string): void {
    // mkdir on every renderer error is wasted work; the log folder is created once, on the first write.
    if (!dirReady) {
      mkdirSync(userDataDir, { recursive: true })
      dirReady = true
    }
    capIfNeeded(logPath)
    appendFileSync(logPath, `${new Date().toISOString()} ${body}\n`, 'utf-8')
  }

  /** Writes one summary for a skipped run and clears the dedup state. */
  function flushRepeats(): void {
    if (repeats > 0 && lastBody !== null) {
      appendLine(`${lastBody} ... repeated ${repeats} more times`)
      repeats = 0
      // The next identical line starts a fresh run instead of being compared with the summary line.
      lastBody = null
    }
  }

  const write = (event: string, detail = ''): void => {
    try {
      const body = bodyOf(event, detail)
      if (body === lastBody) {
        repeats += 1
        // A message repeated thousands of times would fill the disk; one line reports the whole run.
        if (repeats >= REPEAT_SUMMARY_AFTER) flushRepeats()
        return
      }
      flushRepeats()
      appendLine(body)
      lastBody = body
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
