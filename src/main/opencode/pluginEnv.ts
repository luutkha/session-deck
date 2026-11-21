import { isRecord } from '../../shared/guards'

/**
 * Per-process plugin injection for OpenCode: the plugin package (see pluginSource.ts / writePlugin.ts) plus the
 * "no permission prompts" rule travel through OPENCODE_CONFIG_CONTENT, so nothing is written into the user's
 * project or global OpenCode config.
 *
 * OpenCode v2 (verified on 2.1.4) loads configured plugins from PACKAGE DIRECTORIES only: every entry must be an
 * absolute path to the plugin package directory; `"file:///...mjs"` file entries are rejected with a
 * "configured plugin path must be a directory" warning. Legacy file entries for SessionDeck's own v1 plugin
 * files are therefore removed when they are found in a config the user already exports.
 */
export const OPENCODE_PLUGIN_ENV_VAR = 'OPENCODE_CONFIG_CONTENT'

/** Basenames of the v1 single-file plugin layouts, whose file:// entries v2 cannot load. */
export const LEGACY_PLUGIN_BASENAMES = ['sessiondeck-opencode-plugin.mjs', 'sessiondeck-worker-plugin.mjs']

/** An absolute path as OpenCode config entries expect it: forward slashes ("C:/Users/.../plugin-pkg"). */
export function pluginEntryPath(pkgDir: string): string {
  return pkgDir.replace(/\\/g, '/')
}

function isLegacyFileEntry(entry: unknown): boolean {
  return (
    typeof entry === 'string' &&
    LEGACY_PLUGIN_BASENAMES.some(
      (name) => entry.toLowerCase().endsWith('/' + name) || entry.toLowerCase().endsWith('\\' + name)
    )
  )
}

/**
 * How SessionDeck treats OpenCode permissions: 'yolo' forces `{"*": "allow"}` (D10, the default) and 'ask' leaves
 * the user's own permission rules untouched, so OpenCode asks them itself.
 */
export type OpencodePermissionPolicy = 'yolo' | 'ask'

/**
 * The config content that makes OpenCode load the SessionDeck plugins. A config the user already exports is kept:
 * the plugin package directories join its `plugin` list (in order, deduplicated, SessionDeck's own legacy file://
 * entries removed), the permission rule is merged into its own rules under the 'yolo' policy, and every other
 * field (model, provider, ...) survives. Under 'ask' the permission object is kept exactly as the user wrote it
 * (absent stays absent, no rule is added). An unparseable or non-object value is returned unchanged, so OpenCode
 * keeps its own behaviour instead of failing to start.
 */
export function buildOpencodeConfigContent(
  pluginDirs: string | readonly string[],
  existing: string | undefined,
  permissionPolicy: OpencodePermissionPolicy = 'yolo'
): string {
  const dirs = Array.isArray(pluginDirs) ? pluginDirs : [pluginDirs]
  const entries = dirs.map(pluginEntryPath).filter((entry) => entry.length > 0)

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

  const existingEntries = isRecord(parsed) && Array.isArray(parsed.plugin) ? parsed.plugin : []
  const nextPlugins = existingEntries.filter((entry) => !isLegacyFileEntry(entry))
  for (const entry of entries) {
    if (!nextPlugins.includes(entry)) nextPlugins.push(entry)
  }
  const permission = isRecord(parsed.permission) ? parsed.permission : {}

  const next: Record<string, unknown> = { ...parsed, plugin: nextPlugins }
  if (permissionPolicy === 'ask') return JSON.stringify(next)

  return JSON.stringify({
    ...next,
    permission: { ...permission, '*': 'allow' }
  })
}

/**
 * Merges extra top-level config keys into an OPENCODE_CONFIG_CONTENT value (the model is set this way: the TUI has
 * no --model flag — passing one makes the CLI print help and exit, "ShowHelp: Help requested" on v2.1.4 — but the
 * config `model` key ("provider/model-id") works everywhere). A base the user already exports is kept; an
 * unparseable or non-object base is returned unchanged, so OpenCode keeps its own behaviour instead of failing.
 */
export function applyConfigPatch(baseContent: string | undefined, patch: Record<string, unknown>): string {
  if (baseContent === undefined || baseContent.trim().length === 0) return JSON.stringify(patch)
  let parsed: unknown
  try {
    parsed = JSON.parse(baseContent)
  } catch {
    return baseContent
  }
  if (!isRecord(parsed)) return baseContent
  return JSON.stringify({ ...parsed, ...patch })
}

/**
 * Env entries to merge into an OpenCode session's environment (see startOptions.ts). `existing` is the user's own
 * OPENCODE_CONFIG_CONTENT, passed explicitly so tests never depend on the ambient environment. Several plugin
 * package directories load in the given order (the worker plugin first, so the owner process reports itself early).
 * `permissionPolicy` is forwarded to buildOpencodeConfigContent ('yolo' when omitted, exactly the D10 behaviour).
 */
export function opencodePluginEnv(
  pluginDirs: string | readonly string[],
  existing: string | undefined,
  permissionPolicy: OpencodePermissionPolicy = 'yolo'
): Record<string, string> {
  return { [OPENCODE_PLUGIN_ENV_VAR]: buildOpencodeConfigContent(pluginDirs, existing, permissionPolicy) }
}
