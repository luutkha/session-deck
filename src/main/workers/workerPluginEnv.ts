import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildWorkerPluginSource, LEGACY_WORKER_PLUGIN_FILE_NAME, WORKER_PLUGIN_DIR_NAME, WORKER_PLUGIN_PACKAGE_VERSION } from './workerPluginSource'

export const OPENCODE_CONFIG_ENV_VAR = 'OPENCODE_CONFIG_CONTENT'

/**
 * Writes the worker plugin package (see workerPluginSource.ts) into `dir` and returns the absolute path of the
 * package DIRECTORY (OpenCode v2 loads configured plugins from package directories only: package.json "main" ->
 * index.mjs, referenced from OPENCODE_CONFIG_CONTENT). A leftover v1 single-file plugin beside the package is
 * removed.
 */
export function writeWorkerPlugin(dir: string): string {
  mkdirSync(dir, { recursive: true })
  const pluginDir = resolve(dir, WORKER_PLUGIN_DIR_NAME)
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(resolve(pluginDir, 'package.json'), JSON.stringify({ name: WORKER_PLUGIN_DIR_NAME, version: WORKER_PLUGIN_PACKAGE_VERSION, main: 'index.mjs' }), 'utf8')
  writeFileSync(resolve(pluginDir, 'index.mjs'), buildWorkerPluginSource(), 'utf8')
  rmSync(resolve(dir, LEGACY_WORKER_PLUGIN_FILE_NAME), { force: true })
  return pluginDir
}

/** An absolute path as OpenCode config entries expect it: forward slashes ("C:/Users/.../plugin-pkg"). */
export function pluginEntryPath(pluginDir: string): string {
  return pluginDir.replace(/\\/g, '/')
}

function isLegacyFileEntry(entry: unknown): boolean {
  return (
    typeof entry === 'string' &&
    (entry.toLowerCase().endsWith('/' + LEGACY_WORKER_PLUGIN_FILE_NAME) || entry.toLowerCase().endsWith('\\' + LEGACY_WORKER_PLUGIN_FILE_NAME))
  )
}

/**
 * OPENCODE_CONFIG_CONTENT that loads the worker plugin. Only the plugin is added (never a permission rule), so
 * workers behave exactly as without SessionDeck. A config the user already exports is kept: the plugin package
 * directory joins its `plugin` list (our own legacy file:// entries removed); an unparseable one is left alone by
 * returning it unchanged (the feature is skipped, nothing breaks).
 */
export function mergeWorkerPluginConfig(existing: string | undefined, pluginDir: string): string {
  const entry = pluginEntryPath(pluginDir)
  if (existing === undefined || existing.trim().length === 0) return JSON.stringify({ plugin: [entry] })
  let parsed: unknown
  try {
    parsed = JSON.parse(existing)
  } catch {
    return existing
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return existing
  const record = parsed as Record<string, unknown>
  const plugins = Array.isArray(record.plugin) ? (record.plugin as unknown[]) : []
  const next = plugins.filter((e) => !isLegacyFileEntry(e))
  if (next.includes(entry)) return existing
  return JSON.stringify({ ...record, plugin: [...next, entry] })
}

/** Env entries for a Claude terminal so every `opencode` it starts reports to SessionDeck. */
export function workerPluginEnv(pluginDir: string, existing: string | undefined = process.env[OPENCODE_CONFIG_ENV_VAR]): Record<string, string> {
  return { [OPENCODE_CONFIG_ENV_VAR]: mergeWorkerPluginConfig(existing, pluginDir) }
}
