import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { logMainError, MAIN_ERROR_LOG_FILE, MAX_MESSAGE_CHARS } from './errorLog'

const createdDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sessiondeck-errlog-'))
  createdDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of createdDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  createdDirs.length = 0
})

describe('logMainError', () => {
  it('appends a timestamped line with context and message to main-errors.log', () => {
    const dir = tempDir()

    logMainError(dir, 'ipc pty:write', new Error('Session not running: abc'))
    logMainError(dir, 'uncaughtException', 'plain string failure')

    const text = readFileSync(join(dir, MAIN_ERROR_LOG_FILE), 'utf-8')
    const lines = text.split('\n').filter((line) => line.startsWith('['))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T[^\]]+\] ipc pty:write: Error: Session not running: abc/)
    expect(lines[1]).toContain('uncaughtException: plain string failure')
  })

  it('includes only the first stack lines of an error', () => {
    const dir = tempDir()
    const error = new Error('boom')
    error.stack = ['Error: boom', '  at a (a.ts:1:1)', '  at b (b.ts:2:2)', '  at c (c.ts:3:3)', '  at d (d.ts:4:4)', '  at e (e.ts:5:5)', '  at f (f.ts:6:6)', '  at g (g.ts:7:7)'].join('\n')

    logMainError(dir, 'ctx', error)

    const text = readFileSync(join(dir, MAIN_ERROR_LOG_FILE), 'utf-8')
    expect(text).toContain('at a (a.ts:1:1)')
    expect(text).not.toContain('at g (g.ts:7:7)')
  })

  it('truncates a huge message', () => {
    const dir = tempDir()
    const huge = 'x'.repeat(MAX_MESSAGE_CHARS * 10)

    logMainError(dir, 'ctx', new Error(huge))

    const text = readFileSync(join(dir, MAIN_ERROR_LOG_FILE), 'utf-8')
    expect(text.length).toBeLessThan(MAX_MESSAGE_CHARS + 1000)
    expect(text).toContain('[truncated]')
  })

  it('survives an unwritable directory without throwing', () => {
    const dir = tempDir()
    const blocker = join(dir, 'not-a-dir')
    writeFileSync(blocker, 'file, not directory')

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      expect(() => logMainError(join(blocker, 'nested'), 'ctx', new Error('x'))).not.toThrow()
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('ctx: Error: x'))
    } finally {
      stderrSpy.mockRestore()
    }
    expect(existsSync(join(blocker, 'nested', MAIN_ERROR_LOG_FILE))).toBe(false)
  })

  it('never throws even when the error value cannot be stringified', () => {
    const dir = tempDir()
    const hostile = {
      toString(): string {
        throw new Error('no toString')
      }
    }

    expect(() => logMainError(dir, 'ctx', hostile)).not.toThrow()
  })
})
