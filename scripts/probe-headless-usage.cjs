// Does a headless `claude -p` run invoke the statusLine command and deliver rate_limits? (one tiny haiku request)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-headless-'))
const dump = path.join(dir, 'payload.json').replace(/\\/g, '/')
const settings = path.join(dir, 'settings.json')
fs.writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command', command: `cat > "${dump}"` } }))

const env = { ...process.env }
for (const k of Object.keys(env)) if (/^(CLAUDE_CODE|CLAUDECODE|CLAUDE_AGENT)/.test(k) || k === 'NO_COLOR') delete env[k]
const started = Date.now()
const r = spawnSync('claude', ['-p', 'Reply with the single word ok', '--model', 'haiku', '--output-format', 'json', '--no-session-persistence', '--settings', settings], { cwd: dir, env, encoding: 'utf8', shell: true, timeout: 120000 })
console.log(`exit=${r.status} in ${Date.now() - started}ms`)
let out = null
try { out = JSON.parse(r.stdout) } catch { console.log('stdout (not JSON):', (r.stdout || '').slice(0, 300), (r.stderr || '').slice(0, 300)) }
if (out) console.log('result keys:', Object.keys(out).join(', '), '| total_cost_usd =', out.total_cost_usd, '| is_error =', out.is_error)
const have = fs.existsSync(dump.replace(/\//g, path.sep))
console.log('statusLine invoked in -p mode:', have)
if (have) {
  const j = JSON.parse(fs.readFileSync(dump.replace(/\//g, path.sep), 'utf8'))
  console.log('rate_limits present:', !!j.rate_limits, j.rate_limits ? JSON.stringify({ five: j.rate_limits.five_hour?.used_percentage, week: j.rate_limits.seven_day?.used_percentage }) : '')
}
fs.rmSync(dir, { recursive: true, force: true })
