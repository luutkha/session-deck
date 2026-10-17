import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const MAIN_ERROR_LOG_FILE = 'main-errors.log'
export const MAX_MESSAGE_CHARS = 2000
const MAX_STACK_LINES = 5
const MAX_STACK_LINE_CHARS = 200
const TRUNCATED_SUFFIX = ' ...[truncated]'

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text
  }
  return `${text.slice(0, maxChars)}${TRUNCATED_SUFFIX}`
}

function describeError(error: unknown): { readonly message: string; readonly stackLines: readonly string[] } {
  if (error instanceof Error) {
    const stack = typeof error.stack === 'string' ? error.stack.split('\n') : []
    // The first stack line repeats the message, so only the frames after it are kept.
    const frames = stack.slice(1, 1 + MAX_STACK_LINES).map((line) => truncate(line.trimEnd(), MAX_STACK_LINE_CHARS))
    return {
      message: truncate(`${error.name}: ${error.message}`, MAX_MESSAGE_CHARS),
      stackLines: frames
    }
  }
  return { message: truncate(String(error), MAX_MESSAGE_CHARS), stackLines: [] }
}

/** Formats one log entry: a timestamped header line, then up to MAX_STACK_LINES stack frames. */
export function formatMainError(context: string, error: unknown, now: Date): string {
  const { message, stackLines } = describeError(error)
  const header = `[${now.toISOString()}] ${context}: ${message}`
  return [header, ...stackLines].join('\n') + '\n'
}

/**
 * Appends an error to `<userDataDir>/main-errors.log`. This function must never throw: it is the one place
 * where an error may be dropped. If the file cannot be written, the entry is echoed to stderr instead.
 */
export function logMainError(userDataDir: string, context: string, error: unknown): void {
  let entry: string
  try {
    entry = formatMainError(context, error, new Date())
  } catch {
    entry = `[${new Date().toISOString()}] ${context}: <unprintable error>\n`
  }

  try {
    mkdirSync(userDataDir, { recursive: true })
    appendFileSync(join(userDataDir, MAIN_ERROR_LOG_FILE), entry, 'utf-8')
  } catch {
    try {
      process.stderr.write(entry)
    } catch {
      // Neither the log file nor stderr is writable; there is nowhere left to report this.
    }
  }
}
