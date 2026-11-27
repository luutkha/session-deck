// E2E (D96): quota bars for the extra agents (Codex, Cursor, Kimi, Grok), here through Codex. Each agent's own login is
// read from disk and its provider asked for the plan allowance, but only while a session of that agent is open.
// A local HTTP server stands in for chatgpt.com (SESSIONDECK_E2E_PROVIDER_USAGE_ORIGIN, loopback only) and a fake
// `codex.cmd` on PATH makes the session a Codex CLI session. Checks: no bar and no request without a session; with a
// session the Codex bar appears with the served numbers and the login was sent as a bearer token; the token never
// reaches the usage state; the Settings switch hides the bar and brings it back; closing the session removes it.
// Run: node scripts/e2e-agent-usage.cjs
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9489
const js = (v) => JSON.stringify(v)
const TOKEN = 'e2e-secret-token-123'

async function main() {
  const t = makeChecker()
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-agent-usage-')))
  const userData = path.join(root, 'userdata')
  fs.mkdirSync(userData)
  const bin = path.join(root, 'bin')
  fs.mkdirSync(bin)
  const proj = path.join(root, 'proj')
  fs.mkdirSync(proj)
  const codexHome = path.join(root, 'codex-home')
  fs.mkdirSync(codexHome)
  fs.writeFileSync(path.join(codexHome, 'auth.json'), js({ tokens: { access_token: TOKEN, account_id: 'acct-e2e' } }))
  fs.writeFileSync(path.join(bin, 'fake.js'), `console.log('FAKE-CODEX READY'); setInterval(() => {}, 1000)`)
  fs.writeFileSync(path.join(bin, 'codex.cmd'), '@node "%~dp0fake.js" %*\r\n')

  const requests = []
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization })
    const nowSec = Math.floor(Date.now() / 1000)
    res.setHeader('content-type', 'application/json')
    res.end(js({
      rate_limit: {
        primary_window: { used_percent: 37, limit_window_seconds: 18000, reset_at: nowSec + 3600 },
        secondary_window: { used_percent: 12, limit_window_seconds: 604800, reset_at: nowSec + 3 * 86400 }
      }
    }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`

  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`
  process.env.CODEX_HOME = codexHome
  process.env.SESSIONDECK_E2E_PROVIDER_USAGE_ORIGIN = origin

  let app
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(2500)
    const ev = (x) => app.evaluate(x)
    const accounts = async () => ((await ev('window.api.getUsage()')).accounts ?? []).map((a) => a.provider)

    t.check('no Codex bar and no request without a Codex session', !(await accounts()).includes('codex') && requests.length === 0, js({ accounts: await accounts(), requests: requests.length }))

    const made = await ev(`window.api.createSession({ cwd: ${js(proj)}, agent: 'shell', cliAgent: 'codex' })`)
    const usage = await waitFor(async () => {
      const u = await ev('window.api.getUsage()')
      return (u.accounts ?? []).some((a) => a.provider === 'codex') ? u : null
    }, 20000, 400)
    t.check('the Codex account arrives while its session is open', !!usage, js(await accounts()))
    const codex = usage && usage.accounts.find((a) => a.provider === 'codex')
    t.check('it carries the served numbers (5h 37%, week 12%)', !!codex && codex.fiveHour && codex.fiveHour.usedPercentage === 37 && codex.sevenDay && codex.sevenDay.usedPercentage === 12, js(codex))
    t.check('the login was sent as a bearer token', requests.length > 0 && requests[0].authorization === `Bearer ${TOKEN}`, js(requests[0] && { url: requests[0].url, auth: requests[0].authorization && requests[0].authorization.slice(0, 12) }))
    t.check('the token is nowhere in the usage state', !js(await ev('window.api.getUsage()')).includes(TOKEN))
    await sleep(800)
    const bar = await ev(`document.querySelector('[data-account="codex"]')?.innerText ?? null`)
    t.check('the status bar shows the Codex group', typeof bar === 'string' && /37/.test(bar), js(bar))

    // The Settings switch hides the bar at once and brings it back.
    await ev(`window.api.updateSettings({ quota: { showAgentUsage: false } })`)
    const hidden = await waitFor(async () => (!(await accounts()).includes('codex') ? true : null), 8000, 300)
    t.check('switching "Show Codex, Cursor, Kimi and Grok usage" off removes the bar', !!hidden, js(await accounts()))
    await ev(`window.api.updateSettings({ quota: { showAgentUsage: true } })`)
    const back = await waitFor(async () => ((await accounts()).includes('codex') ? true : null), 20000, 400)
    t.check('switching it on again brings the bar back', !!back, js(await accounts()))

    // Closing the only Codex session removes the bar.
    await ev(`window.api.closeSession(${js(made.id)})`)
    const gone = await waitFor(async () => (!(await accounts()).includes('codex') ? true : null), 15000, 400)
    t.check('closing the last Codex session removes the bar', !!gone, js(await accounts()))
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.stack) || error))
  } finally {
    if (app) app.kill()
    server.close()
    await sleep(800)
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* a shell may still hold the folder */ }
  }
  process.exit(t.summary() ? 1 : 0)
}

main()
