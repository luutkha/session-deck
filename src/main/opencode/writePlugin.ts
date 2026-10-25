import { buildOpencodePluginSource, LEGACY_PLUGIN_FILE_NAME, PLUGIN_DIR_NAME, PLUGIN_PACKAGE_VERSION } from './pluginSource'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Writes the OpenCode plugin package (see pluginSource.ts) into `dir` (the same directory as the Claude settings
 * file) and returns the absolute path of the package DIRECTORY (OpenCode v2 loads configured plugins from package
 * directories only: package.json "main" -> index.mjs, referenced from OPENCODE_CONFIG_CONTENT). Called once during
 * AttentionService.start(); a leftover v1 single-file plugin beside the package is removed.
 */
export function writeOpencodePlugin(dir: string): string {
  mkdirSync(dir, { recursive: true })
  const pluginDir = resolve(dir, PLUGIN_DIR_NAME)
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(resolve(pluginDir, 'package.json'), JSON.stringify({ name: PLUGIN_DIR_NAME, version: PLUGIN_PACKAGE_VERSION, main: 'index.mjs' }), 'utf8')
  writeFileSync(resolve(pluginDir, 'index.mjs'), buildOpencodePluginSource(), 'utf8')
  rmSync(resolve(dir, LEGACY_PLUGIN_FILE_NAME), { force: true })
  return pluginDir
}
