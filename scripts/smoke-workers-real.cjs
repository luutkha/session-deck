// Manual smoke test (uses a free OpenCode model, needs `opencode` on PATH): a real `opencode run`, started the way
// the orchestrator skill starts it (cmd.exe), inherits the env a Claude terminal gets and must appear as a worker tab.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

async function main() {
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-smoke-workers-'))
  const endpointFile = path.join(root, 'endpoint.json')
  process.env.SESSIONDECK_E2E_ENDPOINT_FILE = endpointFile
  try {
    const proj = path.join(root, 'proj')
    fs.mkdirSync(proj)
    fs.writeFileSync(path.join(proj, 'data.txt'), 'hello-smoke')
    app = await launchApp({ port: 9377 })
    await sleep(1200)
    const s = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(proj)}, name: 'smoke-claude' })`)
    await sleep(1500)
    await app.evaluate(`[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes('smoke-claude'))?.click()`)
    const endpoint = JSON.parse(fs.readFileSync(endpointFile, 'utf8'))
    const pluginFile = path.join(app.userData, 'sessiondeck-attention', 'sessiondeck-worker-plugin.mjs')
    const config = JSON.stringify({ plugin: ['file:///' + pluginFile.replace(/\\/g, '/')] })
    const env = { ...process.env, SESSIONDECK_SESSION_ID: s.id, SESSIONDECK_PORT: String(endpoint.port), SESSIONDECK_TOKEN: endpoint.token, OPENCODE_CONFIG_CONTENT: config }
    const brief = '# Smoke task: read data.txt\nRead the file data.txt with your read tool and reply with its content.'
    const child = spawn('cmd.exe', ['/d', '/s', '/c', 'opencode run --format json -m opencode/big-pickle'], { env, cwd: proj, stdio: ['pipe', 'ignore', 'ignore'] })
    child.stdin.end(brief)
    const exited = new Promise((resolve) => child.on('exit', resolve))

    const chips = () => app.evaluate(`[...document.querySelectorAll('[data-worker-id]')].map((n) => n.getAttribute('data-worker-status') + ':' + n.innerText.trim())`)
    const seen = await waitFor(async () => { const c = await chips(); return c.length >= 1 ? c : null }, 60000, 500)
    t.check('a real opencode run shows up as a worker tab', !!seen, JSON.stringify(seen))
    await app.evaluate(`document.querySelector('[data-worker-id]')?.click()`)
    await exited
    const done = await waitFor(async () => ((await chips())[0] || '').startsWith('done:'), 15000, 500)
    t.check('it finishes as done', !!done, JSON.stringify(await chips()))
    const view = await app.evaluate(`document.querySelector('[data-worker-view]')?.innerText ?? ''`)
    const flags = { read: view.indexOf('read') >= 0, finished: view.indexOf('Finished') >= 0, tokens: view.indexOf('tokens') >= 0 }
    t.check('the view shows a tool call, tokens and the finished state', flags.read && flags.finished && flags.tokens, JSON.stringify(flags))
    t.check('the view names the model', view.includes('big-pickle'))
    console.log('\nVIEW:\n' + view)
  } catch (e) {
    t.check('run completed without exception', false, String(e.message || e))
  } finally {
    if (app) app.kill()
    await sleep(500)
    fs.rmSync(root, { recursive: true, force: true })
    process.exit(t.summary() ? 1 : 0)
  }
}
main()
