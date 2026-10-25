// Probe: which plugin contract does the installed OpenCode (v2.1.4) accept? One test module provides every
// candidate export shape; each posts `via:<Shape>` to a local recording server the moment it is evaluated, plus a
// marker when its function is called. The config key (singular `plugin` vs plural `plugins`) is chosen by arg.
// Run: node scripts/probe-opencode-plugins.cjs [plugin|plugins]
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const MODE = process.argv[2] ?? 'plugin'
const PORT = Number(process.argv[3] ?? 0)

function recordingServer() {
  return new Promise((resolve) => {
    const posts = []
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        if (!req.url.startsWith('/_/ignore')) posts.push({ url: req.url, body })
        res.writeHead(204)
        res.end()
      })
    })
    server.listen(PORT ?? 0, '127.0.0.1', () => resolve({ server, port: server.address().port, posts }))
  })
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-probe-oc-shapes-'))
  const { server, port, posts } = await recordingServer()
  const url = (p) => 'file:///' + p.replace(/\\/g, '/').replace(/^\/+/, '')
  const base = `http://127.0.0.1:${port}/plugin`

  // Every shape posts "import:<name>" at module evaluation and "<name>:called" when OpenCode calls it.
  const pluginFile = path.join(root, 'shapes.mjs')
  fs.writeFileSync(pluginFile, `
var post = function (body) { try { fetch('${base}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(function () {}) } catch (e) {} }
post({ via: 'import' })
export const SessionDeckPlugin = async function () { post({ via: 'SessionDeckPluginCalled' }); return {} }
export const SessionDeckPluginV2 = async function () { post({ via: 'SessionDeckPluginV2Called' }); return { plugin: { id: 'sd-v2-named' } } }
export default async function () { post({ via: 'defaultFnCalled' }); return {} }
export default undefined
`)
  // A second module with the documented v2 shape: default export = plugin object { id, setup }.
  const pluginFileV2 = path.join(root, 'shapes-v2.mjs')
  fs.writeFileSync(pluginFileV2, `
var post = function (body) { try { fetch('${base}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(function () {}) } catch (e) {} }
post({ via: 'import-v2' })
export default {
  id: 'sessiondeck-shapes-v2',
  setup: async function () { post({ via: 'v2SetupCalled' }); return {} }
}
`)

  const proj = path.join(root, 'proj')
  fs.mkdirSync(proj)

  console.log(`opencode mode=${MODE}`)
  let configContent = undefined
  const extraEnv = {}
  // mode=paths: absolute paths in the config key
  if (MODE === 'plugin' || MODE === 'plugins') {
    configContent = JSON.stringify({ [CONFIG_KEY]: [pluginFile, pluginFileV2], permission: { '*': 'allow' } })
  }
  // mode=abs: absolute Windows paths as plugin entries
  if (MODE === 'abs' || MODE === 'abs2') {
    const key = MODE === 'abs' ? 'plugin' : 'plugins'
    configContent = JSON.stringify({ [key]: [pluginFile.replace(/\\/g, '/'), pluginFileV2.replace(/\\/g, '/')], permission: { '*': 'allow' } })
  }
  // mode=projectdir: drop files into .opencode/plugins/ of the project (auto discovery)
  if (MODE === 'projectdir') {
    fs.mkdirSync(path.join(proj, '.opencode', 'plugins'), { recursive: true })
    fs.copyFileSync(pluginFile, path.join(proj, '.opencode', 'plugins', 'a-shapes.mjs'))
    fs.copyFileSync(pluginFileV2, path.join(proj, '.opencode', 'plugins', 'b-shapes-v2.mjs'))
    configContent = JSON.stringify({ permission: { '*': 'allow' } })
  }
  // mode=configdir: OPENCODE_CONFIG_DIR + <dir>/plugins/*.mjs
  if (MODE === 'configdir') {
    const cfgDir = path.join(root, 'oc-cfg')
    fs.mkdirSync(path.join(cfgDir, 'plugins'), { recursive: true })
    fs.copyFileSync(pluginFile, path.join(cfgDir, 'plugins', 'a-shapes.mjs'))
    fs.copyFileSync(pluginFileV2, path.join(cfgDir, 'plugins', 'b-shapes-v2.mjs'))
    fs.writeFileSync(path.join(cfgDir, 'opencode.json'), JSON.stringify({ permission: { '*': 'allow' } }))
    extraEnv.OPENCODE_CONFIG_DIR = cfgDir
    configContent = ''
  }
  if (configContent) extraEnv.OPENCODE_CONFIG_CONTENT = configContent
  // mode=tui: run the TUI (not `run`) — the mode SessionDeck sessions actually use.
  const isTui = MODE === 'tui'
  // Always use a private server: the shared background service would run OUR plugins with ITS env.
  const runArgs = isTui ? [] : ['run', '--standalone', 'reply with the single word: pong']
  const child = spawn(process.env.COMSPEC ?? 'cmd.exe', ['/c', 'opencode', ...runArgs], {
    cwd: proj,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let out = ''
  let err = ''
  child.stdout.on('data', (d) => { out += d.toString() })
  child.stderr.on('data', (d) => { err += d.toString() })
  const code = await new Promise((resolve) => {
    const t = setTimeout(() => { try { child.kill('SIGKILL') } catch {} resolve(-1) }, 75000)
    child.on('close', (c) => { clearTimeout(t); resolve(c) })
  })
  console.log('exit', code, 'stdout:', out.replace(/\r?\n/g, ' ').slice(0, 200))
  if (err.trim()) console.log('stderr:', err.trim().slice(0, 800))
  await new Promise((r) => setTimeout(r, 1500))
  console.log(`POSTs (${posts.length}):`)
  for (const p of posts) console.log(' ', p.url, p.body.slice(0, 120))
  server.close()
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
}
main().then(() => process.exit(0)).catch((e) => { console.log('probe error:', e); process.exit(1) })
