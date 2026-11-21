// Worker-thread entry that parses ONE spreadsheet or Word file (D75 review fix). xlsx/docx parsers build the whole document
// in memory, and a tiny hostile file (a 240 KB workbook with two far-apart cells per row asks read-excel-file for 16384-wide
// rows) runs the MAIN process out of memory: the whole app dies and every session's terminal output stops. Here the parse
// runs under `resourceLimits` (see officeRunner.ts): the worst case kills this worker, never the app.
import { parentPort } from 'node:worker_threads'
import { readDocxHtml } from './docx'
import { readSheets } from './sheets'

export interface OfficeJob {
  readonly kind: 'sheet' | 'docx'
  readonly bytes: Uint8Array
}

export type OfficeAnswer =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly error: string }

if (parentPort !== null) {
  const port = parentPort
  port.once('message', (job: OfficeJob): void => {
    const buffer = Buffer.from(job.bytes.buffer, job.bytes.byteOffset, job.bytes.byteLength)
    const run = job.kind === 'sheet' ? readSheets(buffer) : readDocxHtml(buffer)
    run.then(
      (result): void => port.postMessage({ ok: true, result } satisfies OfficeAnswer),
      (error: unknown): void => port.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies OfficeAnswer)
    )
  })
}
