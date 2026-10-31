// E2E for the OpenCode agent: real `opencode` TUI on a FREE model. Checks launch, session-id capture, activity ->
// status (hooks via the injected plugin), sleep + wake with `-s`, and the New Session dialog dropdown.
// Run: node scripts/e2e-opencode.cjs   (one tiny prompt on opencode/deepseek-v4.1-flash-free)
const { ROOT, sleep, strip, waitFor, makeChecker, launchApp, stopOpencodeService } = require('./e2e-lib.cjs')

const MODEL = 'opencode/deepseek-v4.1-flash-free'
const store = (app) => app.evaluate('window.api.getStore()')
const sessionOf = async (app, id) => (await store(app)).data.sessions.find((s) => s.id === id)
const runtimeOf = async (app, id) => (await store(app)).runtime.find((r) => r.sessionId === id)
const replay = async (app, id) => strip((await app.evaluate(`window.api.ptyReplay(${JSON.stringify(id)})`)).data)

async function main() {
  // A stale background service would silently swallow the injected plugin config.
  stopOpencodeService()
  const t = makeChecker()
  let app
  try {
    app = await launchApp({ port: 9398 })
    await sleep(1500)
    const s = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'oc probe', agent: 'opencode', model: ${JSON.stringify(MODEL)} })`)
    const id = JSON.stringify(s.id)
    t.check('createSession accepts agent=opencode', s.agent === 'opencode' && s.model === MODEL)
    await sleep(1500)
    await app.evaluate(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('oc probe')).click()`)

    const up = await waitFor(async () => (await runtimeOf(app, s.id))?.run === 'running' && /opencode|Ask anything|build/i.test(await replay(app, s.id)), 40000, 1000)
    t.check('opencode TUI starts in the pty', !!up)
    const shot = await app.send('Page.captureScreenshot', { format: 'png' })
    require('node:fs').mkdirSync(require('node:path').join(ROOT, 'scripts', 'visual'), { recursive: true })
    require('node:fs').writeFileSync(require('node:path').join(ROOT, 'scripts', 'visual', 'opencode-session.png'), Buffer.from(shot.result.data, 'base64'))

    await sleep(3000)
    await app.evaluate(`window.api.ptyWrite(${id}, 'reply with the single word: pong')`)
    await sleep(500)
    await app.evaluate(`window.api.ptyWrite(${id}, '\\r')`)

    const working = await waitFor(async () => (await runtimeOf(app, s.id))?.activity === 'working', 30000, 300)
    t.check('prompt submitted -> activity "working" (plugin busy event)', !!working)
    const finished = await waitFor(async () => (await runtimeOf(app, s.id))?.activity === 'finished', 90000, 500)
    t.check('turn done -> activity "finished" (plugin idle event)', !!finished)
    const st = await sessionOf(app, s.id)
    t.check('auto status moved the card to Review', st.statusId === 'review', String(st.statusId))
    const gotId = await waitFor(async () => /^ses_/.test((await sessionOf(app, s.id)).opencodeSessionId || ''), 10000, 300)
    t.check('the OpenCode conversation id was captured', !!gotId)
    const ocId = (await sessionOf(app, s.id)).opencodeSessionId
    const usage = await app.evaluate('window.api.getUsage ? window.api.getUsage() : null')
    void usage

    // ---- owner handshake (worker tabs): the parent loaded the worker plugin, but its own reports are dropped
    await sleep(2500) // let hello + beats + the parent's self-report arrive and be filtered
    const mineCount = await app.evaluate(
      `window.api.getWorkers().then((w) => w.filter((x) => x.ownerSessionIds.includes(${JSON.stringify(s.id)})).length, () => -1)`
    )
    t.check('the parent OpenCode session shows no worker tab for itself', mineCount === 0, String(mineCount))

    // ---- sleep + wake resumes the same conversation
    await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'other' })`)
    await sleep(2000)
    await app.evaluate(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('other')).click()`)
    await sleep(800)
    await app.evaluate(`window.api.sleepSession(${id})`)
    const slept = await waitFor(async () => (await runtimeOf(app, s.id))?.sleeping === true, 8000, 300)
    t.check('sleeping an opencode session works', !!slept)
    await sleep(2500)
    await app.evaluate(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('oc probe')).click()`)
    const woke = await waitFor(async () => { const r = await runtimeOf(app, s.id); return r?.run === 'running' && !r.sleeping }, 30000, 500)
    t.check('waking it restarts opencode', !!woke)
    await sleep(8000)
    const after = await sessionOf(app, s.id)
    t.check('same OpenCode conversation id after wake (-s)', after.opencodeSessionId === ocId, `${ocId} vs ${after.opencodeSessionId}`)
    t.check('the earlier turn is visible again after resume', /pong/i.test(await replay(app, s.id)))

    // ---- clipboard image paste (right-click) attaches an image in OpenCode (Ctrl+V under the hood)
    // Needs a working OS clipboard. In some remote/headless Windows sessions write+read stays empty (see
    // docs/LESSONS.md), so report a real SKIP for this probe instead of a red run; the rest of the suite still counts.
    const clipboardWorks = await app.evaluate(`navigator.clipboard.writeText('sessiondeck-clipboard-probe').then(() => navigator.clipboard.readText()).then((text) => text === 'sessiondeck-clipboard-probe', () => false)`)
    if (!clipboardWorks) {
      console.log('SKIP  right-click image paste: the OS clipboard is unavailable in this session (write/read stays empty).')
    } else {
      const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC'
      await app.evaluate(`navigator.clipboard.write([new ClipboardItem({ 'image/png': Promise.resolve(new Blob([Uint8Array.from(atob('${PNG}'), (c) => c.charCodeAt(0))], { type: 'image/png' })) })])`)
      const rect = await app.evaluate(`(() => { const r = document.querySelector('.xterm-screen').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y, button: 'none' })
      await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'right', buttons: 2, clickCount: 1 })
      await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'right', buttons: 0, clickCount: 1 })
      const attached = await waitFor(async () => /\[Image ?1\]/.test(await replay(app, s.id)), 10000, 500)
      t.check('right-click image paste attaches [Image 1] in OpenCode', !!attached)
    }

    // ---- New Session dialog has the Agent dropdown
    await app.evaluate(`document.querySelector('[aria-label="New session"], [aria-label="New Session"]')?.click()`)
    const dlg = await waitFor(() => app.evaluate(`!!document.querySelector('[role=dialog] [aria-label="Agent"]')`), 5000, 300)
    t.check('New Session dialog shows an Agent dropdown', !!dlg)
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.message) || error))
  } finally {
    t.summary()
    if (app) app.kill()
  }
}
main()
