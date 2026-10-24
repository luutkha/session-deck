/**
 * Per-process plugin injection for OpenCode: the plugin file plus the "no permission prompts" rule travel
 * through OPENCODE_CONFIG_CONTENT, so nothing is written into the user's project or global OpenCode config.
 */
export const OPENCODE_PLUGIN_ENV_VAR = 'OPENCODE_CONFIG_CONTENT'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The config content that makes OpenCode load the SessionDeck plugin and never ask for permissions
 * ({"*": "allow"}). A config the user already exports is kept: the plugin joins its `plugin` list, the permission
 * rule is merged into its own rules, and every other field (model, provider, ...) survives. An unparseable or
 * non-object value is returned unchanged, so OpenCode keeps its own behaviour instead of failing to start.
 */
export function buildOpencodeConfigContent(pluginPath: string, existing: string | undefined): string {
  const fileUrl = `file:///${pluginPath.replace(/\\/g, '/').replace(/^\/+/, '')}`

  let parsed: Record<string, unknown> = {}
  if (existing !== undefined && existing.trim().length > 0) {
    let value: unknown
    try {
      value = JSON.parse(existing)
    } catch {
      return existing
    }
    if (!isRecord(value)) return existing
    parsed = value
  }

  const plugins = Array.isArray(parsed.plugin) ? parsed.plugin : []
  const nextPlugins = plugins.includes(fileUrl) ? [...plugins] : [...plugins, fileUrl]
  const permission = isRecord(parsed.permission) ? parsed.permission : {}

  return JSON.stringify({
    ...parsed,
    plugin: nextPlugins,
    permission: { ...permission, '*': 'allow' }
  })
}

/**
 * Env entries to merge into an OpenCode session's environment (see startOptions.ts). `existing` is the user's own
 * OPENCODE_CONFIG_CONTENT, passed explicitly so tests never depend on the ambient environment.
 */
export function opencodePluginEnv(pluginPath: string, existing: string | undefined): Record<string, string> {
  return { [OPENCODE_PLUGIN_ENV_VAR]: buildOpencodeConfigContent(pluginPath, existing) }
}
