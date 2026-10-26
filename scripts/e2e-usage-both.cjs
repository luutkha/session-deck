// E2E: quota bars for BOTH providers (Claude + OpenCode Go). Fake statusLine bodies are posted to the real hook
// server, exactly like Claude Code and like the OpenCode plugin report them (scripts/e2e-autopilot.cjs pattern).
// 1) Claude 5h/Week -> Claude bars only (no provider label while it is alone).
// 2) + Go 5h/Week/Month -> a labeled Go group next to Claude's, Claude's numbers unchanged, no alert.
// 3) Settings > Quota "Show OpenCode Go usage" off -> Go disappears, Claude stays; on again -> no Go without data.
// 4) A Go payload with no usable window adds nothing and never crashes.
// Step 5 of the plan (real Go endpoint) is skipped: this machine has no OpenCode Go login (verified), so there is
// nothing real to fetch; the plugin path is unit-tested with fake credentials/responses.
// Takes ~40 s. Run: node scripts/e2e-usage-both.cjs   (E2E_SHOT_DIR=<dir> saves screenshots)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { ROOT, sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

async function main() {
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-usage-both-'))
  const endpointFile = path.join(root, 'endpoint.json')
  process.env.SESSIONDECK_E2E_ENDPOINT_FILE = endpointFile
  try {
    const proj = path.join(root, 'proj')
    fs.mkdirSync(proj)
    app = await launchApp({ port: 9412 })
    await sleep(1200)
    const js = (value) => JSON.stringify(value)
    const session = await app.evaluate(
      `window.api.createSession({ cwd: ${js(proj)}, name: 'usage-both', agent: 'opencode' })`
    )
    const endpoint = JSON.parse(fs.readFileSync(endpointFile, 'utf8'))
    const post = async (url, body) => (await fetch(`http://127.0.0.1:${endpoint.port}${url}`, {
      method: 'POST',
      headers: { 'x-token': endpoint.token, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })).status
    const statusLine = (body) => post(`/statusline/${encodeURIComponent(session.id)}`, body)
    const usage = () => app.evaluate('window.api.getUsage()')
    const groupText = (provider) =>
      app.evaluate(`document.querySelector('[data-account="${provider}"]')?.innerText ?? null`)
    const providers = () =>
      app.evaluate(`[...document.querySelectorAll('[data-account]')].map((n) => n.getAttribute('data-account'))`)
    const shot = async (name) => {
      if (!process.env.E2E_SHOT_DIR) return
      const r = await app.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(process.env.E2E_SHOT_DIR, name + '.png'), Buffer.from(r.result.data, 'base64'))
    }
    const visual = async () => {
      try {
        const r = await app.send('Page.captureScreenshot', { format: 'png' })
        fs.mkdirSync(path.join(ROOT, 'scripts', 'visual'), { recursive: true })
        fs.writeFileSync(
          path.join(ROOT, 'scripts', 'visual', 'usage-both.png'),
          Buffer.from(r.result.data, 'base64')
        )
      } catch {
        // A screenshot must never fail the run.
      }
    }

    // ---------- 1) Claude only
    const claudeReset = Math.floor(Date.now() / 1000) + 3600
    t.check('a Claude statusLine body is accepted', (await statusLine({
      rate_limits: {
        five_hour: { used_percentage: 42, resets_at: claudeReset },
        seven_day: { used_percentage: 31, resets_at: claudeReset + 86400 }
      }
    })) === 204)
    const claude = await waitFor(async () => {
      const u = await usage()
      return u.account && u.account.fiveHour?.usedPercentage === 42 ? u : null
    }, 8000, 200)
    t.check('main keeps the Claude account as before (5h 42, Week 31)', !!claude && claude.account.sevenDay?.usedPercentage === 31, js(claude))
    t.check('the accounts list is Claude first with provider claude', !!claude && claude.accounts?.length === 1 && claude.accounts[0].provider === 'claude', js(claude && claude.accounts))
    const claudeText = await waitFor(async () => {
      const text = await groupText('claude')
      return text && /5h\s*42%/.test(text) && /Week\s*31%/.test(text) ? text : null
    }, 8000, 200)
    t.check('the status bar shows the Claude 5h and Week bars', !!claudeText, String(claudeText))
    t.check('no provider label while Claude is alone', !!claudeText && !claudeText.includes('Claude'), String(claudeText))
    t.check('no Go group yet', (await providers()).length === 1, js(await providers()))
    await shot('usage-claude-only')

    // ---------- 2) + OpenCode Go
    const goReset = Math.floor(Date.now() / 1000) + 7200
    t.check('an OpenCode Go statusLine body is accepted', (await statusLine({
      source: 'opencode-go',
      rate_limits: {
        five_hour: { used_percentage: 7, resets_at: new Date(goReset * 1000).toISOString() },
        seven_day: { used_percentage: 3, resets_at: new Date((goReset + 86400) * 1000).toISOString() },
        monthly: { used_percentage: 1, resets_at: new Date((goReset + 10 * 86400) * 1000).toISOString() }
      }
    })) === 204)
    const both = await waitFor(async () => {
      const u = await usage()
      return u.accounts?.length === 2 ? u : null
    }, 8000, 200)
    t.check('both providers are listed, Claude first', !!both && both.accounts.map((a) => a.provider).join(',') === 'claude,opencode-go', js(both && both.accounts.map((a) => a.provider)))
    t.check('the Go monthly window arrived (ISO reset parsed)', !!both && (both.accounts[1].monthly?.usedPercentage === 1), js(both && both.accounts[1]))
    t.check('the Go payload did not overwrite the Claude numbers', !!both && both.account.fiveHour?.usedPercentage === 42 && both.account.sevenDay?.usedPercentage === 31, js(both && both.account))
    t.check('DOM order is Claude then Go', (await providers()).join(',') === 'claude,opencode-go', js(await providers()))
    const goText = await waitFor(async () => {
      const text = await groupText('opencode-go')
      return text && /5h\s*7%/.test(text) && /Week\s*3%/.test(text) && /Month\s*1%/.test(text) ? text : null
    }, 8000, 200)
    t.check('the Go group shows 5h 7%, Week 3% and Month 1%', !!goText, String(goText))
    const claudeWithLabel = await groupText('claude')
    t.check('both groups are labeled once there are two providers', !!claudeWithLabel && claudeWithLabel.includes('Claude') && String(goText).includes('Go'), `${claudeWithLabel} | ${goText}`)
    t.check('Claude still reads 42% after the Go payload', !!claudeWithLabel && /5h\s*42%/.test(claudeWithLabel), String(claudeWithLabel))
    t.check('no quota alert was raised by the Go payload', !(await app.evaluate('!!document.querySelector("[data-quota-action]")')))
    await shot('usage-both')
    await visual()

    // ---------- 3) the settings toggle
    await app.evaluate(`window.api.updateSettings({ quota: { showOpencodeGo: false } })`)
    const goGone = await waitFor(async () => !(await app.evaluate('!!document.querySelector("[data-account=opencode-go]")')), 6000, 200)
    t.check('turning the setting off hides the Go bars at once', !!goGone)
    const afterOff = await usage()
    t.check('main drops the Go entry when the setting is off', !afterOff.accounts?.some((a) => a.provider === 'opencode-go'), js(afterOff.accounts))
    const stillClaude = await waitFor(async () => {
      const text = await groupText('claude')
      return text && /5h\s*42%/.test(text) ? text : null
    }, 4000, 200)
    t.check('the Claude bars stay when Go is off', !!stillClaude, String(stillClaude))

    await app.evaluate(`window.api.updateSettings({ quota: { showOpencodeGo: true } })`)
    await sleep(700)
    t.check('turning it back on shows no Go bars without fresh data', (await providers()).join(',') === 'claude', js(await providers()))

    // ---------- 4) an unusable Go payload
    t.check('a Go payload without a usable window is still accepted (no crash)', (await statusLine({
      source: 'opencode-go',
      rate_limits: { five_hour: { used_percentage: 'x' }, monthly: { status: 'error' } }
    })) === 204)
    await sleep(700)
    t.check('it adds no Go bars', (await providers()).join(',') === 'claude', js(await providers()))
    const clean = await usage()
    t.check('the Claude numbers are untouched by the bad payload', clean.account?.fiveHour?.usedPercentage === 42, js(clean.account))
    t.check('the app is still responsive', typeof session.id === 'string' && !!(await providers()).length)
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.message) || error))
  } finally {
    t.summary()
    if (app) app.kill()
  }
}
main()
