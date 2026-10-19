// E2E: the New Session dialog opens with the folder of the most recently created session (empty the very first time),
// through the real dialog UI, and still after an app restart.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9395
const js = (value) => JSON.stringify(value)
const norm = (p) => String(p).toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '')

async function openDialog(app) {
  await app.evaluate(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim().startsWith('New session'))?.click()`)
  return waitFor(() => app.evaluate(`(() => { const i = document.getElementById('new-session-folder'); return i ? { value: i.value } : null })()`), 5000, 200)
}

async function closeDialog(app) {
  await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await waitFor(async () => !(await app.evaluate(`!!document.getElementById('new-session-folder')`)), 3000, 200)
}

async function main() {
  const t = makeChecker()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-lastfolder-'))
  const first = path.join(root, 'first-project')
  const second = path.join(root, 'second-project')
  fs.mkdirSync(first)
  fs.mkdirSync(second)
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sessiondeck-e2e-'))
  let app
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1200)

    const fresh = await openDialog(app)
    t.check('the very first time the folder field is empty', !!fresh && fresh.value === '', JSON.stringify(fresh))

    // Type a folder into the real dialog and create the session with Enter.
    await app.evaluate(`document.getElementById('new-session-folder').focus()`)
    await app.send('Input.insertText', { text: first })
    await sleep(200)
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    const created = await waitFor(async () => (await app.evaluate('window.api.getStore()')).data.sessions.length === 1, 5000, 200)
    t.check('a session is created from the dialog', !!created)
    await waitFor(async () => !(await app.evaluate(`!!document.getElementById('new-session-folder')`)), 3000, 200)

    const again = await openDialog(app)
    t.check('next time the dialog opens with that folder', !!again && norm(again.value) === norm(first), JSON.stringify(again))
    await closeDialog(app)

    await app.evaluate(`window.api.createSession({ cwd: ${js(second)}, name: 'second' })`)
    await sleep(600)
    const newer = await openDialog(app)
    t.check('it follows the most recently created session', !!newer && norm(newer.value) === norm(second), JSON.stringify(newer))
    await closeDialog(app)

    await app.evaluate('window.api.quitApp()').catch(() => undefined)
    await sleep(2000)
    app.kill()
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    const restarted = await openDialog(app)
    t.check('it is still remembered after an app restart', !!restarted && norm(restarted.value) === norm(second), JSON.stringify(restarted))
    await closeDialog(app)

    await app.evaluate('window.api.quitApp()').catch(() => undefined)
    await sleep(1500)
  } catch (error) {
    t.check('no exception', false, error && error.stack ? error.stack : String(error))
  } finally {
    if (app) app.kill()
  }
  process.exit(t.summary())
}

main()
