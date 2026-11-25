// E2E (performance step 2): output a session prints while it is HIDDEN is not lost. Hidden panes queue their output
// and release their WebGL context; when the session is shown again the text is in its terminal (found with the
// terminal search bar), also after a flood larger than the queue limit (that path re-hydrates from main's replay).
// Run: npx electron-vite build && node scripts/e2e-hiddenpane.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9496
const js = (value) => JSON.stringify(value)

async function main() {
  const t = makeChecker()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-hiddenpane-'))
  const userData = path.join(root, 'userdata')
  const work = path.join(root, 'work')
  fs.mkdirSync(userData)
  fs.mkdirSync(work)
  let app
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    const ev = (expr) => app.evaluate(expr)
    const a = await ev(`window.api.createSession({ cwd: ${js(work)}, name: 'hidden-a', agent: 'shell' })`)
    const b = await ev(`window.api.createSession({ cwd: ${js(work)}, name: 'hidden-b', agent: 'shell' })`)
    const select = async (id) => {
      await ev(`(() => { const n = document.querySelector('[data-session-card="${id}"]'); if (n) n.click(); })()`)
      await sleep(900)
    }
    const replayHas = (id, text) => waitFor(async () => String(await ev(`window.api.ptyReplay(${js(id)}).then((r) => r.data)`)).includes(text), 20000, 250)
    const ctrlKey = async (key, code, vk, modifiers) => {
      await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers })
      await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers })
    }
    const countText = () => ev('document.querySelector("[data-testid=terminal-search-count]")?.textContent ?? null')
    /** Shows `id`, opens the search bar in its pane and returns the match count text for `query`. */
    const searchIn = async (id, query) => {
      await waitFor(() => ev('!!document.querySelector(".xterm-screen")'), 15000, 300)
      const rect = await ev('(() => { const r = document.querySelector(".xterm-screen").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()')
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

    // ---- open A once (its pane exists), then show B so A is hidden
    await select(a.id)
    await select(b.id)

    // ---- normal case: a few lines printed while A is hidden
    await ev(`window.api.ptyWrite(${js(a.id)}, "Write-Host 'HIDDEN-MARK-ONE'\\r")`)
    t.check('A printed its line while hidden (main replay has it)', !!(await replayHas(a.id, 'HIDDEN-MARK-ONE')))
    await select(a.id)
    const small = await searchIn(a.id, 'HIDDEN-MARK-ONE')
    t.check('after showing A, the line printed while hidden is in its terminal (echo + output = 2)', small === '1/2' || small === '2/2', String(small))

    // ---- flood case: more than the hidden queue limit (1,000,000 chars) while A is hidden, then a marker
    await select(b.id)
    await ev(`window.api.ptyWrite(${js(a.id)}, ${js(`node -e "process.stdout.write('x'.repeat(100)+String.fromCharCode(10)); for (let i=0;i<14000;i++) process.stdout.write('flood line '+i+' '+'y'.repeat(90)+String.fromCharCode(13,10)); console.log('HIDDEN-TAIL-MARK')"\r`)})`)
    t.check('A printed the flood and its marker while hidden', !!(await replayHas(a.id, 'HIDDEN-TAIL-MARK')))
    await select(a.id)
    await sleep(1500)
    const tail = await searchIn(a.id, 'HIDDEN-TAIL-MARK')
    t.check('after the flood the marker is in the terminal (rehydrated from replay)', typeof tail === 'string' && /^\d+\/\d+$/.test(tail), String(tail))

    // ---- the pane still works live afterwards
    await ev(`window.api.ptyWrite(${js(a.id)}, "Write-Host 'LIVE-AFTER-HIDDEN'\\r")`)
    await replayHas(a.id, 'LIVE-AFTER-HIDDEN')
    await sleep(500)
    const live = await searchIn(a.id, 'LIVE-AFTER-HIDDEN')
    t.check('live output still reaches the shown pane', live === '1/2' || live === '2/2', String(live))
  } catch (error) {
    t.check('hidden-pane e2e ran without an exception', false, String(error))
  } finally {
    if (app) app.kill()
    await sleep(500)
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }) } catch { /* a shell or the app may still hold the folder: leave it to the OS temp cleanup */ }
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
