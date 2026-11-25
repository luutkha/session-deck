// E2E (D69): keyboard triage. Ctrl+Shift+Down / Ctrl+Shift+Up show the next / previous session that needs the user (a bell),
// from anywhere including a focused terminal; a viewed session loses its bell, so repeated presses walk the waiting
// sessions and then stop. Bells are raised through the hook server like Claude Code does (Stop on a background session).
// Run: npx electron-vite build && node scripts/e2e-attentionnav.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9501
const js = (value) => JSON.stringify(value)

async function main() {
  const t = makeChecker()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-attnav-'))
  const endpointFile = path.join(root, 'endpoint.json')
  process.env.SESSIONDECK_E2E_ENDPOINT_FILE = endpointFile
  const userData = path.join(root, 'userdata')
  const work = path.join(root, 'work')
  fs.mkdirSync(userData)
  fs.mkdirSync(work)
  let app
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1200)
    const ev = (expr) => app.evaluate(expr)
    const endpoint = JSON.parse(fs.readFileSync(endpointFile, 'utf8'))
    const ids = {}
    for (const name of ['A', 'B', 'C', 'D']) {
      ids[name] = (await ev(`window.api.createSession({ cwd: ${js(work)}, name: ${js('nav-' + name)}, agent: 'shell' })`)).id
    }
    await waitFor(() => ev(`document.querySelectorAll('[data-session-card]').length >= 4 || null`), 10000, 200)
    const select = async (id) => {
      await ev(`document.querySelector('[data-session-card="${id}"]').click()`)
      await sleep(600)
    }
    // Open every session once (tabs), ending on D.
    for (const name of ['A', 'B', 'C', 'D']) await select(ids[name])
    const name = (id) => Object.keys(ids).find((k) => ids[k] === id) ?? null
    const activeTab = async () => name(await ev(`document.querySelector('[role=tab][aria-selected=true]')?.getAttribute('data-tab-id') ?? null`))
    const bellCount = () => ev(`Number(document.querySelector('[data-needs-you-button]')?.getAttribute('data-count') ?? -1)`)
    const postHook = async (id, event) => (await fetch(`http://127.0.0.1:${endpoint.port}/hook/${encodeURIComponent(id)}/${event}`, {
      method: 'POST', headers: { 'x-token': endpoint.token, 'content-type': 'application/json' }, body: '{}'
    })).status
    const chord = async (key, vk) => {
      await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: vk, modifiers: 10 })
      await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: vk, modifiers: 10 })
      await sleep(700)
    }
    const down = () => chord('ArrowDown', 40)
    const up = () => chord('ArrowUp', 38)

    // ---- put the focus in the terminal (the chord must work there)
    const rect = await ev(`(() => { const r = [...document.querySelectorAll('.xterm-screen')].find((e) => e.getBoundingClientRect().width > 0).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', buttons: 1, clickCount: 1 })
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', buttons: 0, clickCount: 1 })
    await sleep(300)
    t.check('D is on screen and nothing waits', (await activeTab()) === 'D' && (await bellCount()) === 0, `${await activeTab()} ${await bellCount()}`)

    // ---- the terminal must never see the chord (xterm would send a modified arrow to the program)
    await ev("window.__kd = 0; for (const el of document.querySelectorAll('.xterm-helper-textarea')) el.addEventListener('keydown', () => { window.__kd += 1 })")

    // ---- nothing waits: the chord does nothing
    await down()
    t.check('with nothing waiting the chord changes nothing', (await activeTab()) === 'D', String(await activeTab()))

    // ---- bells on A, B, C (newest first: C, B, A)
    for (const n of ['A', 'B', 'C']) {
      await postHook(ids[n], 'Stop')
      await sleep(250)
    }
    await waitFor(async () => ((await bellCount()) === 3 ? true : null), 5000, 200)
    t.check('A, B and C have a bell', (await bellCount()) === 3, String(await bellCount()))

    await down()
    t.check('Ctrl+Shift+Down from D (no bell) shows the newest bell, C', (await activeTab()) === 'C', String(await activeTab()))
    t.check('the viewed session loses its bell (2 left)', (await bellCount()) === 2, String(await bellCount()))
    await down()
    t.check('Ctrl+Shift+Down again shows B', (await activeTab()) === 'B', String(await activeTab()))
    await down()
    t.check('and then A', (await activeTab()) === 'A', String(await activeTab()))
    await down()
    t.check('with nobody waiting any more it stays on A', (await activeTab()) === 'A' && (await bellCount()) === 0, `${await activeTab()} ${await bellCount()}`)

    // ---- previous: bells on B and C while A is on screen, Ctrl+Shift+Up shows the oldest (last in the list)
    await postHook(ids.B, 'Stop')
    await sleep(250)
    await postHook(ids.C, 'Stop')
    await waitFor(async () => ((await bellCount()) === 2 ? true : null), 5000, 200)
    await up()
    t.check('Ctrl+Shift+Up from A (no bell) shows the oldest bell, B', (await activeTab()) === 'B', String(await activeTab()))
    await up()
    t.check('Ctrl+Shift+Up again shows C', (await activeTab()) === 'C', String(await activeTab()))

    t.check('no terminal received any of the chords', (await ev('window.__kd')) === 0, String(await ev('window.__kd')))

    // ---- a dialog open: the chord is ignored
    await postHook(ids.A, 'Stop')
    await waitFor(async () => ((await bellCount()) === 1 ? true : null), 5000, 200)
    await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'N', code: 'KeyN', windowsVirtualKeyCode: 78, modifiers: 10 })
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'N', code: 'KeyN', windowsVirtualKeyCode: 78, modifiers: 10 })
    const dialog = await waitFor(() => ev(`!!document.querySelector('[role=dialog]') || null`), 4000, 200)
    if (dialog) {
      await down()
      t.check('with a dialog open the chord does nothing', (await activeTab()) === 'C', String(await activeTab()))
      await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await sleep(500)
    } else {
      t.check('the New Session dialog opened for the dialog check', false)
    }
  } catch (error) {
    t.check('attention-nav e2e ran without an exception', false, String(error))
  } finally {
    if (app) app.kill()
    await sleep(500)
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }) } catch { /* a shell or the app may still hold the folder: leave it to the OS temp cleanup */ }
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
