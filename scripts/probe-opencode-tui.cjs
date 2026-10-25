// Ground-truth probe: does the REAL opencode TUI (--standalone) load the SessionDeck plugin packages from
// OPENCODE_CONFIG_CONTENT and post events? Types one prompt into a pty TUI run and dumps every POST the plugin
// makes to a local catcher. Uses the exact plugin dirs the app writes (copied from the newest e2e temp userData).
// Run: node scripts/run-e2e-detached.cjs probe-opencode-tui.cjs   (log: scripts/probe-opencode-tui-last.log)
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const pty = require('node-pty')
const { sleep } = require('./e2e-lib.cjs')

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-probe-tui-'))
  const posts = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      posts.push({ url: req.url, body, at: Date.now() })
      res.writeHead(204)
      res.end()
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port

  // Copy the plugin package dirs exactly as the app writes them.
  const e2eTemp = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('sessiondeck-e2e-'))
    .map((d) => path.join(os.tmpdir(), d)).filter((d) => fs.existsSync(path.join(d, 'sessiondeck-attention', 'sessiondeck-opencode-plugin', 'package.json')))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
  console.log('source userData:', e2eTemp)
  const attention = path.join(e2eTemp, 'sessiondeck-attention')
  const dirs = []
  for (const name of ['sessiondeck-opencode-plugin', 'sessiondeck-worker-plugin']) {
    const dest = path.join(root, name)
    fs.cpSync(path.join(attention, name), dest, { recursive: true })
    dirs.push(dest.replace(/\\/g, '/'))
  }
  const proj = path.join(root, 'proj')
  fs.mkdirSync(proj)
  const content = JSON.stringify({ plugin: dirs, permission: { '*': 'allow' } })
  console.log('OPENCODE_CONFIG_CONTENT:', content)

  const p = pty.spawn('cmd.exe', ['/c', 'opencode', '--standalone'], {
    name: 'xterm-256color',
    cwd: proj,
    env: {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: content,
      SESSIONDECK_PORT: String(port),
      SESSIONDECK_SESSION_ID: 'probeoc',
      SESSIONDECK_TOKEN: 'probetok'
    }
  })
  let out = ''
  p.onData((d) => { out += d })
  p.onExit((code) => console.log('pty exit', code))

  await sleep(5000) // banner
  p.write('reply with the single word: pong\r')
  await sleep(90000) // generous: free model latency
  p.write('\x1b')
  await sleep(500)
  p.write('q')
  p.kill()
  await sleep(2000)
  server.close()

  console.log(`POSTs (${posts.length}):`)
  for (const post of posts) console.log(' ', post.url, (post.body || '').slice(0, 300))
  console.log('--- pty tail ---')
  console.log(out.slice(-1500).replace(/\r?\n/g, ' | '))
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }) } catch {}
  process.exit(0)
}
main().catch((e) => { console.error('probe error:', (e && e.stack) || e); process.exit(1) })
