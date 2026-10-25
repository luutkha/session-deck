// Probe: does a REAL `opencode` process load the two SessionDeck plugins and POST? Watching raw posts on a
// standalone HTTP server (no app involved) so nothing else can swallow them. Run: node scripts/probe-opencode-plugins.cjs
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { sleep, launchApp } = require('./e2e-lib.cjs')

function recordingServer() {
  return new Promise((resolve) => {
    const posts = []
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        posts.push({ at: Date.now(), url: req.url, body })
        res.writeHead(req.url.startsWith('/hook/') || req.url.startsWith('/statusline/') ? 204 : 200)
        res.end('{}')
      })
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, posts }))
  })
}

async function main() {
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-probe-oc-plugins-'))
  process.env.SESSIONDECK_E2E_ENDPOINT_FILE = path.join(root, 'endpoint.json')
  try {
    app = await launchApp({ port: 9459, userData: root })
    await sleep(1500)
    const attentionDir = path.join(app.userData, 'sessiondeck-attention')
    const workerFile = path.join(root, 'worker-plugin.mjs')
    const sessionFile = path.join(root, 'session-plugin.mjs')
    fs.copyFileSync(path.join(attentionDir, 'sessiondeck-worker-plugin.mjs'), workerFile)
    fs.copyFileSync(path.join(attentionDir, 'sessiondeck-opencode-plugin.mjs'), sessionFile)
    app.kill()
    await sleep(800) // app gone; only our server can hear plugins now

    const { server, port, posts } = await recordingServer()
    const url = (p) => 'file:///' + p.replace(/\\/g, '/').replace(/^\/+/, '')
    const configContent = JSON.stringify({ plugin: [url(workerFile), url(sessionFile)], permission: { '*': 'allow' } })
    const proj = path.join(root, 'proj')
    fs.mkdirSync(proj)
    console.log('recording on port', port)
    const child = spawn(process.env.COMSPEC ?? 'cmd.exe', ['/c', 'opencode', 'run', '--print-logs', '--log-level', 'info', 'reply with the single word: pong'], {
      cwd: proj,
      env: {
        ...process.env,
        SESSIONDECK_PORT: String(port),
        SESSIONDECK_TOKEN: 'probe-token',
        SESSIONDECK_SESSION_ID: 'ses_probe123',
        OPENCODE_CONFIG_CONTENT: configContent
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    child.stderr.on('data', (d) => { err += d.toString() })
    const code = await new Promise((resolve) => {
      const t = setTimeout(() => { child.kill(); resolve(-1) }, 90000)
      child.on('close', (c) => { clearTimeout(t); resolve(c) })
    })
    console.log('exit', code, '| posts:', posts.length)
    for (const p of posts.slice(0, 12)) console.log('  POST', p.url, p.body.slice(0, 220))
    if (out) console.log('--- stdout ---\n' + out.slice(0, 1200))
    const errTail = err
    if (errTail) console.log('--- stderr (grep plugin) ---\n' + errTail.split(/\\r?\\n/).filter((l) => /plugin|sessiondeck|error/i.test(l)).slice(0, 30).join('\\n'))
  } catch (error) {
    console.log('probe error:', error)
  } finally {
    if (app) app.kill()
    await sleep(800)
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }) } catch {}
  }
}
main()
