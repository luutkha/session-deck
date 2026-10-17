// E2E: terminal links. Types a line into the Claude input box (no Enter), checks that existing files/folders/URLs get the
// link pointer cursor on hover and that a missing path does not. Never clicks (that would open apps on the user's desktop).
// Run: node scripts/e2e-links.cjs
const { ROOT, sleep, waitFor, makeChecker, launchApp, strip } = require('./e2e-lib.cjs')

async function main() {
  const t = makeChecker()
  let app
  try {
    app = await launchApp({ port: 9395 })
    await sleep(1500)
    const s = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'link probe' })`)
    const id = JSON.stringify(s.id)
    await sleep(1500)

    // ---- main process: classification
    const r = await app.evaluate(`window.api.resolveLinks(${id}, ['package.json', 'src/main', 'https://example.com/a', 'no/such/file.ts', 'hello', '\\\\\\\\evil\\\\share\\\\x.txt', 'javascript:alert(1)'])`)
    t.check('existing file -> file', r[0]?.kind === 'file')
    t.check('existing folder -> folder', r[1]?.kind === 'folder')
    t.check('https URL -> url', r[2]?.kind === 'url')
    t.check('missing file -> null', r[3] === null)
    t.check('plain word -> null', r[4] === null)
    t.check('UNC path -> null (no network access)', r[5] === null)
    t.check('javascript: -> null', r[6] === null)
    const bad = await app.evaluate(`window.api.openLink(${id}, 'no/such/file.ts', false)`)
    t.check('opening a missing path fails politely', bad.ok === false && typeof bad.error === 'string')
    const arr = await app.evaluate(`window.api.resolveLinks(${id}, 'oops').then(() => 'accepted', () => 'rejected')`)
    t.check('malformed candidate list is rejected', arr === 'rejected')

    // ---- renderer: hover shows the pointer cursor only over real targets
    await app.evaluate(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('link probe')).click()`)
    await waitFor(async () => /❯|Try "/.test(strip((await app.evaluate(`window.api.ptyReplay(${id})`)).data)), 40000, 1000)
    await sleep(1500)
    await app.evaluate(`window.api.ptyWrite(${id}, 'package.json nosuchfile.zzz')`)
    await sleep(1200)
    const geo = await app.evaluate(`(() => { const r = document.querySelector('.xterm-screen').getBoundingClientRect(); const c = document.querySelector('.xterm'); return { left: r.left, top: r.top, w: r.width, h: r.height } })()`)
    const cols = Math.round(await app.evaluate(`window.api && 120`))
    void cols
    const cellH = geo.h / 30
    const cellW = geo.w / (await app.evaluate(`Math.round(document.querySelector('.xterm-screen').getBoundingClientRect().width / ((document.querySelector('.xterm-char-measure-element') || {}).getBoundingClientRect?.().width || 8))`))
    const pointerAt = async (col) => {
      for (let row = 0; row < 30; row += 1) {
        const x = geo.left + (col + 0.5) * cellW
        const y = geo.top + (row + 0.5) * cellH
        await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
        await sleep(60)
        if (await app.evaluate(`!!document.querySelector('.xterm-cursor-pointer')`)) return row
      }
      return -1
    }
    const hit = await pointerAt(4) // "❯ package.json": col 2..13
    t.check('hovering package.json in the terminal shows the link cursor', hit >= 0, `row ${hit}`)
    await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: geo.left + 2, y: geo.top + geo.h - 2, button: 'none' })
    await sleep(300)
    const miss = await app.evaluate(`!!document.querySelector('.xterm-cursor-pointer')`)
    t.check('pointer cursor goes away off the link', miss === false)
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.message) || error))
  } finally {
    t.summary()
    if (app) app.kill()
  }
}
main()
