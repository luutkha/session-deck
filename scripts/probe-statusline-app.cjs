// Replicates the app's environment for ONE claude turn: the app's generated settings file + a local server standing in
// for the hook server. Prints every request Claude's hook/statusLine commands make. Usage: node scripts/probe-statusline-app.cjs <settings.json>
const fs = require('node:fs')
const http = require('node:http')
const pty = require('node-pty')

const settingsSrc = process.argv[2]
if (!settingsSrc) { console.log('usage: node scripts/probe-statusline-app.cjs <path to sessiondeck-hooks.json>'); process.exit(2) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const requests = []

const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    requests.push({ url: req.url, method: req.method, token: req.headers['x-token'], bytes: body.length, head: body.slice(0, 60) })
    res.statusCode = 204
    res.end()
  })
})

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port
  const env = { ...process.env, TERM: 'xterm-256color', SESSIONDECK_SESSION_ID: 'probe-session', SESSIONDECK_PORT: String(port), SESSIONDECK_TOKEN: 'probe-token' }
  for (const k of Object.keys(env)) if (/^(CLAUDE_CODE|CLAUDECODE|CLAUDE_AGENT)/.test(k) || k === 'NO_COLOR') delete env[k]
  const p = pty.spawn('cmd.exe', ['/d', '/c', 'claude', '--settings', settingsSrc], { name: 'xterm-256color', cols: 120, rows: 30, cwd: process.cwd(), env, useConpty: true })
  await sleep(9000)
  for (let i = 0; i < 3; i += 1) { p.write('\r'); await sleep(2000) }
  p.write('Reply with the single word ok')
  await sleep(500)
  p.write('\r')
  for (let i = 0; i < 30; i += 1) { await sleep(2000); if (requests.some((r) => r.url.startsWith('/statusline'))) break }
  await sleep(4000)
  try { p.kill() } catch { /* gone */ }
  console.log(`requests received by the stand-in server: ${requests.length}`)
  for (const r of requests) console.log(`  ${r.method} ${r.url} token=${r.token === 'probe-token' ? 'ok' : r.token} bytes=${r.bytes} ${r.head.replace(/\s+/g, ' ')}`)
  server.close()
  process.exit(requests.some((r) => r.url.startsWith('/statusline')) ? 0 : 1)
})
