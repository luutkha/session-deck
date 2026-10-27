// E2E (D44): bell escalation. A background session that stays needs-you and unread gets the alert repeated every
// configured number of minutes (sound + flash + desktop notice), the session on screen never reminds, reading the
// bell stops it, and the Settings > Sound switch turns it off. Uses the real hook server through the e2e endpoint file.
// Run: node scripts/e2e-reminder.cjs  (takes about three minutes: two full 1-minute reminder waits)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9427

async function main() {
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-reminder-'))
  const endpointFile = path.join(root, 'endpoint.json')
  const proj = path.join(root, 'proj')
  fs.mkdirSync(proj)
  process.env.SESSIONDECK_E2E_ENDPOINT_FILE = endpointFile

  try {
    app = await launchApp({ port: PORT })
    await sleep(1200)
    const js = (value) => JSON.stringify(value)
    const ev = (expression) => app.evaluate(expression)
    const store = () => ev('window.api.getStore()')
    const reminderSettings = async () => (await store()).data.settings?.reminder

    const create = (name) =>
      ev(`window.api.createSession({ cwd: ${js(proj)}, name: ${js(name)}, agent: 'shell' })`)
    const hidden = await create('reminder-hidden')
    const shown = await create('reminder-shown')
    await sleep(600)

    // Put one real session on screen: its bell still shows, but it must never remind.
    const card = (name) => `[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes(${js(name)}))`
    await ev(`${card('reminder-shown')}?.click()`)
    const active = await waitFor(
      () => ev(`document.querySelector('[role=tab][aria-selected=true]')?.getAttribute('data-tab-id') ?? null`),
      8000,
      250
    )
    t.check('the shown session is the active tab (it counts as on screen)', active === shown.id, String(active))
    await sleep(1200)

    // Count every sound request main sends (the renderer plays the user's configured sound from these).
    await ev(`window.__sounds = []; window.api.onAttentionSound((id, e) => window.__sounds.push(id + ':' + e)); true`)

    const endpoint = await waitFor(() => {
      if (!fs.existsSync(endpointFile)) return null
      return JSON.parse(fs.readFileSync(endpointFile, 'utf8'))
    }, 10000, 300)
    t.check('the hook server endpoint is available', !!endpoint)
    const postHook = async (id, event) => {
      const res = await fetch(`http://127.0.0.1:${endpoint.port}/hook/${encodeURIComponent(id)}/${event}`, {
        method: 'POST',
        headers: { 'x-token': endpoint.token, 'content-type': 'application/json' },
        body: '{}'
      })
      return res.status
    }

    // ---- Settings > Sound: the reminder block is there and stores the minutes through the store IPC.
    const press = async (selector) => {
      // The Sound page scrolls; a control below the fold has off-screen coordinates, so centre it first.
      const point = await ev(`(() => {
        const n = ${selector}
        if (!n) return null
        n.scrollIntoView({ block: 'center', inline: 'nearest' })
        const r = n.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      })()`)
      if (!point) return false
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0 })
      await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 })
      await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 })
      await sleep(350)
      return true
    }
    const openSoundSettings = async () => {
      await press(`document.querySelector('[aria-label="Settings"]')`)
      await waitFor(() => ev(`!!document.querySelector('[role=dialog]')`), 6000, 200)
      const nav = await waitFor(
        () => ev(`(() => { const n = [...document.querySelectorAll('[role=dialog] button')].find((b) => b.innerText.trim().startsWith('Sound')); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`),
        5000,
        200
      )
      if (nav) {
        await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: nav.x, y: nav.y, button: 'none', buttons: 0 })
        await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: nav.x, y: nav.y, button: 'left', buttons: 1, clickCount: 1 })
        await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: nav.x, y: nav.y, button: 'left', buttons: 1, clickCount: 1 })
        await sleep(350)
      }
      return waitFor(() => ev(`(document.querySelector('[role=dialog]')?.innerText || '').includes('Remind again after')`), 5000, 200)
    }

    const soundPage = await openSoundSettings()
    t.check('Settings > Sound shows the reminder block', !!soundPage)
    // `getStore().data.settings` stays absent until something is written; settings:update returns the resolved object.
    const defaults = (await ev('window.api.updateSettings({})')).reminder
    t.check('reminders are ON after 10 minutes by default', defaults?.enabled === true && defaults?.afterMinutes === 10, js(defaults))
    t.check(
      'the reminder switch and minute input show the stored values',
      (await ev(`document.querySelector('#reminder-enabled')?.getAttribute('aria-checked')`)) === 'true' &&
        (await ev(`document.querySelector('#reminder-after')?.value`)) === '10'
    )

    const typed = await ev(`(() => {
      const input = document.querySelector('#reminder-after')
      if (!input) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, '1')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    const oneMinute = await waitFor(async () => (await reminderSettings())?.afterMinutes === 1, 6000, 250)
    t.check('typing 1 minute saves reminder.afterMinutes = 1 through the store', typed && !!oneMinute, js(await reminderSettings()))
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
    await sleep(400)

    // ---- A background raise pings at once; a raise on the visible session stays silent.
    const hiddenSounds = async () => (await ev('window.__sounds')).filter((entry) => entry.startsWith(hidden.id + ':'))
    const shownSounds = async () => (await ev('window.__sounds')).filter((entry) => entry.startsWith(shown.id + ':'))
    t.check('the background session is not on screen', (await hiddenSounds()).length === 0)

    const firstHook = await postHook(hidden.id, 'Stop')
    const firstSound = await waitFor(async () => ((await hiddenSounds()).length >= 1 ? await hiddenSounds() : null), 6000, 250)
    t.check('a background "finished" pings immediately', firstHook === 204 && !!firstSound, JSON.stringify(firstSound))

    const shownHook = await postHook(shown.id, 'Stop')
    await sleep(800)
    t.check('the session on screen raises its bell without a sound', shownHook === 204 && (await shownSounds()).length === 0, JSON.stringify(await shownSounds()))

    // ---- The first reminder: about a minute later, the same sound event arrives for the background session only.
    const reminded = await waitFor(async () => {
      const sounds = await hiddenSounds()
      return sounds.length >= 2 ? sounds : null
    }, 90000, 1000)
    t.check('the alert repeats after the configured minute', !!reminded, JSON.stringify(reminded))
    t.check('the reminder keeps the same reason (done)', reminded ? reminded.filter((entry) => entry === hidden.id + ':done').length >= 2 : false, JSON.stringify(reminded))
    t.check('the on-screen session still got no reminder', (await shownSounds()).length === 0, JSON.stringify(await shownSounds()))

    // ---- Reading the bell stops the repeats (the next 30 s tick has nothing due).
    await ev(`window.api.clearAttention(${js(hidden.id)})`)
    await sleep(500)
    const beforeRead = (await hiddenSounds()).length
    await sleep(35_000)
    t.check('reading the bell stops further reminders', (await hiddenSounds()).length === beforeRead, `${beforeRead} -> ${(await hiddenSounds()).length}`)

    // ---- Turning the setting off stops the repeats for a new bell.
    const offPage = await openSoundSettings()
    t.check('the Sound page opens again', !!offPage)
    await press(`document.querySelector('#reminder-enabled')`)
    const off = await waitFor(async () => (await reminderSettings())?.enabled === false, 6000, 250)
    t.check('the reminder switch stores enabled = false', !!off, js(await reminderSettings()))
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
    await sleep(400)

    await postHook(hidden.id, 'Stop')
    const offFirst = await waitFor(async () => ((await hiddenSounds()).length > beforeRead ? (await hiddenSounds()).length : null), 6000, 250)
    t.check('a new background raise still pings once with reminders off', !!offFirst, String(offFirst))
    const offCount = await hiddenSounds()
    await sleep(65_000)
    t.check('with reminders off there is no second ping', (await hiddenSounds()).length === offCount.length, `${offCount.length} -> ${(await hiddenSounds()).length}`)

    await ev(`window.api.quitApp()`).catch(() => undefined)
  } catch (error) {
    t.check('no unexpected error', false, error && error.stack ? error.stack : String(error))
  } finally {
    if (app) app.kill()
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
