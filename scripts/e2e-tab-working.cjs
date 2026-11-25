// E2E (tab working indicator): a busy session's TAB shows the spinner (aria-label "Working"), the bell
// still wins when the session needs you, and the plain status dot returns afterwards. Activity is driven
// through the real hook server (UserPromptSubmit/Stop), no model turn needed.
// Run: node scripts/e2e-tab-working.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9455

async function main() {
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-tabworking-'))
  const endpointFile = path.join(root, 'endpoint.json')
  process.env.SESSIONDECK_E2E_ENDPOINT_FILE = endpointFile
  try {
    const proj = path.join(root, 'proj')
    fs.mkdirSync(proj)
    app = await launchApp({ port: PORT })
    await sleep(1200)
    const js = (value) => JSON.stringify(value)
    const a = await app.evaluate(`window.api.createSession({ cwd: ${js(proj)}, name: 'busy-one' })`)
    await app.evaluate(`window.api.createSession({ cwd: ${js(proj)}, name: 'busy-two' })`)
    await sleep(1800)
    const endpoint = JSON.parse(fs.readFileSync(endpointFile, 'utf8'))
    const postHook = async (id, event, body = {}) => {
      const res = await fetch(`http://127.0.0.1:${endpoint.port}/hook/${encodeURIComponent(id)}/${event}`, {
        method: 'POST', headers: { 'x-token': endpoint.token, 'content-type': 'application/json' }, body: JSON.stringify(body)
      })
      return res.status
    }
    const tab = (name) => `[...document.querySelectorAll('[role=tab]')].find((n) => n.innerText.includes(${js(name)}))`
    const workingIcon = async (name) => app.evaluate(`${tab(name)}?.querySelector('[data-tab-working]')?.getAttribute('aria-label') ?? null`)
    const bell = async (name) => app.evaluate(`${tab(name)}?.querySelector('[data-attention-bell]')?.getAttribute('data-attention-bell') ?? null`)
    const dotColor = (name) => app.evaluate(`(() => { const t = ${tab(name)}; if (!t) return null; const d = t.querySelector('span[aria-hidden="true"].rounded-full'); return d === null ? null : getComputedStyle(d).backgroundColor })()`)
    const dotExists = (name) => app.evaluate(`(() => { const t = ${tab(name)}; if (!t) return false; return t.querySelector('span[aria-hidden="true"].rounded-full') !== null })()`)

    // Open both tabs through the sidebar (a created session only gets a tab when it is opened).
    for (const name of ['busy-two', 'busy-one']) {
      await app.evaluate(`[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes(${js(name)}))?.click()`)
      await sleep(1400)
    }
    t.check('both session tabs are open', (await app.evaluate('document.querySelectorAll(\'[role=tab][data-tab-id]\').length')) >= 2)

    // ---- a busy session shows the spinner instead of the dot
    await postHook(a.id, 'UserPromptSubmit', { prompt: 'test' })
    const spinning = await waitFor(async () => ((await workingIcon('busy-one')) === 'Working' ? true : null), 5000, 200)
    t.check('a working session shows the spinner on its tab', !!spinning)
    t.check('the spinner tab has no green dot', (await dotExists('busy-one')) === false)
    t.check('the other session keeps its normal dot', (await dotExists('busy-two')) === true)

    // ---- Stop settles the turn: the bell (Finished, D22) wins over any working state
    await postHook(a.id, 'Stop')
    const bellShown = await waitFor(async () => ((await bell('busy-one')) !== null ? true : null), 5000, 200)
    t.check('after Stop the tab shows the bell (attention wins)', !!bellShown)
    t.check('the spinner is gone once the turn ended', (await workingIcon('busy-one')) === null)

    // ---- clearing the bell brings the dot back
    await app.evaluate(`window.api.clearAttention(${js(a.id)})`)
    const cleared = await waitFor(async () => ((await bell('busy-one')) === null && (await dotExists('busy-one')) === true ? true : null), 5000, 200)
    t.check('clearing the bell restores the plain dot', !!cleared)

    // ---- attention regression: a Notification bell beats a dot
    await postHook(a.id, 'Notification', { message: 'permission please' })
    const permission = await waitFor(async () => ((await bell('busy-one')) !== null ? true : null), 5000, 200)
    t.check('a permission bell still wins over the dot', !!permission)

    // ---- working + unread: the unread bell wins (attention priority unchanged; markUnread does not end the turn)
    await app.evaluate(`window.api.clearAttention(${js(a.id)})`)
    await postHook(a.id, 'UserPromptSubmit', { prompt: 'again' })
    await sleep(500)
    await app.evaluate(`window.api.markUnread(${js(a.id)})`)
    await sleep(500)
    t.check('an unread bell wins over a working tab', (await bell('busy-one')) !== null && (await workingIcon('busy-one')) === null)
  } catch (error) {
    t.check('run completed without exception', false, String(error && error.stack || error))
  } finally {
    if (app) app.kill()
    await sleep(500)
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }) } catch { /* a shell or the app may still hold the folder: leave it to the OS temp cleanup */ }
    process.exit(t.summary() ? 1 : 0)
  }
}
main()
