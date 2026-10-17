// Captures the JSON Claude Code pipes to a statusLine command (run in a real PTY, one tiny prompt).
// Usage: node scripts/probe-statusline.cjs   -> prints the payload structure (values of rate limits only, no personal data)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const pty = require('node-pty')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-statusline-'))
const dump = path.join(dir, 'payload.json')
const settings = path.join(dir, 'settings.json')
// The command writes each payload to a file (last one wins) and prints nothing.
fs.writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command', command: `cat > "${dump.replace(/\\/g, '/')}"` } }))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const env = { ...process.env, TERM: 'xterm-256color' }
for (const k of Object.keys(env)) if (/^(CLAUDE_CODE|CLAUDECODE|CLAUDE_AGENT)/.test(k) || k === 'NO_COLOR') delete env[k]

;(async () => {
  const p = pty.spawn('cmd.exe', ['/d', '/c', 'claude', '--settings', settings], { name: 'xterm-256color', cols: 120, rows: 30, cwd: process.cwd(), env, useConpty: true })
  let out = ''
  p.onData((d) => { out += d })
  await sleep(9000)
  for (let i = 0; i < 3; i += 1) { p.write('\r'); await sleep(2000) }
  p.write('Reply with the single word ok')
  await sleep(500)
  p.write('\r')
  for (let i = 0; i < 40 && !fs.existsSync(dump); i += 1) await sleep(1500)
  await sleep(6000)
  try { p.kill() } catch { /* gone */ }
  if (!fs.existsSync(dump)) { console.log('NO PAYLOAD CAPTURED (statusLine never ran)'); process.exit(1) }
  const raw = fs.readFileSync(dump, 'utf8')
  let json
  try { json = JSON.parse(raw) } catch { console.log('payload is not JSON:', raw.slice(0, 200)); process.exit(1) }
  // Print the SHAPE: keys with primitive values shown, strings shortened, paths/ids redacted.
  const shape = (v, depth = 0) => {
    if (v === null || typeof v !== 'object') return typeof v === 'string' ? (v.length > 24 ? v.slice(0, 8) + '…(' + v.length + ')' : v) : v
    if (Array.isArray(v)) return v.slice(0, 2).map((x) => shape(x, depth + 1))
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, depth > 3 ? '…' : shape(x, depth + 1)]))
  }
  console.log(JSON.stringify(shape(json), null, 1))
  fs.rmSync(dir, { recursive: true, force: true })
  process.exit(0)
})().catch((e) => { console.log('ERR', e.message); process.exit(1) })
