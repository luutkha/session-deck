import { buildOpencodePluginSource, PLUGIN_FILE_NAME } from './pluginSource'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Writes the OpenCode plugin (see pluginSource.ts) into `dir` (the same directory as the Claude settings file)
 * and returns its absolute path. Called once during AttentionService.start().
 */
export function writeOpencodePlugin(dir: string): string {
  mkdirSync(dir, { recursive: true })
  const filePath = resolve(dir, PLUGIN_FILE_NAME)
  writeFileSync(filePath, buildOpencodePluginSource(), 'utf8')
  return filePath
}
