import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAttentionService, type AttentionService } from './AttentionService'
import { CURSOR_HOOKS_FILE } from '../cursor/hooksFile'
import { CURSOR_HOOK_SCRIPT_FILE } from '../cursor/hookScript'

// D81: prepareCursor installs the Cursor hook bridge. Both directories are temp dirs (the app's settings dir and the
// env-overridden Cursor config dir), so a real ~/.cursor is never touched.
describe('AttentionService.prepareCursor', () => {
  let settingsDir: string
  let configDir: string
  let service: AttentionService

  beforeEach(async () => {
    settingsDir = mkdtempSync(join(tmpdir(), 'sessiondeck-cursor-settings-'))
    configDir = mkdtempSync(join(tmpdir(), 'sessiondeck-cursor-config-'))
    process.env.SESSIONDECK_CURSOR_CONFIG_DIR = configDir
    service = createAttentionService({
      isKnownSession: () => true,
      isFocused: () => false,
      beep: () => undefined,
      flash: () => undefined,
      isWindowFocused: () => false,
      settingsDir
    })
    await service.start()
  })

  afterEach(async () => {
    await service.stop()
    delete process.env.SESSIONDECK_CURSOR_CONFIG_DIR
    rmSync(settingsDir, { recursive: true, force: true })
    rmSync(configDir, { recursive: true, force: true })
  })

  it('writes the hook script and merges the three entries into <configDir>/hooks.json', () => {
    service.prepareCursor()

    const scriptPath = join(settingsDir, CURSOR_HOOK_SCRIPT_FILE)
    expect(existsSync(scriptPath)).toBe(true)
    const hooks = JSON.parse(readFileSync(join(configDir, CURSOR_HOOKS_FILE), 'utf8')) as {
      version: number
      hooks: Record<string, Array<{ command: string; timeout: number }>>
    }
    expect(hooks.version).toBe(1)
    expect(Object.keys(hooks.hooks).sort()).toEqual(['afterAgentResponse', 'beforeSubmitPrompt', 'stop'])
    expect(hooks.hooks.stop?.[0]).toEqual({ command: `node "${scriptPath}" stop`, timeout: 10 })
  })

  it('is idempotent: repeated calls keep exactly one entry per event', () => {
    service.prepareCursor()
    service.prepareCursor()
    const hooks = JSON.parse(readFileSync(join(configDir, CURSOR_HOOKS_FILE), 'utf8')) as {
      hooks: Record<string, unknown[]>
    }
    expect(hooks.hooks.beforeSubmitPrompt).toHaveLength(1)
    expect(hooks.hooks.stop).toHaveLength(1)
    expect(hooks.hooks.afterAgentResponse).toHaveLength(1)
  })

  it('keeps foreign hooks and keys already in the user hooks.json', () => {
    writeFileSync(
      join(configDir, CURSOR_HOOKS_FILE),
      JSON.stringify({ version: 1, custom: 'keep', hooks: { stop: [{ command: 'my-hook', timeout: 5 }] } }),
      'utf8'
    )
    service.prepareCursor()

    const hooks = JSON.parse(readFileSync(join(configDir, CURSOR_HOOKS_FILE), 'utf8')) as {
      custom: string
      hooks: Record<string, Array<{ command: string }>>
    }
    expect(hooks.custom).toBe('keep')
    expect(hooks.hooks.stop?.[0]?.command).toBe('my-hook')
    expect(hooks.hooks.stop).toHaveLength(2)
  })

  it('throws and leaves an invalid hooks.json untouched', () => {
    writeFileSync(join(configDir, CURSOR_HOOKS_FILE), '{ broken json', 'utf8')
    expect(() => service.prepareCursor()).toThrow(/not valid JSON/)
    expect(readFileSync(join(configDir, CURSOR_HOOKS_FILE), 'utf8')).toBe('{ broken json')
  })

  it('throws before start()', () => {
    const notStarted = createAttentionService({
      isKnownSession: () => true,
      isFocused: () => false,
      beep: () => undefined,
      flash: () => undefined,
      isWindowFocused: () => false,
      settingsDir
    })
    expect(() => notStarted.prepareCursor()).toThrow('AttentionService not started')
  })
})
