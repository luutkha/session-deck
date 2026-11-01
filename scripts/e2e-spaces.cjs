// E2E (D54 item 1): SessionDeck on a PC whose user folder has a space (e.g. C:\Users\John Smith). The app's data
// folder is put under a path WITH SPACES; Jarvis's real `claude` must start with its --settings, --mcp-config and
// --append-system-prompt-file paths intact (cmd.exe quoting) and see SessionDeck's tools. `/mcp` only reads.
// Run: node scripts/e2e-spaces.cjs   (EXE=<path to SessionDeck.exe> to test a packaged build)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, strip, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9466

async function main() {
  const t = makeChecker()
  const js = (value) => JSON.stringify(value)
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sd e2e spaces '))
  const userData = path.join(base, 'John Smith', 'AppData Roaming', 'SessionDeck')
  fs.mkdirSync(userData, { recursive: true })
  const folder = path.join(base, 'my project folder')
  fs.mkdirSync(folder)
  let app
  try {
    app = await launchApp({ port: PORT, userData, ...(process.env.EXE ? { exePath: process.env.EXE } : {}) })
    await sleep(1500)
    const ev = (expression) => app.evaluate(expression)
    const screen = async (id) => strip((await ev(`window.api.ptyReplay(${js(id)})`)).data)
    t.check('the data folder path has spaces', userData.includes(' '), userData)

    // A normal Claude session in a folder with spaces (hooks: --settings under the data folder).
    const session = await ev(`window.api.createSession({ cwd: ${js(folder)}, name: 'spaced' })`)
    const started = await waitFor(async () => (/trust|bypass\s*permissions/i.test((await screen(session.id)).slice(-3000)) ? true : null), 60000, 1000)
    t.check('a Claude session starts in a folder with spaces', started === true, (await screen(session.id)).slice(-600))

    // Jarvis: --mcp-config / --append-system-prompt-file paths with spaces.
    const jarvis = await ev('window.api.openJarvis()')
    const ready = await waitFor(async () => (/bypass\s*permissions/i.test((await screen(jarvis.id)).slice(-3000)) ? true : null), 90000, 1000)
    t.check('Jarvis\'s Claude starts with launch paths that contain spaces', ready === true, (await screen(jarvis.id)).slice(-800))
    await sleep(2500)
    await ev(`window.api.ptyWrite(${js(jarvis.id)}, '/mcp')`)
    await sleep(800)
    await ev(`window.api.ptyWrite(${js(jarvis.id)}, '\\r')`)
    const mcp = await waitFor(async () => {
      const s = (await screen(jarvis.id)).slice(-2500)
      return /sessiondeck\s*\d+\s*tools/i.test(s) ? s : null
    }, 20000, 1000)
    t.check('...and SessionDeck\'s tools are connected (/mcp)', !!mcp && /✔\s*sessiondeck/i.test(mcp), String(mcp ?? (await screen(jarvis.id)).slice(-1200)))
    await ev(`window.api.ptyWrite(${js(jarvis.id)}, '\\x1b')`)

    for (const s of (await ev('window.api.getStore()')).data.sessions) await ev(`window.api.removeSession(${js(s.id)})`)
  } catch (error) {
    t.check('no unexpected error', false, String((error && error.stack) || error))
  } finally {
    if (app) app.kill()
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
