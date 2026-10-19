// E2E (D22): the Orca-style attention bell. A session that needs the user shows an amber bell (card, tab, Hub) instead of
// its status dot; the sidebar-header bell counts them and opens a list; Mark as read / unread works and the user's own
// flag is silent. The last check runs a REAL Claude turn in a background session and waits for its bell.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

async function main() {
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-bell-'))
  const endpointFile = path.join(root, 'endpoint.json')
  process.env.SESSIONDECK_E2E_ENDPOINT_FILE = endpointFile
  try {
    const proj = path.join(root, 'proj')
    fs.mkdirSync(proj)
    app = await launchApp({ port: 9393 })
    await sleep(1200)
    const js = (value) => JSON.stringify(value)
    const mk = (name) => app.evaluate(`window.api.createSession({ cwd: ${js(proj)}, name: ${js(name)} })`)
    const a = await mk('bell-a')
    const b = await mk('bell-b')
    await sleep(1500)
    const endpoint = JSON.parse(fs.readFileSync(endpointFile, 'utf8'))

    // Count every sound request main sends, to prove the user's own flag is silent.
    await app.evaluate(`window.__sounds = []; window.api.onAttentionSound((id, ev) => window.__sounds.push(id + ':' + ev)); true`)

    const card = (name) => `[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes(${js(name)}))`
    const clickCard = (name) => app.evaluate(`${card(name)}?.click()`)
    const cardBell = (name) => app.evaluate(`${card(name)}?.querySelector('[data-attention-bell]')?.getAttribute('data-attention-bell') ?? null`)
    const headerCount = () => app.evaluate(`Number(document.querySelector('[data-needs-you-button]')?.getAttribute('data-count') ?? -1)`)
    const activeTab = () => app.evaluate(`document.querySelector('[role=tab][aria-selected=true]')?.getAttribute('data-tab-id') ?? null`)
    const postHook = async (id, event) => {
      const res = await fetch(`http://127.0.0.1:${endpoint.port}/hook/${encodeURIComponent(id)}/${event}`, {
        method: 'POST', headers: { 'x-token': endpoint.token, 'content-type': 'application/json' }, body: '{}'
      })
      return res.status
    }
    const rightClick = async (selectorExpr) => {
      const r = await app.evaluate(`(() => { const e = ${selectorExpr}; if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`)
      if (!r) return false
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await app.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'right', buttons: type === 'mousePressed' ? 2 : 0, clickCount: 1 })
      }
      return true
    }
    const shot = async (name) => {
      if (!process.env.E2E_SHOT_DIR) return
      const r = await app.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(process.env.E2E_SHOT_DIR, name + '.png'), Buffer.from(r.result.data, 'base64'))
    }
    const clickMenuItem = (text) => app.evaluate(`(() => { const i = [...document.querySelectorAll('[role=menuitem]')].find((n) => n.innerText.trim() === ${js(text)}); if (!i) return false; i.click(); return true })()`)

    // Start both sessions (B first, then A stays on screen) and get past Claude's folder-trust prompt.
    for (const s of [b, a]) {
      await clickCard(s.name)
      await waitFor(async () => /[A-Za-z]{6,}/.test((await app.evaluate(`window.api.ptyReplay(${js(s.id)})`)).data.replace(/\x1b\[[0-9;?<>]*[A-Za-z]/g, '')), 40000, 1000)
      await sleep(1500)
      const screen = await app.evaluate(`window.api.ptyReplay(${js(s.id)}).then((r) => r.data.slice(-4000))`)
      if (/Yes, I trust this folder/.test(screen) && /No, exit/.test(screen)) {
        await app.evaluate(`window.api.ptyWrite(${js(s.id)}, '\\x1b[B')`); await sleep(500)
        await app.evaluate(`window.api.ptyWrite(${js(s.id)}, '\\r')`); await sleep(2500)
      }
      await app.evaluate(`window.api.clearAttention(${js(s.id)})`)
    }
    await sleep(800)
    t.check('no bells at the start (count 0)', (await headerCount()) === 0 && (await cardBell('bell-a')) === null && (await cardBell('bell-b')) === null, String(await headerCount()))

    // 1. A background session finishes: amber bell on its card and tab, header count 1, status bar "1 needs you".
    const status = await postHook(b.id, 'Stop')
    const bell = await waitFor(async () => (await cardBell('bell-b')) === 'done', 5000, 200)
    t.check('a finished background session shows the bell on its card (instead of the status dot)', status === 204 && !!bell, `hook=${status} bell=${await cardBell('bell-b')}`)
    t.check('the session on screen gets no bell', (await cardBell('bell-a')) === null)
    t.check('the sidebar-header bell counts it', (await headerCount()) === 1, String(await headerCount()))
    const tabBell = await app.evaluate(`document.querySelector('[role=tab][data-tab-id=${js(b.id)}] [data-attention-bell]') !== null`)
    t.check('its tab shows the bell', tabBell)
    const statusText = await app.evaluate(`document.querySelector('[data-needs-you-status]')?.innerText.trim() ?? null`)
    t.check('the status bar says "1 needs you"', statusText === '1 needs you', String(statusText))

    // 2. The header bell opens the list; clicking the row opens that session and clears its bell.
    await app.evaluate(`document.querySelector('[data-needs-you-button]').click()`)
    const row = await waitFor(() => app.evaluate(`document.querySelector('[data-needs-you-item=${js(b.id)}]')?.innerText ?? null`), 3000, 200)
    await sleep(300)
    await shot('bell-list')
    t.check('the list shows the session with its reason', !!row && row.includes('bell-b') && row.includes('Finished'), String(row))
    await app.evaluate(`document.querySelector('[data-needs-you-item=${js(b.id)}]').click()`)
    const opened = await waitFor(async () => (await activeTab()) === b.id && (await cardBell('bell-b')) === null && (await headerCount()) === 0, 4000, 200)
    t.check('clicking the row opens the session and clears its bell', !!opened, `active=${await activeTab()} count=${await headerCount()}`)

    // 3. Mark as unread from the context menu: silent bell, even with the window focused on another session.
    const soundsBefore = (await app.evaluate('window.__sounds')).length
    await rightClick(card('bell-a'))
    await sleep(400)
    const marked = await clickMenuItem('Mark as unread')
    const unread = await waitFor(async () => (await cardBell('bell-a')) === 'unread', 3000, 200)
    t.check('context menu "Mark as unread" puts a bell on the session', marked && !!unread, `menu=${marked} bell=${await cardBell('bell-a')}`)
    await sleep(600)
    t.check('marking unread plays no sound', (await app.evaluate('window.__sounds')).length === soundsBefore, JSON.stringify(await app.evaluate('window.__sounds')))

    // 4. Clicking the bell on a card marks it read without opening the session.
    await app.evaluate(`${card('bell-a')}.querySelector('[data-attention-bell]').click()`)
    const cleared = await waitFor(async () => (await cardBell('bell-a')) === null, 3000, 200)
    t.check('clicking the card bell marks it read and does not open the session', !!cleared && (await activeTab()) === b.id, `active=${await activeTab()}`)

    // 5. Mark as unread works on the session on screen too, and "Mark as read" in the menu clears it.
    await rightClick(card('bell-b'))
    await sleep(400)
    await clickMenuItem('Mark as unread')
    const selfFlag = await waitFor(async () => (await cardBell('bell-b')) === 'unread', 3000, 200)
    t.check('the session on screen can be flagged unread', !!selfFlag)
    await rightClick(card('bell-b'))
    await sleep(400)
    const readItem = await clickMenuItem('Mark as read')
    const readOk = await waitFor(async () => (await cardBell('bell-b')) === null, 3000, 200)
    t.check('context menu "Mark as read" clears it', readItem && !!readOk)

    // 6. The Hub card shows the bell too.
    await postHook(a.id, 'Notification')
    await waitFor(async () => (await cardBell('bell-a')) === 'permission', 3000, 200)
    await app.evaluate(`[...document.querySelectorAll('button')].find((n) => (n.getAttribute('aria-label') || n.innerText).includes('Hub'))?.click()`)
    const hubBell = await waitFor(() => app.evaluate(`[...document.querySelectorAll('[data-attention-bell=permission]')].length >= 2 ? true : null`), 3000, 200)
    t.check('the Hub card shows the bell for a session that needs permission', !!hubBell)
    await shot('bell-hub')
    await app.evaluate(`window.api.clearAttention(${js(a.id)})`)
    await clickCard('bell-a')
    await sleep(800)

    // 7. REAL Claude: a prompt finishes in background session B while A is on screen -> bell on B.
    await app.evaluate(`window.api.ptyWrite(${js(b.id)}, 'Reply with the single word ok')`)
    await sleep(500)
    await app.evaluate(`window.api.ptyWrite(${js(b.id)}, '\\r')`)
    const real = await waitFor(async () => { const r = await cardBell('bell-b'); return r === 'done' || r === 'permission' ? r : null }, 150000, 1000)
    t.check('REAL: a Claude turn finishing in the background puts the bell on its card', !!real, String(real))
    t.check('REAL: the header count shows it', (await headerCount()) >= 1, String(await headerCount()))

    await app.evaluate(`window.api.quitApp()`).catch(() => undefined)
  } catch (error) {
    t.check('no exception', false, error && error.stack ? error.stack : String(error))
  } finally {
    if (app) app.kill()
  }
  process.exit(t.summary())
}

main()
