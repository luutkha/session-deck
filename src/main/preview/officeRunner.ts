// Runs the spreadsheet / Word parsers off the main process, under a memory and a time limit (D75 review fix; see
// officeWorker.ts). `runOffice` is what readFileView calls. When the worker script is not there (unit tests run the TypeScript
// sources, a packaging problem) or cannot start, it falls back to parsing in-process: the zip guard (zipGuard.ts) has already
// refused decompression bombs by then, so the fallback is the old behaviour, not a new risk.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { readDocxHtml, type DocxRead } from './docx'
import type { OfficeAnswer, OfficeJob } from './officeWorker'
import { readSheets, type SheetRead } from './sheets'

/** The V8 old-space ceiling of the worker: past it the worker dies (ERR_WORKER_OUT_OF_MEMORY) and the app does not. */
export const OFFICE_WORKER_MEMORY_MB = 768
/** A parse that takes longer than this is stopped. Typical parses take well under a second. */
export const OFFICE_WORKER_TIMEOUT_MS = 20_000

/** The file needs more memory or time than the preview allows. The message is meant for the user. */
export class OfficeLimitError extends Error {
  constructor() {
    super('This file needs more memory or time than the preview allows (a very large or unusual spreadsheet or document). Open it in the default app.')
    this.name = 'OfficeLimitError'
  }
}

/** The worker could not run at all (script missing, failed to start): the caller parses in-process instead. */
export class OfficeWorkerUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`The preview worker is unavailable: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'OfficeWorkerUnavailableError'
  }
}

export interface OfficeRunOptions {
  readonly timeoutMs?: number
  readonly memoryMb?: number
}

/** Where officeWorker.js sits next to the built main bundle, or null when it is not there (tests, an unusual layout). */
export function officeWorkerPath(): string | null {
  try {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'officeWorker.js')
    return existsSync(file) ? file : null
  } catch {
    return null
  }
}

/**
 * Runs one job in a worker thread with the limits; the answer, a parse error (plain Error), an OfficeLimitError (memory or
 * time) or an OfficeWorkerUnavailableError. Exported with the script path so tests can run a misbehaving worker.
 */
export function runInWorker<T>(file: string, job: OfficeJob, options: OfficeRunOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? OFFICE_WORKER_TIMEOUT_MS
  const memoryMb = options.memoryMb ?? OFFICE_WORKER_MEMORY_MB
  return new Promise<T>((resolve, reject) => {
    let settled = false
    let worker: Worker
    try {
      worker = new Worker(file, { resourceLimits: { maxOldGenerationSizeMb: memoryMb, maxYoungGenerationSizeMb: 64, stackSizeMb: 4 } })
    } catch (error) {
      reject(new OfficeWorkerUnavailableError(error))
      return
    }
    const finish = (settle: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      settle()
    }
    const timer = setTimeout((): void => finish((): void => reject(new OfficeLimitError())), timeoutMs)
    worker.once('message', (answer: OfficeAnswer): void => {
      if (answer.ok) finish((): void => resolve(answer.result as T))
      else finish((): void => reject(new Error(answer.error)))
    })
    worker.once('error', (error: NodeJS.ErrnoException): void => {
      finish((): void => reject(error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? new OfficeLimitError() : new OfficeWorkerUnavailableError(error)))
    })
    worker.once('exit', (code: number): void => {
      finish((): void => reject(new OfficeWorkerUnavailableError(new Error(`the worker exited early (code ${String(code)})`))))
    })
    // A copy, handed over: the caller's buffer stays valid for a fallback parse.
    const copy = new Uint8Array(job.bytes)
    worker.postMessage({ kind: job.kind, bytes: copy } satisfies OfficeJob, [copy.buffer])
  })
}

async function parseInProcess(kind: OfficeJob['kind'], bytes: Buffer): Promise<SheetRead | DocxRead> {
  return kind === 'sheet' ? readSheets(bytes) : readDocxHtml(bytes)
}

export function runOffice(kind: 'sheet', bytes: Buffer): Promise<SheetRead>
export function runOffice(kind: 'docx', bytes: Buffer): Promise<DocxRead>
export async function runOffice(kind: OfficeJob['kind'], bytes: Buffer): Promise<SheetRead | DocxRead> {
  const file = officeWorkerPath()
  if (file === null) return parseInProcess(kind, bytes)
  try {
    return await runInWorker<SheetRead | DocxRead>(file, { kind, bytes })
  } catch (error) {
    if (error instanceof OfficeWorkerUnavailableError) return parseInProcess(kind, bytes)
    throw error
  }
}
