// E2E: the manual usage reload button: first-use consent (Cancel = nothing happens), then a REAL request to Anthropic's
// usage endpoint with the local Claude login (one request). Run: node scripts/e2e-usage-refresh.cjs
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const centerOf = (app, pick) =>
  app.evaluate(`(() => { const el = (${pick}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
async function click(app, pick, label) {
  const c = await waitFor(() => centerOf(app, pick), 8000)
  if (!c) throw new Error(`target not found: ${label}`)
  await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none' })
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 })
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 })
  await sleep(400)
}
const byLabel = (l) => `document.querySelector('[aria-label="${l}"]')`
const byText = (sel, text) => `[...document.querySelectorAll('${sel}')].find((n) => n.innerText.trim().startsWith(${JSON.stringify(text)}))`
const bodyText = (app) => app.evaluate('document.body.innerText')
const consentKey = 'sessiondeck.usage.consent.v1'

async function main() {
  const t = makeChecker()
  let app
  try {
    app = await launchApp({ port: 9372 })
    await sleep(1500)

    const waiting = await waitFor(async () => /waiting for a Claude turn/i.test(await bodyText(app)), 8000)
    t.check('with no data the status bar says it is waiting for a Claude turn', !!waiting)
    const hasButton = await app.evaluate(`!!${byLabel('Refresh usage')}`)
    t.check('the reload button is there even before any usage data exists', hasButton)

    // ---------- consent: Cancel does nothing
    await click(app, byLabel('Refresh usage'), 'reload button')
    const dialog = await waitFor(() => app.evaluate('(document.querySelector("[role=dialog]")?.innerText || "")'), 5000)
    t.check('first click opens the consent dialog explaining the token use', !!dialog && /Claude account/.test(dialog) && /credentials/.test(dialog) && /api\.anthropic\.com/.test(dialog), String(dialog).replace(/\n/g, ' ').slice(0, 90))
    { const r = await app.send('Page.captureScreenshot', { format: 'png' }); const fsx = require('node:fs'); const px = require('node:path'); fsx.mkdirSync(px.join(__dirname, 'visual'), { recursive: true }); fsx.writeFileSync(px.join(__dirname, 'visual', 'usage-consent.png'), Buffer.from(r.result.data, 'base64')) }
    await click(app, byText('[role=dialog] button', 'Cancel'), 'Cancel')
    await sleep(2500)
    const afterCancel = await app.evaluate('window.api.getUsage()')
    const consentAfterCancel = await app.evaluate(`localStorage.getItem(${JSON.stringify(consentKey)})`)
    t.check('Cancel closes the dialog, stores no consent and makes no request', (await app.evaluate('document.querySelector("[role=dialog]") === null')) && consentAfterCancel === null && afterCancel.account === null)

    // ---------- Allow: one REAL request
    await click(app, byLabel('Refresh usage'), 'reload button (2)')
    await waitFor(() => app.evaluate('document.querySelector("[role=dialog]") !== null'), 5000)
    await click(app, byText('[role=dialog] button', 'Allow'), 'Allow and refresh')
    const usage = await waitFor(async () => { const u = await app.evaluate('window.api.getUsage()'); return u.account && u.account.fiveHour ? u : null }, 25000, 1000)
    const text = await bodyText(app)
    const err = (text.match(/(No Claude login[^\n]*|Your Claude login expired[^\n]*|rate limited[^\n]*|Could not reach[^\n]*|returned no usage[^\n]*|had a problem[^\n]*)/) || [])[0]
    t.check('Allow performs the real request and main now has plan usage', !!usage, usage ? `5h=${usage.account.fiveHour.usedPercentage}% week=${usage.account.sevenDay?.usedPercentage}%` : `no usage; UI says: ${err || '(nothing)'}`)
    const consentAfterAllow = await app.evaluate(`localStorage.getItem(${JSON.stringify(consentKey)})`)
    t.check('consent is remembered after Allow', consentAfterAllow !== null)
    await sleep(600)
    { const r = await app.send('Page.captureScreenshot', { format: 'png' }); const fsx = require('node:fs'); const px = require('node:path'); fsx.mkdirSync(px.join(__dirname, 'visual'), { recursive: true }); fsx.writeFileSync(px.join(__dirname, 'visual', 'usage-refreshed.png'), Buffer.from(r.result.data, 'base64')) }
    const shown = await waitFor(async () => { const b = await bodyText(app); return /5h\s*\d+%/.test(b) && /Week\s*\d+%/.test(b) }, 10000)
    t.check('the status bar shows the 5h and Week bars from the fresh numbers', !!shown)
    const stale = /stale/i.test(await bodyText(app))
    t.check('fresh numbers are not marked stale', !stale)

    // ---------- second click: no consent dialog this time, and the 5 s floor keeps it from spamming the endpoint
    await click(app, byLabel('Refresh usage'), 'reload button (3)')
    await sleep(800)
    t.check('later clicks go straight through (no consent dialog again)', await app.evaluate('document.querySelector("[role=dialog]") === null'))
    const after = await app.evaluate('window.api.getUsage()')
    t.check('a quick second click does not break anything (still has usage)', !!after.account && !!after.account.fiveHour)
  } catch (e) {
    t.check('run completed without exception', false, String(e.message || e))
  } finally {
    if (app) app.kill()
    process.exit(t.summary() ? 1 : 0)
  }
}
main()
