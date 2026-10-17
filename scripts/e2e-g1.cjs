// E2E for the automation batch: auto status from REAL Claude hooks, split panes, new Settings sections,
// settings validation, close-to-tray. Sends ONE tiny prompt to claude. Run: node scripts/e2e-g1.cjs
const { ROOT, sleep, strip, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const centerOf = (app, pick) =>
  app.evaluate(`(() => { const el = (${pick}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
async function click(app, pick, label) {
  const c = await waitFor(() => centerOf(app, pick), 8000)
  if (!c) throw new Error(`target not found: ${label}`)
  await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none' })
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 })
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 })
  await sleep(350)
}
const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((n) => n.innerText.trim().startsWith(${JSON.stringify(text)}))`
const store = (app) => app.evaluate('window.api.getStore()')
const statusOf = async (app, id) => (await store(app)).data.sessions.find((x) => x.id === id)?.statusId
const visibleWidths = (app) =>
  app.evaluate(`[...document.querySelectorAll('.xterm')].filter((e) => e.offsetParent !== null).map((e) => Math.round(e.getBoundingClientRect().width))`)
const shot = async (app, name) => {
  const r = await app.send('Page.captureScreenshot', { format: 'png' })
  const fs = require('node:fs')
  const path = require('node:path')
  fs.mkdirSync(path.join(ROOT, 'scripts', 'visual'), { recursive: true })
  fs.writeFileSync(path.join(ROOT, 'scripts', 'visual', name), Buffer.from(r.result.data, 'base64'))
}
const escape = async (app) => {
  await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
  await sleep(400)
}

async function main() {
  const t = makeChecker()
  let app
  try {
    app = await launchApp({ port: 9381 })
    await sleep(1500)
    const a = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'auto probe' })`)
    await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'second pane' })`)
    const sid = JSON.stringify(a.id)
    await sleep(1500)

    // ---------- Settings: new sections
    await click(app, `document.querySelector('[aria-label="Settings"]')`, 'Settings gear')
    const general = await waitFor(() => app.evaluate('(document.querySelector("[role=dialog]")?.innerText || "").includes("tray")'), 6000)
    t.check('Settings opens on General (tray / notifications)', !!general)
    for (const [nav, needle] of [['Automation', 'Automatic status'], ['Quota', 'Warn at'], ['Sound', 'Quota warning']]) {
      await click(app, byText('[role=dialog] button', nav), `${nav} nav`)
      const ok = await waitFor(() => app.evaluate(`(document.querySelector("[role=dialog]")?.innerText || "").includes(${JSON.stringify(needle)})`), 5000)
      t.check(`Settings > ${nav} shows "${needle}"`, !!ok)
    }
    await shot(app, 'settings-sound-quota.png')
    const patched = await app.evaluate(`window.api.updateSettings({ quota: { warnAtPercent: 70, criticalAtPercent: 90 } })`)
    t.check('updateSettings persists thresholds', patched.quota.warnAtPercent === 70 && patched.quota.criticalAtPercent === 90)
    const bad = await app.evaluate(`window.api.updateSettings({ quota: { warnAtPercent: 95, criticalAtPercent: 90 } }).then(() => 'accepted', () => 'rejected')`)
    t.check('invalid thresholds (warn >= critical) are rejected', bad === 'rejected')
    await escape(app)

    // ---------- Auto status from REAL hooks
    await click(app, byText('[role="treeitem"]', 'auto probe'), 'session card')
    await waitFor(async () => /[A-Za-z]{6,}/.test(strip((await app.evaluate(`window.api.ptyReplay(${sid})`)).data)), 45000, 1000)
    for (let i = 0; i < 3; i += 1) { await app.evaluate(`window.api.ptyWrite(${sid}, '\\r')`); await sleep(2500) }
    await app.evaluate(`window.api.ptyWrite(${sid}, 'Count from 1 to 60 separated by commas, nothing else')`)
    await sleep(500)
    await app.evaluate(`window.api.ptyWrite(${sid}, '\\r')`)
    const working = await waitFor(async () => (await statusOf(app, a.id)) === 'working', 30000, 400)
    t.check('prompt submitted -> status moves to "working" (UserPromptSubmit hook)', !!working)
    await shot(app, 'working-activity.png')
    const review = await waitFor(async () => (await statusOf(app, a.id)) === 'review', 90000, 1000)
    t.check('Claude finished -> status moves to "review" (Stop hook)', !!review)

    // ---------- Split panes (needs a second open tab)
    await click(app, byText('[role="treeitem"]', 'second pane'), 'second card')
    await sleep(1500)
    await click(app, byText('[role="treeitem"]', 'auto probe'), 'auto card')
    await shot(app, 'before-split.png')
    await click(app, `document.querySelector('[aria-label="Split view"]')`, 'Split view button')
    await click(app, byText('[role="menuitem"]', 'Split right'), 'Split right')
    const two = await waitFor(() => app.evaluate(`document.querySelectorAll('main [role=separator][tabindex="0"]').length === 1`), 6000)
    t.check('Split right shows two panes with one divider', !!two)
    await sleep(600)
    const widths = await visibleWidths(app)
    t.check('both visible terminals have real width', widths.length === 2 && widths.every((w) => w > 200), JSON.stringify(widths))
    await shot(app, 'split-two.png')
    const sep = await centerOf(app, `document.querySelector('main [role=separator][tabindex="0"]')`)
    await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sep.x, y: sep.y, button: 'none' })
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sep.x, y: sep.y, button: 'left', buttons: 1, clickCount: 1 })
    await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sep.x + 120, y: sep.y, button: 'left', buttons: 1 })
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sep.x + 120, y: sep.y, button: 'left', buttons: 0, clickCount: 1 })
    await sleep(600)
    const after = await visibleWidths(app)
    t.check('dragging the divider resizes the panes', after.length === 2 && after[0] > widths[0] + 60, `${widths[0]} -> ${after[0]}`)
    await click(app, `document.querySelector('[aria-label="Split view"]')`, 'Split view button 2')
    await click(app, byText('[role="menuitem"]', 'Unsplit'), 'Unsplit')
    const one = await waitFor(() => app.evaluate(`document.querySelectorAll('main [role=separator][tabindex="0"]').length === 0`), 6000)
    t.check('Unsplit returns to a single pane', !!one)

    // ---------- Close-to-tray: closing the window must NOT quit the app
    await app.evaluate('window.close()').catch(() => undefined)
    await sleep(1500)
    const alive = await app.evaluate('1 + 1').catch(() => null)
    t.check('closing the window hides to tray; the app keeps running', alive === 2)
    const replay = await app.evaluate(`window.api.ptyReplay(${sid}).then((r) => !!r)`).catch(() => false)
    t.check('sessions keep running while hidden', replay === true)
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.message) || error))
  } finally {
    t.summary()
    if (app) app.kill()
  }
}
main()
