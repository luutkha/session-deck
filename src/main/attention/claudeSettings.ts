import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { HOOK_EVENT_NAMES, type HookEventName } from './HookServer'

/**
 * Hook command for one Claude Code event. Claude pipes the hook's JSON payload on stdin; curl forwards it unchanged
 * (`--data-binary @-`) to POST /hook/<sessionId>/<Event>. Silent, time-limited, and always exits 0 so it can never
 * block or disturb Claude.
 */
export function hookCommand(event: HookEventName): string {
  return [
    `curl -s -m 2 -X POST "http://127.0.0.1:$SESSIONDECK_PORT/hook/$SESSIONDECK_SESSION_ID/${event}"`,
    '-H "x-token: $SESSIONDECK_TOKEN" -H "content-type: application/json" --data-binary @-',
    '>/dev/null 2>&1; exit 0'
  ].join(' ')
}

/** Minimum seconds between two statusLine POSTs for the same session. */
export const STATUSLINE_THROTTLE_SECONDS = 10

/**
 * Claude Code statusLine command (runs under bash with the session env). Reads the statusLine JSON from stdin and
 * POSTs it to the HookServer at most once per STATUSLINE_THROTTLE_SECONDS per session (the last-post epoch lives in
 * a per-session file). Prints nothing and always exits 0, so it can never disturb the Claude UI.
 */
export function statusLineCommand(): string {
  return [
    'f="${TMPDIR:-/tmp}/sessiondeck-sl-$SESSIONDECK_SESSION_ID"',
    'payload=$(cat)',
    'now=$(date +%s 2>/dev/null)',
    'last=$(cat "$f" 2>/dev/null)',
    'case "$now" in ""|*[!0-9]*) exit 0;; esac',
    'case "$last" in ""|*[!0-9]*) last=0;; esac',
    `if [ $((now - last)) -ge ${STATUSLINE_THROTTLE_SECONDS} ]; then`,
    '  echo "$now" > "$f" 2>/dev/null',
    '  printf "%s" "$payload" | curl -s -m 2 -X POST "http://127.0.0.1:$SESSIONDECK_PORT/statusline/$SESSIONDECK_SESSION_ID" -H "x-token: $SESSIONDECK_TOKEN" -H "content-type: application/json" --data-binary @- >/dev/null 2>&1',
    'fi',
    'exit 0'
  ].join('\n')
}

export function buildClaudeSettings(): string {
  const settings = {
    statusLine: {
      type: 'command',
      command: statusLineCommand()
    },
    hooks: Object.fromEntries(
      HOOK_EVENT_NAMES.map((event) => [
        event,
        [
          {
            hooks: [
              {
                type: 'command',
                command: hookCommand(event)
              }
            ]
          }
        ]
      ])
    )
  }
  return JSON.stringify(settings, null, 2)
}

export function writeSettingsFile(dir: string): string {
  mkdirSync(dir, { recursive: true })
  const filePath = resolve(dir, 'sessiondeck-hooks.json')
  const content = buildClaudeSettings()
  writeFileSync(filePath, content, 'utf8')
  return filePath
}