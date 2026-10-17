import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeOpencodePlugin } from './writePlugin'
import { opencodePluginEnv, OPENCODE_PLUGIN_ENV_VAR } from './pluginEnv'
import { PLUGIN_FILE_NAME } from './pluginSource'

const PLUGIN_ABSPATH = 'C:\\abs\\path\\sessiondeck-opencode-plugin.mjs'

describe('opencodePluginEnv', () => {
  it('builds the per-process plugin injection config with the plugin path as file:/// URL', () => {
    const env = opencodePluginEnv(PLUGIN_ABSPATH)
    expect(Object.keys(env)).toEqual([OPENCODE_PLUGIN_ENV_VAR])
    expect(env[OPENCODE_PLUGIN_ENV_VAR]).toBe(
      JSON.stringify({ plugin: ['file:///C:/abs/path/sessiondeck-opencode-plugin.mjs'], permission: { '*': 'allow' } })
    )
  })

  it('normalizes a POSIX absolute path to the same file:/// URL shape', () => {
    const env = opencodePluginEnv('/abs/path/plugin.mjs')
    expect(JSON.parse(env[OPENCODE_PLUGIN_ENV_VAR])).toEqual({
      plugin: ['file:///abs/path/plugin.mjs'],
      permission: { '*': 'allow' }
    })
  })

  it('the injected config enables yolo mode (no permission prompts) and only travels through the environment', () => {
    expect(opencodePluginEnv(PLUGIN_ABSPATH)).toEqual({
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        plugin: ['file:///C:/abs/path/sessiondeck-opencode-plugin.mjs'],
        permission: { '*': 'allow' }
      })
    })
  })
})

describe('writeOpencodePlugin', () => {
  it('writes the plugin as <dir>/sessiondeck-opencode-plugin.mjs (same directory as the Claude settings file) and returns the path', () => {
    const dir = join(tmpdir(), 'sessiondeck-writeplugin-test-' + Math.random().toString(36).slice(2))
    const written = writeOpencodePlugin(dir)
    expect(written).toBe(join(dir, PLUGIN_FILE_NAME))
    const content = readFileSync(written, 'utf8')
    expect(content).toContain('export const SessionDeckPlugin')
    expect(content).toContain('SESSIONDECK_PORT')
  })
})
