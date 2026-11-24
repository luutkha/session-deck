/** Cursor CLI value shapes (D81), shared by the store, the IPC validation and the hook server. */

const CHAT_ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{7,79}$/
const MODEL_RE = /^[A-Za-z0-9._:/@][A-Za-z0-9._:/@-]{0,99}$/

/** A Cursor chat id (`conversation_id` of its hook payloads, a UUID in practice): what `agent --resume` takes. */
export function isCursorChatId(value: unknown): value is string {
  return typeof value === 'string' && CHAT_ID_RE.test(value)
}

/**
 * A plain Cursor model name such as `gpt-5` or `sonnet-4-thinking`. The set of characters is small on purpose: the name
 * is passed on the command line (cmd.exe on Windows), so nothing a shell would treat specially is allowed, and it
 * cannot start with `-` (it would be read as another flag: `--model --api-key`). The chat id has the same rule.
 */
export function isCursorModel(value: unknown): value is string {
  return typeof value === 'string' && MODEL_RE.test(value)
}
