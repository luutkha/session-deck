// The Cursor hook bridge (D81): a small self-contained CommonJS file Cursor runs for a few events.
//
// Cursor pipes the hook payload as JSON on stdin and does not say whether the hook process inherits the pty
// environment, so the script does nothing unless SESSIONDECK_SESSION_ID/PORT/TOKEN are set (a normal Cursor run is
// never disturbed). It forwards only the fields the app needs to the local HookServer with node's http module (no
// curl, no shell), never prints, always exits 0 and gives up after 3 s.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** File name under the settings dir; hooksFile recognises our entries by this text in the command. */
export const CURSOR_HOOK_SCRIPT_FILE = 'sessiondeck-cursor-hook.cjs'

/** Text every SessionDeck-owned Cursor hook command contains (merge rule in hooksFile.ts). */
export const CURSOR_HOOK_MARKER = 'sessiondeck-cursor-hook'

/** Source of the hook script (written verbatim, no build step: node runs it as a plain .cjs file). */
export const CURSOR_HOOK_SCRIPT = `'use strict'

// SessionDeck Cursor hook bridge (D81). Cursor pipes its JSON payload on stdin; we forward the few fields the app
// needs to the local HookServer. It never prints, always exits 0 and gives up after 3 s, so it can never block or
// disturb a Cursor run. Without the SESSIONDECK_* variables (a normal Cursor session) it does nothing at all.

const http = require('node:http')

const EVENTS = {
  beforeSubmitPrompt: { route: 'UserPromptSubmit', field: 'prompt' },
  stop: { route: 'Stop', field: null },
  afterAgentResponse: { route: 'CursorAnswer', field: 'text' }
}

function done() {
  process.exit(0)
}

function main() {
  const mapping = EVENTS[process.argv[2]]
  if (!mapping) return done()
  const id = process.env.SESSIONDECK_SESSION_ID
  const port = Number(process.env.SESSIONDECK_PORT)
  const token = process.env.SESSIONDECK_TOKEN
  if (!id || !port || !token) return done()

  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    input += chunk
    if (input.length > 1000000) done()
  })
  process.stdin.on('error', done)
  process.stdin.on('end', () => {
    let parsed
    try {
      parsed = JSON.parse(input)
    } catch {
      return done()
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return done()
    const body = {}
    if (typeof parsed.conversation_id === 'string') body.conversation_id = parsed.conversation_id
    if (mapping.field && typeof parsed[mapping.field] === 'string') body[mapping.field] = parsed[mapping.field]
    if (typeof parsed.message === 'string') body.message = parsed.message
    const payload = JSON.stringify(body)
    const req = http.request(
      {
        host: '127.0.0.1',
        port: port,
        path: '/hook/' + encodeURIComponent(id) + '/' + mapping.route,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          'x-token': token
        }
      },
      (res) => {
        res.resume()
        res.on('end', done)
        res.on('error', done)
      }
    )
    req.on('error', done)
    req.setTimeout(2000, () => {
      req.destroy()
      done()
    })
    req.write(payload)
    req.end()
  })

  setTimeout(done, 3000)
}

try {
  main()
} catch {
  done()
}
`

/**
 * Writes the hook script into `dir` (the same directory as the Claude settings file) and returns its absolute path.
 * The script path travels in the hooks.json command, so a changed settings dir replaces the old entry on the next
 * install (see mergeCursorHooks).
 */
export function writeCursorHookScript(dir: string): string {
  mkdirSync(dir, { recursive: true })
  const filePath = resolve(dir, CURSOR_HOOK_SCRIPT_FILE)
  writeFileSync(filePath, CURSOR_HOOK_SCRIPT, 'utf8')
  return filePath
}
