import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { mergeWorkerPluginConfig, pluginEntryPath, workerPluginEnv, writeWorkerPlugin } from './workerPluginEnv'
import { LEGACY_WORKER_PLUGIN_FILE_NAME, WORKER_PLUGIN_DIR_NAME, buildWorkerPluginSource } from './workerPluginSource'

const PLUGIN = 'C:\\Users\\me\\AppData\\sd\\sessiondeck-worker-plugin'

describe('mergeWorkerPluginConfig', () => {
  it('creates a plugin-only config (never a permission rule), entry as package directory path', () => {
    const cfg = JSON.parse(mergeWorkerPluginConfig(undefined, PLUGIN)) as Record<string, unknown>
    expect(cfg).toEqual({ plugin: ['C:/Users/me/AppData/sd/sessiondeck-worker-plugin'] })
  })
  it('keeps the user config and appends the plugin once', () => {
    const mine = JSON.stringify({ model: 'x/y', plugin: ['file:///a.mjs'] })
    const merged = mergeWorkerPluginConfig(mine, PLUGIN)
    expect(JSON.parse(merged)).toEqual({ model: 'x/y', plugin: ['file:///a.mjs', 'C:/Users/me/AppData/sd/sessiondeck-worker-plugin'] })
    expect(mergeWorkerPluginConfig(merged, PLUGIN)).toBe(merged)
  })
  it('drops a legacy v1 file:// entry for the worker plugin itself', () => {
    const mine = JSON.stringify({
      model: 'x/y',
      plugin: ['file:///a.mjs', 'file:///C:/Users/me/AppData/sd/sessiondeck-worker-plugin.mjs']
    })
    expect(JSON.parse(mergeWorkerPluginConfig(mine, PLUGIN))).toEqual({
      model: 'x/y',
      plugin: ['file:///a.mjs', 'C:/Users/me/AppData/sd/sessiondeck-worker-plugin']
    })
  })
  it('leaves an unparseable or non-object config alone', () => {
    expect(mergeWorkerPluginConfig('{oops', PLUGIN)).toBe('{oops')
    expect(mergeWorkerPluginConfig('[1]', PLUGIN)).toBe('[1]')
  })
  it('exposes it as the OPENCODE_CONFIG_CONTENT env entry', () => {
    expect(Object.keys(workerPluginEnv(PLUGIN, ''))).toEqual(['OPENCODE_CONFIG_CONTENT'])
  })
  it('pluginEntryPath uses forward slashes', () => {
    expect(pluginEntryPath('C:\\a\\b')).toBe('C:/a/b')
  })
})

describe('writeWorkerPlugin', () => {
  it('writes the plugin package and returns its directory', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sd-wp-'))
    try {
      const written = writeWorkerPlugin(dir)
      expect(written).toBe(path.join(dir, WORKER_PLUGIN_DIR_NAME))
      expect(JSON.parse(readFileSync(path.join(written, 'package.json'), 'utf8'))).toMatchObject({ name: WORKER_PLUGIN_DIR_NAME, main: 'index.mjs' })
      expect(readFileSync(path.join(written, 'index.mjs'), 'utf8')).toBe(buildWorkerPluginSource())
      // A leftover v1 single-file plugin is removed.
      const legacy = path.join(dir, LEGACY_WORKER_PLUGIN_FILE_NAME)
      writeFileSync(legacy, 'x', 'utf8')
      writeWorkerPlugin(dir)
      expect(existsSync(legacy)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
