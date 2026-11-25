import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { MAX_LOG_BYTES } from './errorLog'
import { attachWindowDiagnostics } from './windowDiagnostics'

type Listener = (...args: unknown[]) => void

function fakeWindow(): { readonly window: BrowserWindow; readonly fire: (name: string, ...args: unknown[]) => void } {
  const listeners = new Map<string, Listener[]>()
  const listen = (name: string, callback: Listener): void => {
    const existing = listeners.get(name) ?? []
    existing.push(callback)
    listeners.set(name, existing)
  }
  const webContents = { on: listen }
  const window = { on: listen, once: listen, webContents } as unknown as BrowserWindow
  return {
    window,
    fire(name: string, ...args: unknown[]): void {
      for (const callback of listeners.get(name) ?? []) callback(...args)
    }
  }
}

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sessiondeck-windowdiag-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function logLines(dir: string): string[] {
  return readFileSync(join(dir, 'window-events.log'), 'utf-8').split('\n').filter((line) => line.length > 0)
}

describe('attachWindowDiagnostics', () => {
  it('creates the log directory on the first write and timestamps each distinct line', () => {
    const dir = tempDir()
    const userData = join(dir, 'nested', 'userData')
    expect(existsSync(userData)).toBe(false)

    const w = fakeWindow()
    attachWindowDiagnostics(w.window, userData)

    expect(existsSync(userData)).toBe(true)
    expect(logLines(userData)).toHaveLength(1)
    expect(logLines(userData)[0]).toMatch(/^\d{4}-\d{2}-\d{2}T.* window-created$/)

    w.fire('show')
    w.fire('console-message', {}, 3, 'first error', 7, 'app.tsx')
    const lines = logLines(userData)
    expect(lines).toHaveLength(3)
    expect(lines[1]).toMatch(/ show$/)
    expect(lines[2]).toContain('renderer-error first error (app.tsx:7)')
  })

  it('skips consecutive identical lines and summarizes the repeats when a different line arrives', () => {
    const dir = tempDir()
    const w = fakeWindow()
    attachWindowDiagnostics(w.window, dir)

    const repeat = (): void => w.fire('console-message', {}, 3, 'same boom', 7, 'app.tsx')
    repeat()
    repeat()
    repeat()
    repeat()
    w.fire('console-message', {}, 3, 'other boom', 8, 'app.tsx')

    const lines = logLines(dir)
    expect(lines).toHaveLength(4)
    expect(lines.filter((line) => line.endsWith('renderer-error same boom (app.tsx:7)'))).toHaveLength(1)
    expect(lines.filter((line) => line.includes('... repeated 3 more times'))).toHaveLength(1)
    expect(lines[lines.length - 1]).toContain('renderer-error other boom (app.tsx:8)')
  })

  it('summarizes a long repeat run without waiting for a different line', () => {
    const dir = tempDir()
    const w = fakeWindow()
    attachWindowDiagnostics(w.window, dir)

    for (let i = 0; i < 51; i++) w.fire('console-message', {}, 3, 'storm', 1, 'app.tsx')

    const lines = logLines(dir)
    expect(lines).toHaveLength(3)
    expect(lines.filter((line) => line.endsWith('renderer-error storm (app.tsx:1)'))).toHaveLength(1)
    expect(lines.filter((line) => line.includes('... repeated 50 more times'))).toHaveLength(1)
  })

  it('caps an oversized log before appending and keeps the newest lines', () => {
    const dir = tempDir()
    const file = join(dir, 'window-events.log')
    const old = Array.from({ length: 20_000 }, (_, i) => `2020-01-01T00:00:00.000Z old ${i} ${'x'.repeat(50)}`).join('\n') + '\n'
    writeFileSync(file, old, 'utf-8')

    const w = fakeWindow()
    attachWindowDiagnostics(w.window, dir)
    w.fire('show')

    const text = readFileSync(file, 'utf-8')
    expect(Buffer.byteLength(text)).toBeLessThan(MAX_LOG_BYTES)
    expect(text).toContain('window-created')
    expect(text).toContain(' show\n')
    expect(text).not.toContain('old 0 ')
    // The kept tail starts on a whole line, not in the middle of one.
    expect(text.split('\n')[0]).toMatch(/^2020-01-01T00:00:00\.000Z old \d+ /)
  })
})
