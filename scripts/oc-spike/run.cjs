const { spawnSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const plug = path.join(__dirname, 'plug.mjs').split(path.sep).join('/')
const log = path.join(__dirname, 'log.jsonl')
try { fs.unlinkSync(log) } catch {}
const env = {
  ...process.env,
  SPIKE_LOG: log,
  SESSIONDECK_SESSION_ID: 'abc',
  OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: ['file:///' + plug], permission: { '*': 'allow' } })
}
const r = spawnSync('opencode', ['run', '--model', 'opencode/deepseek-v4.1-flash-free', 'reply with the single word: ok'], { env, encoding: 'utf8', shell: true, timeout: 120000 })
console.log((r.stdout || '').slice(-200), (r.stderr || '').slice(-300))
console.log(fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').map((l) => l.slice(0, 220)).join('\n') : 'NO LOG')
