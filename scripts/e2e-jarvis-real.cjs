// E2E (D53) with a REAL Claude: the user talks to Jarvis in plain words and the app changes.
// Sends TWO short prompts to Jarvis (Sonnet; costs a few cents of the user's plan). Uses a temp profile; the user's
// ~/.claude is not changed. Run: node scripts/e2e-jarvis-real.cjs   (E2E_SHOT_DIR=<dir> saves screenshots)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, strip, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9463

async function main() {
  const t = makeChecker()
  const js = (value) => JSON.stringify(value)
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-jarvis-real-'))
  let app
  try {
    app = await launchApp({ port: PORT })
    await sleep(1200)
    const ev = (expression) => app.evaluate(expression)
    const store = async () => ev('window.api.getStore()')
    const byName = async (name) => (await store()).data.sessions.find((s) => s.name === name)
    const shot = async (name) => {
      if (!process.env.E2E_SHOT_DIR) return
      const r = await app.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(process.env.E2E_SHOT_DIR, name + '.png'), Buffer.from(r.result.data, 'base64'))
    }
    const click = async (expr, label) => {
      const point = await waitFor(() => ev(`(() => { const n = ${expr}; if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`), 8000, 200)
      if (!point) throw new Error('not found: ' + label)
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await app.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 })
      }
      await sleep(400)
    }

    // ---- open the Jarvis panel from the tab-bar button
    await click(`document.querySelector('[data-jarvis-toggle]')`, 'Jarvis button')
    const jarvis = await waitFor(async () => (await store()).data.sessions.find((s) => s.role === 'jarvis') ?? null, 10000, 300)
    t.check('the Jarvis button opens the panel with Jarvis', !!jarvis && (await ev(`document.querySelector('[data-jarvis-panel]')?.getAttribute('data-jarvis-panel')`)) === 'open')
    const ready = await waitFor(async () => /bypass\s*permissions/i.test(strip((await ev(`window.api.ptyReplay(${js(jarvis.id)})`)).data).slice(-3000)), 90000, 1000)
    t.check('Jarvis\'s Claude is ready (folder trust answered by itself)', !!ready)
    await sleep(2500)

    const ask = async (text, re) => {
      await ev(`window.api.ptyWrite(${js(jarvis.id)}, ${js(text)})`)
      await sleep(600)
      await ev(`window.api.ptyWrite(${js(jarvis.id)}, '\\r')`)
      return waitFor(async () => (await ev(`window.api.getTimeline(${js(jarvis.id)})`)).find((x) => re.test(x.prompt) && x.end === 'finished') ?? null, 240000, 1500)
    }

    // ---- 1: create + sleep in plain words
    const first = await ask(`Create a shell session named "jarvis demo" in the folder ${folder}, then put it to sleep. Reply with one short line.`, /jarvis demo/)
    t.check('Jarvis finished the first request', !!first)
    const demo = await byName('jarvis demo')
    t.check('...the session "jarvis demo" exists, in that folder, as a shell', !!demo && demo.cwd === folder && demo.agent === 'shell', js(demo))
    const demoState = demo ? (await store()).runtime.find((r) => r.sessionId === demo.id) : null
    t.check('...and it is asleep', demoState?.sleeping === true, js(demoState))
    await shot('jarvis-real-1')

    // ---- 2: a destructive request -> the in-app Yes/No
    const pending = ask('Remove the session "jarvis demo". Reply with one short line.', /Remove the session/)
    const dialog = await waitFor(() => ev(`document.querySelector('[role=alertdialog]')?.innerText ?? null`), 180000, 1000)
    t.check('removing asks the user in the app', !!dialog && dialog.includes('jarvis demo'), String(dialog))
    await shot('jarvis-real-confirm')
    await click(`[...document.querySelectorAll('[role=alertdialog] button')].find((b) => b.innerText.trim() === 'Remove')`, 'Remove')
    t.check('Jarvis finished the second request', !!(await pending))
    t.check('...after Yes the session is gone', !(await byName('jarvis demo')))

    const log = fs.readFileSync(path.join(app.userData, 'jarvis', 'actions.log'), 'utf8')
    t.check('the action log has create, sleep and remove', /create_session/.test(log) && /sleep_session/.test(log) && /remove_session/.test(log), log)

    for (const s of (await store()).data.sessions) await ev(`window.api.removeSession(${js(s.id)})`)
  } catch (error) {
    t.check('no unexpected error', false, String((error && error.stack) || error))
  } finally {
    if (app) app.kill()
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
