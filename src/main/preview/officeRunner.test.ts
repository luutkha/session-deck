import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { OfficeLimitError, OfficeWorkerUnavailableError, officeWorkerPath, runInWorker, runOffice } from './officeRunner'

const dir = mkdtempSync(join(tmpdir(), 'sd-officerunner-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function script(name: string, body: string): string {
  const file = join(dir, name)
  writeFileSync(file, `import { parentPort } from 'node:worker_threads'\n${body}\n`)
  return file
}

const JOB = { kind: 'sheet' as const, bytes: new Uint8Array([1, 2, 3, 4]) }

describe('runInWorker', () => {
  it('returns what the worker answers, and hands the bytes over as a copy', async () => {
    const file = script('ok.mjs', "parentPort.once('message', (job) => parentPort.postMessage({ ok: true, result: { n: job.bytes.length, kind: job.kind } }))")
    const bytes = new Uint8Array([9, 8, 7])
    await expect(runInWorker(file, { kind: 'docx', bytes })).resolves.toEqual({ n: 3, kind: 'docx' })
    expect(Array.from(bytes)).toEqual([9, 8, 7]) // the caller's array was not detached
  })

  it('a parse error reported by the worker is a plain Error with its message (not a limit, not "unavailable")', async () => {
    const file = script('parse-error.mjs', "parentPort.once('message', () => parentPort.postMessage({ ok: false, error: 'Doesn\\'t look like an .xlsx file' }))")
    const error = await runInWorker(file, JOB).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(OfficeLimitError)
    expect(error).not.toBeInstanceOf(OfficeWorkerUnavailableError)
    expect((error as Error).message).toContain('look like an .xlsx')
  })

  it('a worker that runs out of memory ends as an OfficeLimitError and the test process lives on', async () => {
    const file = script('oom.mjs', "parentPort.once('message', () => { const hold = []; for (;;) hold.push(new Array(1_000_000).fill(1)) })")
    const started = Date.now()
    const error = await runInWorker(file, JOB, { memoryMb: 48, timeoutMs: 30_000 }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(OfficeLimitError)
    expect((error as Error).message).toMatch(/more memory or time/)
    expect(Date.now() - started).toBeLessThan(25_000)
  }, 40_000)

  it('a worker that never answers is stopped at the time limit', async () => {
    const file = script('hang.mjs', "parentPort.once('message', () => { setInterval(() => {}, 1000) })")
    const started = Date.now()
    const error = await runInWorker(file, JOB, { timeoutMs: 400 }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(OfficeLimitError)
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('a worker that exits before answering counts as unavailable (the caller falls back)', async () => {
    const file = script('exit.mjs', "parentPort.once('message', () => { process.exit(0) })")
    await expect(runInWorker(file, JOB, { timeoutMs: 5000 })).rejects.toBeInstanceOf(OfficeWorkerUnavailableError)
  })

  it('a worker script that is not there counts as unavailable too', async () => {
    await expect(runInWorker(join(dir, 'does-not-exist.mjs'), JOB, { timeoutMs: 5000 })).rejects.toBeInstanceOf(OfficeWorkerUnavailableError)
  })
})

describe('runOffice', () => {
  it('under the unit tests there is no built worker, so it parses in-process (and a real error still surfaces)', async () => {
    expect(officeWorkerPath()).toBeNull()
    await expect(runOffice('sheet', Buffer.from('not a zip'))).rejects.toThrow()
  })
})
