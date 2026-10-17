/** Format rules for OpenCode values (session ids reported by the plugin, model ids). */

/** OpenCode conversation id, as reported in the AgentSession hook payload: `ses_` + 8..64 alphanumeric characters. */
export const OPENCODE_SESSION_ID_RE = /^ses_[A-Za-z0-9]{8,64}$/

export function isOpencodeSessionId(value: unknown): value is string {
  return typeof value === 'string' && OPENCODE_SESSION_ID_RE.test(value)
}

export const MAX_OPENCODE_MODEL_LENGTH = 200

/** "provider/model" style OpenCode model id as passed to `--model`. */
export const OPENCODE_MODEL_RE = /^[A-Za-z0-9._:/@+-]*$/

export function isOpencodeModel(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_OPENCODE_MODEL_LENGTH && OPENCODE_MODEL_RE.test(value)
}

/** "provider/model" style OpenCode model id as passed to `--model`. */
export function trimmedModelOrUndefined(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  return isOpencodeModel(trimmed) ? trimmed : undefined
}
