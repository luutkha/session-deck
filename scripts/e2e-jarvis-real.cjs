// E2E (D53) with a REAL Claude: the user talks to Jarvis in plain words and the app changes.
// Sends TWO short prompts to Jarvis plus ONE scheduled instruction (Sonnet; costs a few cents of the user's plan; ~3 min). Uses a temp profile; the user's
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


    // ---- D54: a schedule really runs: set 2 minutes ahead through the tool server, then Jarvis carries it out
    const cfg = JSON.parse(fs.readFileSync(path.join(app.userData, 'jarvis', 'mcp.json'), 'utf8')).mcpServers.sessiondeck
    const soon = new Date(Date.now() + 2 * 60_000)
    const soonText = `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`
    const added = await fetch(cfg.url, { method: 'POST', headers: { ...cfg.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'schedule_add', arguments: { instruction: `Create a shell session named "scheduled demo" in the folder ${folder}.`, time: soonText, once: true, label: 'e2e' } } }) }).then((r) => r.json())
    t.check('a one-time schedule is set for ' + soonText, /Scheduled/.test(added.result.content[0].text), added.result.content[0].text)
    const ranDemo = await waitFor(async () => (await byName('scheduled demo')) ?? null, 4 * 60_000, 3000)
    t.check('...at that time Jarvis gets the instruction and creates the session', !!ranDemo && ranDemo.cwd === folder, ranDemo ? '' : fs.readFileSync(path.join(app.userData, 'jarvis', 'actions.log'), 'utf8').split('\n').filter((l) => l.includes('schedule')).join(' | ') + ' || SCREEN: ' + strip((await ev('window.api.ptyReplay(' + JSON.stringify(jarvis.id) + ')')).data).slice(-1500))
    const schedLog = fs.readFileSync(path.join(app.userData, 'jarvis', 'actions.log'), 'utf8')
    t.check('...the run is logged and the one-time schedule is done', /schedule_run/.test(schedLog) && JSON.parse(fs.readFileSync(path.join(app.userData, 'jarvis', 'schedules.json'), 'utf8')).schedules[0].enabled === false)
    for (const s of (await store()).data.sessions) await ev(`window.api.removeSession(${js(s.id)})`)
  } catch (error) {
    t.check('no unexpected error', false, String((error && error.stack) || error))
  } finally {
    if (app) app.kill()
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
