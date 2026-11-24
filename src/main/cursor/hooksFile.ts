// Cursor hooks.json (D81). Cursor reads hook commands from <configDir>/hooks.json and runs them for its events.
// SessionDeck only owns three entries; everything else in the file (other hooks, other keys) must survive untouched.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { isRecord } from '../../shared/guards'
import { CURSOR_HOOK_MARKER } from './hookScript'

/** Cursor hook events SessionDeck uses (the script maps them to the app's hook routes). */
export const CURSOR_HOOK_EVENTS = ['beforeSubmitPrompt', 'stop', 'afterAgentResponse'] as const
export type CursorHookEvent = (typeof CURSOR_HOOK_EVENTS)[number]

/** One command per event (built by installCursorHooks from the script path). */
export type CursorHookCommands = Readonly<Record<CursorHookEvent, string>>

/** Seconds Cursor allows a hook command to run (the script itself gives up after 3 s). */
export const CURSOR_HOOK_TIMEOUT_SECONDS = 10

export const CURSOR_HOOKS_FILE = 'hooks.json'

/** Cursor's config dir: SESSIONDECK_CURSOR_CONFIG_DIR when set (tests), else ~/.cursor. */
export function cursorConfigDir(): string {
  const fromEnv = process.env.SESSIONDECK_CURSOR_CONFIG_DIR
  return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : join(homedir(), '.cursor')
}

/** The command Cursor runs for one event: `node "<script path>" <event>` (node must be on PATH). */
export function cursorHookCommand(scriptPath: string, event: CursorHookEvent): string {
  return `node "${scriptPath}" ${event}`
}

/** True for a hook entry SessionDeck wrote before (its command names our script, whatever the path). */
function isOwnHookEntry(entry: unknown): boolean {
  return isRecord(entry) && typeof entry.command === 'string' && entry.command.includes(CURSOR_HOOK_MARKER)
}

/**
 * Merges SessionDeck's hook entries into an existing hooks.json text and returns the new text.
 *
 * Rules: version stays 1; every foreign key and every foreign hook is kept; our old entries (recognised by the script
 * name in their command) are replaced by exactly one fresh entry per event, so a changed script path never
 * duplicates. An existing file that is not a JSON object throws instead of being overwritten.
 */
export function mergeCursorHooks(existingJsonText: string | null, commands: CursorHookCommands): string {
  let root: Record<string, unknown> = {}
  if (existingJsonText !== null) {
    let parsed: unknown
    try {
      parsed = JSON.parse(existingJsonText)
    } catch {
      throw new Error('Cursor hooks file is not valid JSON; leaving it untouched')
    }
    if (!isRecord(parsed)) {
      throw new Error('Cursor hooks file is not a JSON object; leaving it untouched')
    }
    root = { ...parsed }
  }

  const existingHooks = isRecord(root.hooks) ? root.hooks : {}
  const hooks: Record<string, unknown> = { ...existingHooks }
  for (const event of CURSOR_HOOK_EVENTS) {
    const current = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : []
    const foreign = current.filter((entry) => !isOwnHookEntry(entry))
    hooks[event] = [...foreign, { command: commands[event], timeout: CURSOR_HOOK_TIMEOUT_SECONDS }]
  }

  root.version = 1
  root.hooks = hooks
  return JSON.stringify(root, null, 2)
}

/**
 * Writes `<configDir>/hooks.json` with SessionDeck's three hook entries merged in, and returns the file path.
 * Never writes when the existing file is invalid (mergeCursorHooks throws first), so a user's broken file is safe.
 */
export function installCursorHooks(input: { readonly configDir: string; readonly scriptPath: string }): string {
  mkdirSync(input.configDir, { recursive: true })
  const filePath = resolve(input.configDir, CURSOR_HOOKS_FILE)
  const existing = existsSync(filePath) ? readFileSync(filePath, 'utf8') : null
  const commands = Object.fromEntries(
    CURSOR_HOOK_EVENTS.map((event) => [event, cursorHookCommand(input.scriptPath, event)])
  ) as Record<CursorHookEvent, string>
  const content = mergeCursorHooks(existing, commands)
  writeFileSync(filePath, content, 'utf8')
  return filePath
}
