import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CURSOR_HOOKS_FILE,
  cursorHookCommand,
  installCursorHooks,
  mergeCursorHooks,
  type CursorHookCommands
} from './hooksFile'
import { CURSOR_HOOK_MARKER } from './hookScript'

const SCRIPT = 'C:\\Users\\me\\AppData\\Roaming\\sessiondeck\\sessiondeck-cursor-hook.cjs'

const commands = (scriptPath = SCRIPT): CursorHookCommands => ({
  beforeSubmitPrompt: cursorHookCommand(scriptPath, 'beforeSubmitPrompt'),
  stop: cursorHookCommand(scriptPath, 'stop'),
  afterAgentResponse: cursorHookCommand(scriptPath, 'afterAgentResponse')
})

function parse(text: string): {
  version?: unknown
  hooks?: Record<string, Array<{ command?: string; timeout?: number }>>
  [key: string]: unknown
} {
  return JSON.parse(text)
}

describe('mergeCursorHooks', () => {
  it('creates version 1 with one entry per event and a 10 s timeout', () => {
    const merged = parse(mergeCursorHooks(null, commands()))

    expect(merged.version).toBe(1)
    expect(Object.keys(merged.hooks ?? {}).sort()).toEqual(['afterAgentResponse', 'beforeSubmitPrompt', 'stop'])
    for (const event of ['beforeSubmitPrompt', 'stop', 'afterAgentResponse'] as const) {
      expect(merged.hooks?.[event]).toEqual([{ command: cursorHookCommand(SCRIPT, event), timeout: 10 }])
    }
  })

  it('uses `node "<script>" <event>` so node must be on PATH', () => {
    const merged = parse(mergeCursorHooks(null, commands()))

    expect(merged.hooks?.stop?.[0]?.command).toBe(`node "${SCRIPT}" stop`)
  })

  it('keeps every foreign key and every foreign hook untouched', () => {
    const existing = JSON.stringify({
      version: 1,
      extra: { keep: true },
      hooks: {
        stop: [{ command: 'my-own-stop-hook', timeout: 5 }],
        beforeSubmitPrompt: [{ command: 'echo hello' }],
        someOtherEvent: [{ command: 'other' }]
      }
    })
    const merged = parse(mergeCursorHooks(existing, commands()))

    expect(merged.extra).toEqual({ keep: true })
    expect(merged.hooks?.someOtherEvent).toEqual([{ command: 'other' }])
    expect(merged.hooks?.stop?.[0]).toEqual({ command: 'my-own-stop-hook', timeout: 5 })
    expect(merged.hooks?.stop?.[1]).toEqual({ command: cursorHookCommand(SCRIPT, 'stop'), timeout: 10 })
    expect(merged.hooks?.beforeSubmitPrompt?.[0]).toEqual({ command: 'echo hello' })
    expect(merged.hooks?.beforeSubmitPrompt?.[1]?.command).toContain(CURSOR_HOOK_MARKER)
  })

  it('replaces our old entries (a changed script path) and never duplicates them', () => {
    const old = mergeCursorHooks(null, commands('C:\\old\\sessiondeck-cursor-hook.cjs'))
    const merged = parse(mergeCursorHooks(old, commands(SCRIPT)))

    for (const event of ['beforeSubmitPrompt', 'stop', 'afterAgentResponse'] as const) {
      const entries = merged.hooks?.[event] ?? []
      expect(entries).toHaveLength(1)
      expect(entries[0]?.command).toBe(cursorHookCommand(SCRIPT, event))
    }
    expect(mergeCursorHooks(old, commands(SCRIPT))).not.toContain('C:\\\\old')
  })

  it('leaves an already-installed file byte-for-byte stable (idempotent)', () => {
    const once = mergeCursorHooks(null, commands())
    expect(mergeCursorHooks(once, commands())).toBe(once)
  })

  it('throws on invalid JSON instead of dropping the user file content', () => {
    expect(() => mergeCursorHooks('{ not json', commands())).toThrow(/not valid JSON/)
  })

  it('throws when the file is JSON but not an object', () => {
    expect(() => mergeCursorHooks('[1, 2, 3]', commands())).toThrow(/not a JSON object/)
  })
})

describe('installCursorHooks', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sessiondeck-cursor-hooks-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes <configDir>/hooks.json with our three entries', () => {
    const filePath = installCursorHooks({ configDir: join(dir, 'cursor'), scriptPath: SCRIPT })
    expect(filePath).toBe(join(dir, 'cursor', CURSOR_HOOKS_FILE))
    const merged = parse(readFileSync(filePath, 'utf8'))
    expect(merged.version).toBe(1)
    expect(merged.hooks?.afterAgentResponse?.[0]?.command).toContain(CURSOR_HOOK_MARKER)
  })

  it('is idempotent across runs and keeps foreign hooks', () => {
    const configDir = join(dir, 'cursor')
    const filePath = join(configDir, CURSOR_HOOKS_FILE)
    installCursorHooks({ configDir, scriptPath: SCRIPT })
    const first = readFileSync(filePath, 'utf8')
    installCursorHooks({ configDir, scriptPath: SCRIPT })
    expect(readFileSync(filePath, 'utf8')).toBe(first)

    writeFileSync(
      filePath,
      JSON.stringify({ version: 1, hooks: { stop: [{ command: 'foreign-stop' }] } }),
      'utf8'
    )
    installCursorHooks({ configDir, scriptPath: SCRIPT })
    const merged = parse(readFileSync(filePath, 'utf8'))
    expect(merged.hooks?.stop?.map((entry) => entry.command)).toEqual(['foreign-stop', `node "${SCRIPT}" stop`])
  })

  it('never overwrites an existing file that is not valid JSON', () => {
    const configDir = join(dir, 'cursor')
    const filePath = join(configDir, CURSOR_HOOKS_FILE)
    installCursorHooks({ configDir, scriptPath: SCRIPT })
    writeFileSync(filePath, '{ broken', 'utf8')

    expect(() => installCursorHooks({ configDir, scriptPath: SCRIPT })).toThrow(/not valid JSON/)
    expect(readFileSync(filePath, 'utf8')).toBe('{ broken')
  })
})
