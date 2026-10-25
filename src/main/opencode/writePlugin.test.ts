import { describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeOpencodePlugin } from './writePlugin'
import { opencodePluginEnv, OPENCODE_PLUGIN_ENV_VAR } from './pluginEnv'
import { LEGACY_PLUGIN_FILE_NAME, PLUGIN_DIR_NAME, buildOpencodePluginSource } from './pluginSource'

const PLUGIN_DIR = 'C:\\abs\\path\\sessiondeck-opencode-plugin'

describe('opencodePluginEnv', () => {
  it('builds the per-process plugin injection config with the plugin package directory path', () => {
    const env = opencodePluginEnv(PLUGIN_DIR, undefined)
    expect(Object.keys(env)).toEqual([OPENCODE_PLUGIN_ENV_VAR])
    expect(env[OPENCODE_PLUGIN_ENV_VAR]).toBe(
      JSON.stringify({ plugin: ['C:/abs/path/sessiondeck-opencode-plugin'], permission: { '*': 'allow' } })
    )
  })
})

describe('writeOpencodePlugin', () => {
  it('writes the plugin as a package <dir>/sessiondeck-opencode-plugin/{package.json,index.mjs} and returns the directory', () => {
    const dir = join(tmpdir(), 'sessiondeck-writeplugin-test-' + Math.random().toString(36).slice(2))
    try {
      const written = writeOpencodePlugin(dir)
      expect(written).toBe(join(dir, PLUGIN_DIR_NAME))
      const pkg = JSON.parse(readFileSync(join(written, 'package.json'), 'utf8')) as Record<string, unknown>
      expect(pkg).toMatchObject({ name: PLUGIN_DIR_NAME, main: 'index.mjs' })
      const content = readFileSync(join(written, 'index.mjs'), 'utf8')
      expect(content).toContain('export default {')
      expect(content).toContain('setup: async function')
      expect(content).toContain('SESSIONDECK_PORT')
      expect(existsSync(join(dir, LEGACY_PLUGIN_FILE_NAME))).toBe(false)
      expect(buildOpencodePluginSource()).toBe(content)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('removes a leftover v1 single-file plugin beside the package', () => {
    const dir = join(tmpdir(), 'sessiondeck-writeplugin-legacy-' + Math.random().toString(36).slice(2))
    const legacy = join(dir, LEGACY_PLUGIN_FILE_NAME)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    writeFileSync(legacy, 'export const SessionDeckPlugin = () => ({})', 'utf8')
    try {
      const written = writeOpencodePlugin(dir)
      expect(written).toBe(join(dir, PLUGIN_DIR_NAME))
      expect(existsSync(legacy)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
