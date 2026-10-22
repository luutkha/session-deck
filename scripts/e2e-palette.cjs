// E2E (D28): command palette. Real key presses open it (Ctrl+K outside the terminal, Ctrl+Shift+K inside it, not
// Ctrl+K inside it), typing filters, Enter jumps to a session, and "This session" actions really change state.
// Run: node scripts/e2e-palette.cjs   (E2E_SHOT_DIR=<dir> saves screenshots)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const CTRL = 2
const SHIFT = 8

async function main() {
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-palette-'))
  try {
    const proj = path.join(root, 'proj')
    fs.mkdirSync(proj)
    app = await launchApp({ port: 9399 })
    await sleep(1200)
    const js = (value) => JSON.stringify(value)
    const mk = (name) => app.evaluate(`window.api.createSession({ cwd: ${js(proj)}, name: ${js(name)} })`)
    const alpha = await mk('alpha one')
    const beta = await mk('beta two')
    await mk('gamma three')
    await sleep(1500)

    const store = () => app.evaluate('window.api.getStore()')
    const isOpen = () => app.evaluate('!!document.querySelector("[cmdk-input]")')
    const items = () => app.evaluate('[...document.querySelectorAll("[cmdk-item]")].map((n) => n.innerText.replace(/\\s+/g, " ").trim())')
    const activeTab = () => app.evaluate(`document.querySelector('[role=tab][aria-selected=true]')?.getAttribute('data-tab-id') ?? null`)
    const clickCard = (name) => app.evaluate(`[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes(${js(name)}))?.click()`)
    const key = async (k, code, vk, modifiers = 0) => {
      await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers })
      await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers })
    }
    const ctrlK = (shift) => key(shift ? 'K' : 'k', 'KeyK', 75, CTRL | (shift ? SHIFT : 0))
    const typeText = (text) => app.send('Input.insertText', { text })
    const enter = () => key('Enter', 'Enter', 13)
    const escape = () => key('Escape', 'Escape', 27)
    const shot = async (name) => {
      if (!process.env.E2E_SHOT_DIR) return
      const r = await app.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(process.env.E2E_SHOT_DIR, name + '.png'), Buffer.from(r.result.data, 'base64'))
    }

    // Outside the terminal: put focus on the document body.
    await app.evaluate('document.activeElement && document.activeElement.blur(); true')
    await ctrlK(false)
    t.check('Ctrl+K outside the terminal opens the palette', !!(await waitFor(isOpen, 3000, 100)))
    const all = await items()
    t.check('it lists every session', ['alpha one', 'beta two', 'gamma three'].every((n) => all.some((i) => i.includes(n))), all.join(' | '))
    t.check('it lists New session, Open Hub, Open Settings', ['New session', 'Open Hub', 'Open Settings'].every((n) => all.some((i) => i.includes(n))))
    await typeText('beta')
    await sleep(300)
    const filtered = await items()
    t.check('typing filters the list', filtered.length >= 1 && filtered[0].includes('beta two') && !filtered.some((i) => i.includes('gamma three')), filtered.join(' | '))
    await shot('palette-filtered')
    await enter()
    const jumped = await waitFor(async () => (await activeTab()) === beta.id && !(await isOpen()), 5000, 200)
    t.check('Enter opens the chosen session and closes the palette', !!jumped, `tab=${await activeTab()} open=${await isOpen()}`)

    // Inside the terminal.
    await waitFor(() => app.evaluate('!!document.querySelector(".xterm textarea")'), 15000, 300)
    await app.evaluate('document.querySelector(".xterm textarea").focus(); true')
    await sleep(300)
    await ctrlK(false)
    await sleep(500)
    t.check('Ctrl+K inside the terminal does NOT open it (Claude keeps it)', !(await isOpen()))
    await ctrlK(true)
    t.check('Ctrl+Shift+K inside the terminal opens it', !!(await waitFor(isOpen, 3000, 100)))
    const query = await app.evaluate('document.querySelector("[cmdk-input]").value')
    t.check('the query starts empty each time', query === '', js(query))

    // A "This session" action really changes state: keep awake.
    await typeText('awake')
    await sleep(300)
    const awakeItems = await items()
    t.check('"Keep beta two awake" is offered for the session on screen', awakeItems.some((i) => i.includes('Keep beta two awake')), awakeItems.join(' | '))
    await enter()
    const kept = await waitFor(async () => (await store()).data.sessions.find((s) => s.id === beta.id)?.keepAwake === true, 5000, 200)
    t.check('running it sets Keep awake on that session', !!kept)

    // Set status through the palette. Closing returns focus to the terminal, so use the anywhere shortcut.
    await waitFor(async () => !(await isOpen()), 3000, 100)
    await ctrlK(true)
    await waitFor(isOpen, 3000, 100)
    await typeText('status done')
    await sleep(300)
    const statusItems = await items()
    t.check('"Set status: Done" is offered', statusItems[0]?.includes('Set status: Done'), statusItems.join(' | '))
    await enter()
    const statused = await waitFor(async () => (await store()).data.sessions.find((s) => s.id === beta.id)?.statusId === 'done', 5000, 200)
    t.check('"Set status: Done" sets the status', !!statused)

    // Escape closes; Ctrl+K does nothing while Settings is open.
    await waitFor(async () => !(await isOpen()), 3000, 100)
    await ctrlK(true)
    await waitFor(isOpen, 3000, 100)
    await escape()
    t.check('Escape closes the palette', !!(await waitFor(async () => !(await isOpen()), 3000, 100)))
    await app.evaluate(`document.querySelector('[aria-label="Settings"]').click()`)
    await waitFor(() => app.evaluate('!!document.querySelector("[role=dialog]")'), 5000, 100)
    await ctrlK(true)
    await sleep(500)
    t.check('the palette does not open over another dialog', !(await isOpen()))
    await escape()
    await sleep(400)

    // Reopen a closed session from the palette.
    await app.evaluate(`window.api.closeSession(${js(alpha.id)})`)
    await sleep(1000)
    await clickCard('gamma three')
    await sleep(500)
    await ctrlK(true)
    await waitFor(isOpen, 3000, 100)
    await typeText('alpha')
    await sleep(300)
    const closedItem = (await items())[0] ?? ''
    t.check('a closed session is listed as Closed', closedItem.includes('alpha one') && closedItem.includes('Closed'), closedItem)
    await enter()
    const reopened = await waitFor(async () => (await store()).data.sessions.find((s) => s.id === alpha.id)?.closedAt === undefined, 8000, 300)
    t.check('choosing it reopens the closed session', !!reopened)
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.message) || error))
  } finally {
    t.summary()
    if (app) app.kill()
  }
}
main()
