import { describe, expect, it } from 'vitest'
import { buildOpencodeConfigContent, opencodePluginEnv, OPENCODE_PLUGIN_ENV_VAR } from './pluginEnv'

const PLUGIN_PATH = 'C:\\Users\\me\\sessiondeck-attention\\sessiondeck-opencode-plugin.mjs'
const PLUGIN_URL = 'file:///C:/Users/me/sessiondeck-attention/sessiondeck-opencode-plugin.mjs'

function parse(content: string): Record<string, unknown> {
  return JSON.parse(content) as Record<string, unknown>
}

describe('buildOpencodeConfigContent', () => {
  it('adds the plugin and the allow rule when the user exports nothing', () => {
    const config = parse(buildOpencodeConfigContent(PLUGIN_PATH, undefined))
    expect(config).toEqual({
      plugin: [PLUGIN_URL],
      permission: { '*': 'allow' }
    })
  })

  it('keeps the user model/provider settings and merges plugin and permission', () => {
    const existing = JSON.stringify({
      model: 'anthropic/claude-sonnet',
      provider: { anthropic: { options: { timeout: 60000 } } },
      plugin: ['file:///other-plugin.mjs'],
      permission: { edit: 'deny' }
    })

    const config = parse(buildOpencodeConfigContent(PLUGIN_PATH, existing))
    expect(config.model).toBe('anthropic/claude-sonnet')
    expect(config.provider).toEqual({ anthropic: { options: { timeout: 60000 } } })
    expect(config.plugin).toEqual(['file:///other-plugin.mjs', PLUGIN_URL])
    expect(config.permission).toEqual({ edit: 'deny', '*': 'allow' })
  })

  it('does not add the plugin twice', () => {
    const existing = JSON.stringify({ plugin: [PLUGIN_URL] })
    const config = parse(buildOpencodeConfigContent(PLUGIN_PATH, existing))
    expect(config.plugin).toEqual([PLUGIN_URL])
  })

  it('leaves an unparseable config untouched', () => {
    const existing = '{ not json'
    expect(buildOpencodeConfigContent(PLUGIN_PATH, existing)).toBe(existing)
  })

  it('leaves a non-object config untouched', () => {
    for (const existing of ['[]', '"text"', 'null', '42']) {
      expect(buildOpencodeConfigContent(PLUGIN_PATH, existing)).toBe(existing)
    }
  })

  it('ignores a plugin field that is not an array', () => {
    const config = parse(buildOpencodeConfigContent(PLUGIN_PATH, JSON.stringify({ plugin: 'nope' })))
    expect(config.plugin).toEqual([PLUGIN_URL])
  })
})

describe('opencodePluginEnv', () => {
  it('returns the config under OPENCODE_CONFIG_CONTENT', () => {
    const env = opencodePluginEnv(PLUGIN_PATH, undefined)
    expect(Object.keys(env)).toEqual([OPENCODE_PLUGIN_ENV_VAR])
    expect(parse(env[OPENCODE_PLUGIN_ENV_VAR]).model).toBeUndefined()
  })
})
