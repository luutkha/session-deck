import { describe, expect, it } from 'vitest'
import { applyConfigPatch, buildOpencodeConfigContent, opencodePluginEnv, OPENCODE_PLUGIN_ENV_VAR } from './pluginEnv'

const PLUGIN_DIR = 'C:\\Users\\me\\sessiondeck-attention\\sessiondeck-opencode-plugin'
const PLUGIN_ENTRY = 'C:/Users/me/sessiondeck-attention/sessiondeck-opencode-plugin'

function parse(content: string): Record<string, unknown> {
  return JSON.parse(content) as Record<string, unknown>
}

describe('buildOpencodeConfigContent', () => {
  it('adds the plugin package directory and the allow rule when the user exports nothing', () => {
    const config = parse(buildOpencodeConfigContent(PLUGIN_DIR, undefined))
    expect(config).toEqual({
      plugin: [PLUGIN_ENTRY],
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

    const config = parse(buildOpencodeConfigContent(PLUGIN_DIR, existing))
    expect(config.model).toBe('anthropic/claude-sonnet')
    expect(config.provider).toEqual({ anthropic: { options: { timeout: 60000 } } })
    expect(config.plugin).toEqual(['file:///other-plugin.mjs', PLUGIN_ENTRY])
    expect(config.permission).toEqual({ edit: 'deny', '*': 'allow' })
  })

  it('does not add the plugin twice', () => {
    const existing = JSON.stringify({ plugin: [PLUGIN_ENTRY] })
    const config = parse(buildOpencodeConfigContent(PLUGIN_DIR, existing))
    expect(config.plugin).toEqual([PLUGIN_ENTRY])
  })

  it('leaves an unparseable config untouched', () => {
    const existing = '{ not json'
    expect(buildOpencodeConfigContent(PLUGIN_DIR, existing)).toBe(existing)
  })

  it('leaves a non-object config untouched', () => {
    for (const existing of ['[]', '"text"', 'null', '42']) {
      expect(buildOpencodeConfigContent(PLUGIN_DIR, existing)).toBe(existing)
    }
  })

  it('ignores a plugin field that is not an array', () => {
    const config = parse(buildOpencodeConfigContent(PLUGIN_DIR, JSON.stringify({ plugin: 'nope' })))
    expect(config.plugin).toEqual([PLUGIN_ENTRY])
  })

  it('drops legacy SessionDeck file:// entries (v2 cannot load plugin FILES, only package directories)', () => {
    const existing = JSON.stringify({
      model: 'm',
      plugin: [
        'file:///user-plugin.mjs',
        'File:///C:/Users/me/.sessiondeck/sessiondeck-Opencode-Plugin.MJS',
        'C:\\old\\sessiondeck-worker-plugin.mjs',
        PLUGIN_ENTRY
      ]
    })
    const config = parse(buildOpencodeConfigContent([PLUGIN_DIR], existing))
    expect(config.plugin).toEqual(['file:///user-plugin.mjs', PLUGIN_ENTRY])
  })
})

describe('buildOpencodeConfigContent with several plugins (worker + session plugin)', () => {
  const WORKER_DIR = 'C:\\Users\\me\\sessiondeck-attention\\sessiondeck-worker-plugin'
  const WORKER_ENTRY = 'C:/Users/me/sessiondeck-attention/sessiondeck-worker-plugin'

  it('loads both plugins in the given order, after the user plugins and without duplicates', () => {
    const existing = JSON.stringify({ model: 'm', plugin: ['file:///user-plugin.mjs', PLUGIN_ENTRY] })
    const config = parse(buildOpencodeConfigContent([WORKER_DIR, PLUGIN_DIR], existing))
    expect(config.plugin).toEqual(['file:///user-plugin.mjs', PLUGIN_ENTRY, WORKER_ENTRY])
    expect(config.model).toBe('m')
    expect(config.permission).toEqual({ '*': 'allow' })
  })

  it('deduplicates a repeated plugin path across calls', () => {
    const config = parse(buildOpencodeConfigContent([WORKER_DIR, WORKER_DIR], undefined))
    expect(config.plugin).toEqual([WORKER_ENTRY])
  })

  it('accepts a single path the same way', () => {
    const config = parse(buildOpencodeConfigContent(PLUGIN_DIR, undefined))
    expect(config.plugin).toEqual([PLUGIN_ENTRY])
  })
})

describe('opencodePluginEnv', () => {
  it('returns the config under OPENCODE_CONFIG_CONTENT', () => {
    const env = opencodePluginEnv(PLUGIN_DIR, undefined)
    expect(Object.keys(env)).toEqual([OPENCODE_PLUGIN_ENV_VAR])
    expect(parse(env[OPENCODE_PLUGIN_ENV_VAR]).model).toBeUndefined()
  })
})

describe('applyConfigPatch', () => {
  it('merges extra keys into an existing config, patch values win', () => {
    expect(JSON.parse(applyConfigPatch('{"plugin":["x"],"model":"a/b"}', { model: 'p/m' }))).toEqual({ plugin: ['x'], model: 'p/m' })
    expect(JSON.parse(applyConfigPatch('{"plugin":["x"]}', { model: 'p/m' }))).toEqual({ plugin: ['x'], model: 'p/m' })
  })
  it('an empty base becomes the patch itself', () => {
    expect(JSON.parse(applyConfigPatch(undefined, { model: 'p/m' }))).toEqual({ model: 'p/m' })
    expect(JSON.parse(applyConfigPatch('   ', { model: 'p/m' }))).toEqual({ model: 'p/m' })
  })
  it('an unparseable or non-object base is returned unchanged', () => {
    expect(applyConfigPatch('not json', { model: 'p/m' })).toBe('not json')
    expect(applyConfigPatch('[1,2]', { model: 'p/m' })).toBe('[1,2]')
  })
})
