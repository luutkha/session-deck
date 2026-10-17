import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildWorkerPluginSource, WORKER_PLUGIN_FILE_NAME } from './workerPluginSource'

export const OPENCODE_CONFIG_ENV_VAR = 'OPENCODE_CONFIG_CONTENT'

/** Writes the worker plugin into `dir` and returns its absolute path. */
export function writeWorkerPlugin(dir: string): string {
  mkdirSync(dir, { recursive: true })
  const filePath = resolve(dir, WORKER_PLUGIN_FILE_NAME)
  writeFileSync(filePath, buildWorkerPluginSource(), 'utf8')
  return filePath
}

export function pluginFileUrl(pluginPath: string): string {
  return `file:///${pluginPath.replace(/\\/g, '/').replace(/^\/+/, '')}`
}

/**
 * OPENCODE_CONFIG_CONTENT that loads the worker plugin. Only the plugin is added (never a permission rule), so
 * workers behave exactly as without SessionDeck. A config the user already exports is kept: the plugin joins its
 * `plugin` list; an unparseable one is left alone by returning it unchanged (the feature is skipped, nothing breaks).
 */
export function mergeWorkerPluginConfig(existing: string | undefined, pluginPath: string): string {
  const url = pluginFileUrl(pluginPath)
  if (existing === undefined || existing.trim().length === 0) return JSON.stringify({ plugin: [url] })
  let parsed: unknown
  try {
    parsed = JSON.parse(existing)
  } catch {
    return existing
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return existing
  const record = parsed as Record<string, unknown>
  const plugins = Array.isArray(record.plugin) ? (record.plugin as unknown[]) : []
  if (plugins.includes(url)) return existing
  return JSON.stringify({ ...record, plugin: [...plugins, url] })
}

/** Env entries for a Claude terminal so every `opencode` it starts reports to SessionDeck. */
export function workerPluginEnv(pluginPath: string, existing: string | undefined = process.env[OPENCODE_CONFIG_ENV_VAR]): Record<string, string> {
  return { [OPENCODE_CONFIG_ENV_VAR]: mergeWorkerPluginConfig(existing, pluginPath) }
}
