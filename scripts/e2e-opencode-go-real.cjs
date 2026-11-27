// E2E (D95): the OpenCode Go quota bar appears with the machine's REAL OpenCode login, including a login stored under
// the plain "opencode" integration (the main OpenCode sign-in), not only under "opencode-go". A real OpenCode session
// starts in the built app; its plugin reads the login, asks the real Go usage endpoint and posts the allowance.
// Needs `opencode` on PATH and an OpenCode account that can use the Go plan; skipped (exit 0) when `opencode` is absent.
// Run: node scripts/e2e-opencode-go-real.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9488
const js = (v) => JSON.stringify(v)

async function main() {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['opencode'], { encoding: 'utf8' })
  if (probe.status !== 0) {
    console.log('SKIP  opencode is not installed on this machine')
    process.exit(0)
  }
  const t = makeChecker()
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-go-real-')))
  const userData = path.join(root, 'userdata')
  fs.mkdirSync(userData)
  const proj = path.join(root, 'proj')
  fs.mkdirSync(proj)
  let app
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    const ev = (x) => app.evaluate(x)
    await ev(`window.api.createSession({ cwd: ${js(proj)}, name: 'go real', agent: 'opencode' })`)
    // The plugin asks at setup, so no turn is needed; allow for OpenCode start-up and the network call.
    const state = await waitFor(async () => {
      const u = await ev('window.api.getUsage()')
      return (u.accounts ?? []).some((a) => a.provider === 'opencode-go') ? u : null
    }, 90000, 1500)
    t.check('the OpenCode Go account arrived in the usage state', !!state, js(state && state.accounts && state.accounts.map((a) => a.provider)))
    const go = state && state.accounts.find((a) => a.provider === 'opencode-go')
    const windows = go ? ['fiveHour', 'sevenDay', 'monthly'].filter((k) => go[k] && typeof go[k].usedPercentage === 'number') : []
    t.check('it carries at least one allowance window with a percentage', windows.length > 0, js(windows))
    await sleep(800)
    const bar = await ev(`document.querySelector('[data-account="opencode-go"]')?.innerText ?? null`)
    t.check('the status bar shows the Go group', typeof bar === 'string' && bar.length > 0, js(bar))
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.stack) || error))
  } finally {
    if (app) app.kill()
    await sleep(800)
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* a shell may still hold the folder */ }
  }
  process.exit(t.summary() ? 1 : 0)
}

main()
