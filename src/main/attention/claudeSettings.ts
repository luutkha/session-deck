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
 * a per-session file). A payload that arrives inside the window is NOT lost: the newest one is kept in a file and a
 * single background job sends it when the window ends. Without that, the last update of a quick turn (the one with the
 * real context %) was dropped, and Claude sends nothing more while idle, so the card kept an empty context (D86).
 * Prints nothing and always exits 0, so it can never disturb the Claude UI.
 */
export function statusLineCommand(): string {
  const post =
    'curl -s -m 2 -X POST "http://127.0.0.1:$SESSIONDECK_PORT/statusline/$SESSIONDECK_SESSION_ID" -H "x-token: $SESSIONDECK_TOKEN" -H "content-type: application/json" --data-binary @- >/dev/null 2>&1'
  return [
    'f="${TMPDIR:-/tmp}/sessiondeck-sl-$SESSIONDECK_SESSION_ID"',
    'payload=$(cat)',
    'now=$(date +%s 2>/dev/null)',
    'last=$(cat "$f" 2>/dev/null)',
    'case "$now" in ""|*[!0-9]*) exit 0;; esac',
    'case "$last" in ""|*[!0-9]*) last=0;; esac',
    `if [ $((now - last)) -ge ${STATUSLINE_THROTTLE_SECONDS} ]; then`,
    '  echo "$now" > "$f" 2>/dev/null',
    `  printf "%s" "$payload" | ${post}`,
    'else',
    '  printf "%s" "$payload" > "$f.latest" 2>/dev/null',
    '  pend=$(cat "$f.pending" 2>/dev/null)',
    '  case "$pend" in ""|*[!0-9]*) pend=0;; esac',
    // A marker older than two windows belongs to a job that died: start a new one.
    `  if [ $((now - pend)) -ge ${STATUSLINE_THROTTLE_SECONDS * 2} ]; then`,
    '    echo "$now" > "$f.pending" 2>/dev/null',
    `    ( sleep $((${STATUSLINE_THROTTLE_SECONDS} - (now - last) + 1)); rm -f "$f.pending"; date +%s > "$f" 2>/dev/null; cat "$f.latest" 2>/dev/null | ${post} ) >/dev/null 2>&1 &`,
    '  fi',
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