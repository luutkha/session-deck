import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeCursorHookScript } from './hookScript'

// The hook script runs for real: a tiny node http server (in its own process, so spawnSync cannot block it) records
// what the script posts. No real Cursor config and no real SessionDeck server are touched.
const SERVER_SOURCE = `'use strict'
const http = require('node:http')
const fs = require('node:fs')
const [portFile, logFile] = process.argv.slice(2)
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    fs.appendFileSync(
      logFile,
      JSON.stringify({ method: req.method, url: req.url, token: req.headers['x-token'] || null, contentType: req.headers['content-type'] || null, body }) + '\\n'
    )
    res.statusCode = 204
    res.end()
  })
})
server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(portFile, String(server.address().port))
})
`

interface Received {
  method: string
  url: string
  token: string | null
  contentType: string | null
  body: string
}

const SESSION_ID = 'deck-session-1'
const TOKEN = 'test-token'
const SESSION_ENV_KEYS = ['SESSIONDECK_SESSION_ID', 'SESSIONDECK_PORT', 'SESSIONDECK_TOKEN'] as const

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor<T>(what: string, read: () => T | null, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = read()
    if (value !== null) return value
    await sleep(25)
  }
  throw new Error(`Timed out waiting for ${what}`)
}

describe('Cursor hook script (real child process)', () => {
  let dir: string
  let scriptPath: string
  let server: ReturnType<typeof spawn>
  let port: number
  let logFile: string
  let portFile: string

  function received(): Received[] {
    if (!existsSync(logFile)) return []
    return readFileSync(logFile, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Received)
  }

  /** Environment a Cursor run started by SessionDeck sees; without the SESSIONDECK_* keys by default. */
  function envFor(withSession: boolean): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env }
    for (const key of SESSION_ENV_KEYS) delete env[key]
    if (withSession) {
      env.SESSIONDECK_SESSION_ID = SESSION_ID
      env.SESSIONDECK_PORT = String(port)
      env.SESSIONDECK_TOKEN = TOKEN
    }
    return env
  }

  function runHook(event: string, input: string, withSession = true): ReturnType<typeof spawnSync> {
    return spawnSync(process.execPath, [scriptPath, event], {
      input,
      env: envFor(withSession),
      encoding: 'utf8',
      timeout: 15000
    })
  }

  async function waitForRequests(count: number): Promise<Received[]> {
    return waitFor(`${count} hook request(s)`, () => {
      const all = received()
      return all.length >= count ? all : null
    })
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sessiondeck-cursor-hook-'))
    scriptPath = writeCursorHookScript(dir)
    logFile = join(dir, 'requests.jsonl')
    portFile = join(dir, 'port.txt')
    const serverScript = join(dir, 'server.cjs')
    writeFileSync(serverScript, SERVER_SOURCE, 'utf8')
    server = spawn(process.execPath, [serverScript, portFile, logFile], { stdio: 'ignore' })
    port = await waitFor('the test server port', () => {
      if (!existsSync(portFile)) return null
      const text = readFileSync(portFile, 'utf8').trim()
      return text.length > 0 ? Number(text) : null
    })
  })

  afterEach(() => {
    server.kill()
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes a self-contained CommonJS script', () => {
    const source = readFileSync(scriptPath, 'utf8')
    expect(scriptPath.endsWith('sessiondeck-cursor-hook.cjs')).toBe(true)
    expect(source).toContain("require('node:http')")
    expect(source).not.toContain('curl')
    expect(source).not.toContain('import ')
  })

  it('beforeSubmitPrompt posts the prompt to UserPromptSubmit', async () => {
    const payload = {
      conversation_id: 'chat-12345678',
      hook_event_name: 'beforeSubmitPrompt',
      prompt: 'fix the bug',
      workspace_roots: ['C:\\proj'],
      transcript_path: 'C:\\t.jsonl'
    }
    const result = runHook('beforeSubmitPrompt', JSON.stringify(payload))
    expect(result.status).toBe(0)

    const [request] = await waitForRequests(1)
    expect(request?.method).toBe('POST')
    expect(request?.url).toBe(`/hook/${SESSION_ID}/UserPromptSubmit`)
    expect(request?.token).toBe(TOKEN)
    expect(request?.contentType).toBe('application/json')
    expect(JSON.parse(request?.body ?? '{}')).toEqual({
      conversation_id: 'chat-12345678',
      prompt: 'fix the bug'
    })
  })

  it('stop posts Stop with the conversation id only', async () => {
    const payload = { conversation_id: 'chat-12345678', hook_event_name: 'stop', workspace_roots: ['C:\\proj'] }
    const result = runHook('stop', JSON.stringify(payload))
    expect(result.status).toBe(0)

    const [request] = await waitForRequests(1)
    expect(request?.url).toBe(`/hook/${SESSION_ID}/Stop`)
    expect(request?.token).toBe(TOKEN)
    expect(JSON.parse(request?.body ?? '{}')).toEqual({ conversation_id: 'chat-12345678' })
  })

  it('afterAgentResponse posts the reply text to CursorAnswer', async () => {
    const payload = {
      conversation_id: 'chat-12345678',
      hook_event_name: 'afterAgentResponse',
      text: 'Done: the tests pass.'
    }
    const result = runHook('afterAgentResponse', JSON.stringify(payload))
    expect(result.status).toBe(0)

    const [request] = await waitForRequests(1)
    expect(request?.url).toBe(`/hook/${SESSION_ID}/CursorAnswer`)
    expect(request?.token).toBe(TOKEN)
    expect(JSON.parse(request?.body ?? '{}')).toEqual({
      conversation_id: 'chat-12345678',
      text: 'Done: the tests pass.'
    })
  })

  it('does nothing without the SESSIONDECK_* env (a normal Cursor run)', async () => {
    const result = runHook('stop', JSON.stringify({ conversation_id: 'chat-12345678' }), false)
    expect(result.status).toBe(0)

    await sleep(300)
    expect(received()).toEqual([])
  })

  it('tolerates garbage stdin and still exits 0 without posting', async () => {
    const result = runHook('beforeSubmitPrompt', 'this is not json {')
    expect(result.status).toBe(0)

    await sleep(300)
    expect(received()).toEqual([])
  })

  it('exits 0 for an unknown event name without posting', async () => {
    const result = runHook('someOtherEvent', JSON.stringify({ conversation_id: 'chat-12345678' }))
    expect(result.status).toBe(0)

    await sleep(300)
    expect(received()).toEqual([])
  })
})
