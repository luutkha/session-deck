import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { mergeWorkerPluginConfig, workerPluginEnv, writeWorkerPlugin } from './workerPluginEnv'
import { buildWorkerPluginSource } from './workerPluginSource'

const PLUGIN = 'C:\\Users\\me\\AppData\\sd\\sessiondeck-worker-plugin.mjs'
const URL_ = 'file:///C:/Users/me/AppData/sd/sessiondeck-worker-plugin.mjs'

describe('mergeWorkerPluginConfig', () => {
  it('creates a plugin-only config (never a permission rule)', () => {
    const cfg = JSON.parse(mergeWorkerPluginConfig(undefined, PLUGIN)) as Record<string, unknown>
    expect(cfg).toEqual({ plugin: [URL_] })
  })
  it('keeps the user config and appends the plugin once', () => {
    const mine = JSON.stringify({ model: 'x/y', plugin: ['file:///a.mjs'] })
    const merged = mergeWorkerPluginConfig(mine, PLUGIN)
    expect(JSON.parse(merged)).toEqual({ model: 'x/y', plugin: ['file:///a.mjs', URL_] })
    expect(mergeWorkerPluginConfig(merged, PLUGIN)).toBe(merged)
  })
  it('leaves an unparseable or non-object config alone', () => {
    expect(mergeWorkerPluginConfig('{oops', PLUGIN)).toBe('{oops')
    expect(mergeWorkerPluginConfig('[1]', PLUGIN)).toBe('[1]')
  })
  it('exposes it as the OPENCODE_CONFIG_CONTENT env entry', () => {
    expect(Object.keys(workerPluginEnv(PLUGIN, ''))).toEqual(['OPENCODE_CONFIG_CONTENT'])
  })
})

describe('writeWorkerPlugin', () => {
  it('writes the plugin source and returns its path', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sd-wp-'))
    try {
      const file = writeWorkerPlugin(dir)
      expect(readFileSync(file, 'utf8')).toBe(buildWorkerPluginSource())
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
