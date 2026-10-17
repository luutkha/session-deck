/**
 * Per-process plugin injection for OpenCode: the plugin file plus the "no permission prompts" rule travel
 * through OPENCODE_CONFIG_CONTENT, so nothing is written into the user's project or global OpenCode config.
 */
export const OPENCODE_PLUGIN_ENV_VAR = 'OPENCODE_CONFIG_CONTENT'

/**
 * The config content that makes OpenCode load the SessionDeck plugin and never ask for permissions
 * ({"*": "allow"}). The plugin path becomes a file:/// URL with forward slashes.
 */
export function buildOpencodeConfigContent(pluginPath: string): string {
  const fileUrl = `file:///${pluginPath.replace(/\\/g, '/').replace(/^\/+/, '')}`
  return JSON.stringify({ plugin: [fileUrl], permission: { '*': 'allow' } })
}

/** Env entries to merge into an OpenCode session's environment (see startOptions.ts). */
export function opencodePluginEnv(pluginPath: string): Record<string, string> {
  return { [OPENCODE_PLUGIN_ENV_VAR]: buildOpencodeConfigContent(pluginPath) }
}
