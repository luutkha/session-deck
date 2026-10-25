// Probe round 3: how does OpenCode v2.1.4 load LOCAL plugins?
// Modes:
//   globaldir  - copy test plugins into ~/.config/opencode/plugins/ (cleaned up afterwards)
//   pkg        - OPENCODE_CONFIG=<file> whose `plugins` entry is an absolute package DIR (package.json + main)
//   pkgrel     - OPENCODE_CONFIG=<file> with a RELATIVE package dir entry `./pkg`
//   pkgcontent - OPENCODE_CONFIG_CONTENT (inline) with the absolute package dir entry
// Run: node scripts/probe-opencode-shapes3.cjs <mode>
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { sleep } = require('./e2e-lib.cjs')

const MODE = process.argv[2] ?? 'pkg'

function recordingServer() {
  return new Promise((resolve) => {
    const posts = []
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        if (!String(req.url).startsWith('/plugin')) return
        posts.push({ url: req.url, body })
        res.writeHead(204)
        res.end()
      })
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, posts }))
  })
}

function writeShapeFiles(base) {
  // Every shape that could register: v1 named export, v2 default export {id, setup}.
  const mk = (dir) => {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'opencode-sd-probe', version: '1.0.0', main: 'index.mjs' }))
    fs.writeFileSync(path.join(dir, 'index.mjs'), [
      "var post = function (body) { try { fetch('" + base.replace(/\\/g, '/') + "/plugin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(function () {}) } catch (e) {} }",
      "post({ via: 'import:' + process.env.__SD_TAG })",
      'export const SessionDeckPlugin = async function () { post({ via: "SessionDeckPluginCalled" }); return {} }',
      'export default { id: "sessiondeck-probe", setup: async function () { post({ via: "v2SetupCalled" }); return {} } }'
    ].join('\n'))
    return dir
  }
  return mk
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-probe-oc3-'))
  const { server, port, posts } = await recordingServer()
  const base = `http://127.0.0.1:${port}`
  process.env.__SD_TAG = MODE
  const mkDir = writeShapeFiles(base)
  const pkgDir = mkDir(path.join(root, 'pkg'))
  const homeCfg = path.join(process.env.USERPROFILE, '.config', 'opencode')
  let cleanup
  let extraEnv = {}

  if (MODE === 'globaldir') {
    fs.mkdirSync(path.join(homeCfg, 'plugins'), { recursive: true })
    // The global-dir discovery loads the FILE DIRECTLY, not as a package: copy a standalone module.
    fs.writeFileSync(path.join(homeCfg, 'plugins', 'sd-probe-shapes.mjs'), [
      "var post = function (body) { try { fetch('" + base + "/plugin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(function () {}) } catch (e) {} }",
      "post({ via: 'import:globaldir' })",
      'export const SessionDeckPlugin = async function () { post({ via: "SessionDeckPluginCalled" }); return {} }',
      'export default { id: "sessiondeck-probe-global", setup: async function () { post({ via: "v2SetupCalled" }); return {} } }'
    ].join('\n'))
    cleanup = () => { try { fs.rmSync(path.join(homeCfg, 'plugins', 'sd-probe-shapes.mjs'), { force: true }) } catch {} }
  } else if (MODE === 'pkgsub2') {
    // Ground-truth probe: raw event payloads + force a permission ask (bash permission is 'ask').
    fs.mkdirSync(pkgDir, { recursive: true })
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'opencode-sd-probe-sub2', version: '1.0.0', main: 'index.mjs' }))
    fs.writeFileSync(path.join(pkgDir, 'index.mjs'), [
      "var post = function (body) { try { fetch('" + base + "/plugin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(function () {}) } catch (e) {} }",
      'export default {',
      '  id: "sessiondeck-probe-sub2",',
      '  setup: async function (context) {',
      "    post({ via: 'setupCalled' })",
      '    void (async function () {',
      '      try {',
      '        var events = await context.event.subscribe()',
      '        for await (var event of events) {',
      "          var type = event && typeof event.type === 'string' ? event.type : '?'",
      "          var interesting = type !== 'session.text.delta' && type.indexOf('.tool.') < 0 && type.indexOf('.watcher') < 0 && type.indexOf('.streamed') < 0 && type.indexOf('.step.') < 0 && type.indexOf('.inbox') < 0 && type.indexOf('.instructions') < 0 && type.indexOf('.text.') < 0",
      "          var keys = Object.keys(event || {})",
      '          post({ via: "ev:" + type, keys: keys.join(","), data: interesting ? JSON.stringify(event).slice(0, 500) : null })',
      '        }',
      '      } catch (e) {}',
      '    })()',
      '  }',
      '}'
    ].join('\n'))
    fs.mkdirSync(path.join(root, 'proj'), { recursive: true })
    const cfgFile = path.join(root, 'cfg.json')
    fs.writeFileSync(cfgFile, JSON.stringify({
      plugin: [pkgDir.replace(/\\/g, '/')], // SINGULAR key, as SessionDeck's pluginEnv writes it
      permission: { '*': 'allow', bash: 'ask' }
    }, null, 2))
    extraEnv.OPENCODE_CONFIG_CONTENT = fs.readFileSync(cfgFile, 'utf8')
    extraEnv.__SD_TAG = MODE
    cleanup = () => {}
  } else if (MODE === 'pkgsub') {
    // FINAL-shape probe: default export {id, setup} + context.event.subscribe() iteration (the pattern the
    // rewritten SessionDeck plugin will use). If event types POST, the fix is proven end-to-end.
    fs.mkdirSync(pkgDir, { recursive: true })
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'opencode-sd-probe-sub', version: '1.0.0', main: 'index.mjs' }))
    fs.writeFileSync(path.join(pkgDir, 'index.mjs'), [
      "var post = function (body) { try { fetch('" + base + "/plugin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(function () {}) } catch (e) {} }",
      'export default {',
      '  id: "sessiondeck-probe-sub",',
      '  setup: async function (context) {',
      "    post({ via: 'setupCalled' })",
      '    void (async function () {',
      '      try {',
      '        var events = await context.event.subscribe()',
      '        for await (var event of events) {',
      "          post({ via: 'event', type: event && typeof event.type === 'string' ? event.type : '?' })",
      '        }',
      '      } catch (e) {}',
      '    })()',
      '  }',
      '}'
    ].join('\n'))
    fs.mkdirSync(path.join(root, 'proj'), { recursive: true })
    const cfgFile = path.join(root, 'cfg.json')
    fs.writeFileSync(cfgFile, JSON.stringify({ plugins: [pkgDir.replace(/\\/g, '/')], permission: { '*': 'allow' } }, null, 2))
    extraEnv.OPENCODE_CONFIG_CONTENT = fs.readFileSync(cfgFile, 'utf8')
    extraEnv.__SD_TAG = MODE
    cleanup = () => {}
  } else if (MODE === 'pkgv1') {
    // v1 NAMED-export shape (SessionDeckPlugin returning hooks) inside a package dir, referenced via
    // OPENCODE_CONFIG_CONTENT "plugins": [absDir]. If the event hook fires, SessionDeck's plugin source can stay.
    fs.mkdirSync(pkgDir, { recursive: true })
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'opencode-sd-probe-v1', version: '1.0.0', main: 'index.mjs' }))
    fs.writeFileSync(path.join(pkgDir, 'index.mjs'), [
      "var post = function (body) { try { fetch('" + base + "/plugin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(function () {}) } catch (e) {} }",
      'export const SessionDeckPlugin = async function () {',
      "  post({ via: 'v1PluginCalled' })",
      '  return {',
      '    event: async function (hookInput) {',
      "      var ev = hookInput && hookInput.event",
      "      post({ via: 'event', type: ev && typeof ev.type === 'string' ? ev.type : String(ev && ev.type) })",
      '    }',
      '  }',
      '}'
    ].join('\n'))
    fs.mkdirSync(path.join(root, 'proj'), { recursive: true })
    const cfgFile = path.join(root, 'cfg.json')
    fs.writeFileSync(cfgFile, JSON.stringify({ plugins: [pkgDir.replace(/\\/g, '/')], permission: { '*': 'allow' } }, null, 2))
    extraEnv.OPENCODE_CONFIG_CONTENT = fs.readFileSync(cfgFile, 'utf8')
    extraEnv.__SD_TAG = MODE
    cleanup = () => {}
  } else if (MODE === 'pkghook') {
    // v2 shape whose setup returns an `event` hook: does anything call it in v2?
    fs.mkdirSync(pkgDir, { recursive: true })
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'opencode-sd-probe-hook', version: '1.0.0', main: 'index.mjs' }))
    fs.writeFileSync(path.join(pkgDir, 'index.mjs'), [
      "var post = function (body) { try { fetch('" + base + "/plugin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(function () {}) } catch (e) {} }",
      'export default {',
      '  id: "sessiondeck-probe-hook",',
      '  setup: async function (input) {',
      "    post({ via: 'setupArgs:' + Object.keys(input || {}).join(',') })",
      '    return {',
      '      event: async function (hookInput) {',
      "        var ev = hookInput && hookInput.event",
      "        post({ via: 'event', type: ev && typeof ev.type === 'string' ? ev.type : String(ev && ev.type) })",
      '      }',
      '    }',
      '  }',
      '}'
    ].join('\n'))
    fs.mkdirSync(path.join(root, 'proj'), { recursive: true })
    const cfgFile = path.join(root, 'cfg.json')
    fs.writeFileSync(cfgFile, JSON.stringify({ plugins: [pkgDir.replace(/\\/g, '/')], permission: { '*': 'allow' } }, null, 2))
    extraEnv.OPENCODE_CONFIG_CONTENT = fs.readFileSync(cfgFile, 'utf8')
    extraEnv.__SD_TAG = MODE
    cleanup = () => {}
  } else {
    const cfgDir = path.join(root, 'proj')
    fs.mkdirSync(cfgDir, { recursive: true })
    const entry = MODE === 'pkgrel' ? './pkg' : pkgDir.replace(/\\/g, '/')
    const target = MODE === 'pkgrel' ? path.join(root, 'pkg') : pkgDir
    // ./pkg entry relative to the config file means the config must sit next to ./pkg
    const cfgFile = MODE === 'pkgrel' ? pkgDir.replace(/\\/g, '/') + '/opencode.json' : path.join(root, 'cfg.json')
    if (MODE === 'pkgrel') {
      // config file inside pkgDir, projects runs with cwd elsewhere; openecode run uses path arg
      fs.writeFileSync(cfgFile, JSON.stringify({ plugins: ['./pkg'], permission: { '*': 'allow' } }, null, 2))
    } else {
      fs.writeFileSync(cfgFile, JSON.stringify({ plugins: [entry], permission: { '*': 'allow' } }, null, 2))
    }
    if (MODE === 'pkgcontent') {
      extraEnv.OPENCODE_CONFIG_CONTENT = fs.readFileSync(path.join(root, 'cfg.json'), 'utf8')
    } else {
      extraEnv.OPENCODE_CONFIG = cfgFile.replace(/\\/g, '/')
    }
    extraEnv.__SD_TAG = MODE
    if (MODE !== 'plugin-add') {
      // package dir is target
      void target
    }
  }

  const proj = path.join(root, 'proj2')
  fs.mkdirSync(proj)
  console.log('mode=' + MODE)
  const msg = process.argv[3] ?? 'reply with the single word: pong'
  const child = spawn(process.env.COMSPEC ?? 'cmd.exe', ['/c', 'opencode', 'run', '--standalone', '--print-logs', '--log-level', 'debug', msg], {
    cwd: proj,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let out = '', err = ''
  child.stdout.on('data', (d) => { out += d.toString() })
  child.stderr.on('data', (d) => { err += d.toString() })
  const code = await new Promise((resolve) => {
    const t = setTimeout(() => { try { child.kill() } catch {} resolve(-1) }, 90000)
    child.on('close', (c) => { clearTimeout(t); resolve(c) })
  })
  console.log('exit', code, 'stdout:', out.replace(/\r?\n/g, ' ').slice(0, 150))
  await sleep(1500)
  console.log(`POSTs (${posts.length}):`)
  for (const p of posts) console.log(' ', p.body.slice(0, 900))
  // Plugin-related log lines
  const lines = err.split(/\r?\n/).filter((l) => /plugin|Plugin/i.test(l))
  for (const l of lines.slice(0, 15)) console.log('LOG', l.slice(0, 800))
  if (cleanup) cleanup()
  server.close()
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  process.exit(0)
}
main().catch((e) => { console.log('probe error:', e); process.exit(1) })
