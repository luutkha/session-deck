// E2E (performance step 5): the number of live terminals is capped (MAX_LIVE_PANES = 12). With more sessions than that, the
// least recently shown hidden panes are disposed; showing an evicted session rebuilds its terminal from main's replay, so
// its text is still there and it still takes live output.
// Run: npx electron-vite build && node scripts/e2e-livepanes.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9497
const SESSIONS = 16
const CAP = 12
const js = (value) => JSON.stringify(value)

async function main() {
  const t = makeChecker()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-livepanes-'))
  const userData = path.join(root, 'userdata')
  const work = path.join(root, 'work')
  fs.mkdirSync(userData)
  fs.mkdirSync(work)
  let app
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    const ev = (expr) => app.evaluate(expr)
    const ids = []
    for (let i = 0; i < SESSIONS; i += 1) {
      const s = await ev(`window.api.createSession({ cwd: ${js(work)}, name: ${js('live-' + String(i).padStart(2, '0'))}, agent: 'shell' })`)
      ids.push(s.id)
    }
    await waitFor(() => ev(`document.querySelectorAll('[data-session-card]').length >= ${SESSIONS} || null`), 15000, 200)
    const select = async (id) => {
      await ev(`(() => { const n = document.querySelector('[data-session-card="${id}"]'); if (n) n.click(); })()`)
      await sleep(700)
    }
    const replayHas = (id, text) => waitFor(async () => String(await ev(`window.api.ptyReplay(${js(id)}).then((r) => r.data)`)).includes(text), 20000, 250)
    const ctrlKey = async (key, code, vk, modifiers) => {
      await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers })
      await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers })
    }
    const countText = () => ev('document.querySelector("[data-testid=terminal-search-count]")?.textContent ?? null')
    const searchIn = async (query) => {
      await waitFor(() => ev('!!document.querySelector(".xterm-screen")'), 15000, 300)
      const rect = await ev('(() => { const r = [...document.querySelectorAll(".xterm-screen")].find((e) => e.getBoundingClientRect().width > 0).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()')
      await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', buttons: 1, clickCount: 1 })
      await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', buttons: 0, clickCount: 1 })
      await sleep(300)
      await ctrlKey('F', 'KeyF', 70, 10)
      const open = await waitFor(() => ev('!!document.querySelector("[data-testid=terminal-search]")'), 4000, 200)
      if (!open) return 'search did not open'
      await app.send('Input.insertText', { text: query })
      await waitFor(async () => (await countText()) !== null && (await countText()) !== '', 4000, 200)
      await sleep(400)
      const value = await countText()
      await ctrlKey('Escape', 'Escape', 27, 0)
      await sleep(300)
      return value
    }
    const liveTerminals = () => ev('document.querySelectorAll(".xterm").length')

    // ---- open every session once, leaving a marker in each
    for (let i = 0; i < SESSIONS; i += 1) {
      await select(ids[i])
      await ev(`window.api.ptyWrite(${js(ids[i])}, "Write-Host 'LIVE-MARK-${i}'\\r")`)
      await replayHas(ids[i], `LIVE-MARK-${i}`)
    }
    await sleep(1000)
    const live = await liveTerminals()
    t.check(`never more than ${CAP} live terminals after opening ${SESSIONS} sessions`, live <= CAP, String(live))
    t.check('the cap is actually used (not everything disposed)', live >= 2, String(live))

    // ---- the first session was evicted; showing it rebuilds it with its text
    await select(ids[0])
    await sleep(1500)
    const back = await searchIn('LIVE-MARK-0')
    t.check('an evicted session comes back with its text (echo + output = 2)', back === '1/2' || back === '2/2', String(back))
    t.check('still within the cap after bringing it back', (await liveTerminals()) <= CAP, String(await liveTerminals()))

    // ---- and it takes live output afterwards
    await ev(`window.api.ptyWrite(${js(ids[0])}, "Write-Host 'LIVE-AFTER-EVICT'\\r")`)
    await replayHas(ids[0], 'LIVE-AFTER-EVICT')
    await sleep(600)
    const after = await searchIn('LIVE-AFTER-EVICT')
    t.check('live output reaches the rebuilt terminal', after === '1/2' || after === '2/2', String(after))

    // ---- every session still has its text when cycled back (spot check of two evicted ones)
    for (const i of [1, 2]) {
      await select(ids[i])
      await sleep(1200)
      const r = await searchIn(`LIVE-MARK-${i}`)
      t.check(`session ${i} still has its text after eviction`, r === '1/2' || r === '2/2', String(r))
    }
  } catch (error) {
    t.check('live-panes e2e ran without an exception', false, String(error))
  } finally {
    if (app) app.kill()
    await sleep(500)
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }) } catch { /* a shell or the app may still hold the folder: leave it to the OS temp cleanup */ }
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
