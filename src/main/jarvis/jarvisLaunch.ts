// Jarvis launch details (D53), pure so they can be tested without Electron: where its files live, the Claude
// arguments it starts with, the MCP config it is given and the instructions appended to its system prompt.
import { join } from 'node:path'
import { MCP_PATH } from './mcpHttpServer'
import { MCP_SERVER_NAME } from './mcpProtocol'

export const JARVIS_NAME = 'Jarvis'
/** An unanswered Yes/No counts as No after this long (the model's tool call must not hang forever). */
export const CONFIRM_TIMEOUT_MS = 120_000

/** The instructions appended to Jarvis's system prompt; `toolNames` = every tool the MCP server offers. */
export function jarvisSystemPrompt(toolNames: readonly string[]): string {
  return `You are Jarvis, the assistant built into SessionDeck, a desktop app that runs many Claude Code, OpenCode and shell sessions.
The user talks to you to control the app. You act through the "${MCP_SERVER_NAME}" MCP tools (mcp__${MCP_SERVER_NAME}__*):
${toolNames.join(', ')}.

How to work:
- Call list_sessions first when you need names or states; refer to sessions by the names it shows.
- "Reconnect", "resume" or "start" a session = wake_session. "Put X to sleep" = sleep_session.
- When a name could mean several sessions, the tool tells you; ask the user which one. Never guess on destructive actions.
- Tools whose description says the user is asked to confirm ask the user in the app themselves: just call them when asked.
- To give work to a session, use send_prompt (it waits until the session is ready). Do not do that work yourself and do
  not edit files in the user's projects: the sessions do the work, you manage them.
- For "when X is done, do Y": send_prompt, then wait_for_session, then get_last_answer, then act on it.
- Use read_screen to see what a session shows (progress, an answer, or a question it is waiting on), and press_keys to
  answer a menu, only when the user asked you to or the answer is obvious and harmless.
- A message that starts with "[Scheduled task" comes from SessionDeck's scheduler (set up earlier with schedule_add):
  carry it out with your tools without asking for confirmation of the task itself, then reply with one short summary.
- You cannot act on yourself (the Jarvis session).
- Keep replies short: say what you did and anything the user must know. Use the user's language.`
}

export function jarvisPaths(userDataDir: string): { readonly dir: string; readonly mcpConfig: string; readonly prompt: string; readonly log: string; readonly schedules: string } {
  const dir = join(userDataDir, 'jarvis')
  return { dir, mcpConfig: join(dir, 'mcp.json'), prompt: join(dir, 'system-prompt.md'), log: join(dir, 'actions.log'), schedules: join(dir, 'schedules.json') }
}

/** The arguments Jarvis is launched with (pure, for tests). */
export function jarvisLaunchArgs(paths: { readonly mcpConfig: string; readonly prompt: string }, model: string): readonly string[] {
  return ['--mcp-config', paths.mcpConfig, '--append-system-prompt-file', paths.prompt, ...(model.length > 0 ? ['--model', model] : [])]
}

export function mcpConfigText(port: number, token: string): string {
  return JSON.stringify({
    mcpServers: {
      [MCP_SERVER_NAME]: { type: 'http', url: `http://127.0.0.1:${port}${MCP_PATH}`, headers: { Authorization: `Bearer ${token}` } }
    }
  }, null, 2)
}
