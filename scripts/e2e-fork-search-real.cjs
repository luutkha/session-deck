// E2E (D52) with a REAL Claude: conversation search and forking a session, through the real UI.
// Sends TWO tiny prompts (costs a few cents of the user's plan). Reads the user's ~/.claude transcripts (never writes).
// Run: node scripts/e2e-fork-search-real.cjs   (E2E_SHOT_DIR=<dir> saves screenshots)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { ROOT, sleep, strip, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9443
const CTRL = 2
const SHIFT = 8
const CODEWORD = `MANGO${Math.floor(Math.random() * 90000 + 10000)}`

function transcriptPath(claudeId) {
  const projects = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects')
  for (const dir of fs.readdirSync(projects)) {
    const file = path.join(projects, dir, `${claudeId}.jsonl`)
    if (fs.existsSync(file)) return file
  }
  return null
}

async function main() {
  const t = makeChecker()
  let app
  const js = (value) => JSON.stringify(value)
  try {
    app = await launchApp({ port: PORT })
    await sleep(1200)
    const ev = (expression) => app.evaluate(expression)
    const store = async () => ev('window.api.getStore()')
    const key = async (k, code, vk, modifiers = 0) => {
      await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers })
      await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers })
      await sleep(150)
    }
    const center = (expr) => ev(`(() => { const n = ${expr}; if (!n) return null; n.scrollIntoView({ block: 'center' }); const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    const click = async (expr, label, button = 'left') => {
      const point = await waitFor(() => center(expr), 8000, 200)
      if (!point) throw new Error('not found: ' + label)
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await app.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: type === 'mouseMoved' ? 'none' : button, buttons: type === 'mousePressed' ? (button === 'right' ? 2 : 1) : 0, clickCount: 1 })
      }
      await sleep(400)
    }
    const shot = async (name) => {
      if (!process.env.E2E_SHOT_DIR) return
      const r = await app.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(process.env.E2E_SHOT_DIR, name + '.png'), Buffer.from(r.result.data, 'base64'))
    }
    const card = (name) => `[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes(${js(name)}))`
    const activeTab = () => ev(`document.querySelector('[role=tab][aria-selected=true]')?.getAttribute('data-tab-id') ?? null`)
    const startClaude = async (id) => {
      await waitFor(async () => /[A-Za-z]{6,}/.test(strip((await ev(`window.api.ptyReplay(${js(id)})`)).data)), 45000, 1000)
      await sleep(2000)
      // Same first-run dialog handling as scripts/e2e.cjs (trust prompt: move to "Yes" first).
      for (let i = 0; i < 3; i += 1) {
        const screen = await ev(`window.api.ptyReplay(${js(id)}).then((r) => r.data.slice(-4000))`)
        if (/Yes, I trust this folder/.test(screen) && /No, exit/.test(screen)) { await ev(`window.api.ptyWrite(${js(id)}, '\\x1b[B')`); await sleep(500) }
        await ev(`window.api.ptyWrite(${js(id)}, '\\r')`)
        await sleep(2500)
      }
    }
    const turnDone = (id, re) => waitFor(async () => (await ev(`window.api.getTimeline(${js(id)})`)).find((x) => re.test(x.prompt) && x.end === 'finished') ?? null, 180000, 1500)
    const prompt = async (id, text) => {
      await ev(`window.api.ptyWrite(${js(id)}, ${js(text)})`)
      await sleep(500)
      await ev(`window.api.ptyWrite(${js(id)}, '\\r')`)
    }

    // ---- a real conversation with a codeword
    const parent = await ev(`window.api.createSession({ cwd: ${js(ROOT)}, name: 'fork parent' })`)
    await click(card('fork parent'), 'parent card')
    await startClaude(parent.id)
    await prompt(parent.id, `Remember the codeword ${CODEWORD}. Reply with only: noted`)
    t.check('the parent turn finished', !!(await turnDone(parent.id, /codeword/)))

    // ---- search it through the palette and the dialog
    await ev('document.activeElement && document.activeElement.blur(); true')
    await key('K', 'KeyK', 75, CTRL | SHIFT)
    await waitFor(() => ev('!!document.querySelector("[cmdk-input]")'), 3000, 100)
    await app.send('Input.insertText', { text: 'Search conversations' })
    await sleep(300)
    await key('Enter', 'Enter', 13)
    t.check('palette "Search conversations" opens the dialog', !!(await waitFor(() => ev('!!document.querySelector("[data-search-dialog]")'), 5000, 200)))
    await click(`document.querySelector('input[aria-label="Search text"]')`, 'search input')
    await app.send('Input.insertText', { text: CODEWORD.toLowerCase() })
    const hit = await waitFor(() => ev(`document.querySelector('[data-search-hit="fork parent"]')?.innerText ?? null`), 8000, 200)
    t.check('the codeword is found (case-insensitive) in the parent conversation', !!hit && hit.includes(CODEWORD) && hit.includes('You'), String(hit))
    t.check('the match is highlighted', (await ev(`document.querySelector('[data-search-dialog] mark')?.innerText ?? ''`)) === CODEWORD)
    await shot('conversation-search')
    await ev(`window.api.setActiveSession(null)`)
    await click(`document.querySelector('[data-search-hit="fork parent"]')`, 'search hit')
    t.check('clicking a match opens that session', !!(await waitFor(async () => (await activeTab()) === parent.id, 5000, 200)))

    // ---- fork from the right-click menu
    await click(card('fork parent'), 'parent card (context)', 'right')
    await click(`document.querySelector('[data-fork-session]')`, 'Fork session')
    const fork = await waitFor(async () => (await store()).data.sessions.find((s) => s.name === 'fork parent (fork)') ?? null, 8000, 200)
    t.check('"Fork session" creates "fork parent (fork)"', !!fork)
    t.check('...with its own conversation id, the parent keeps its id', !!fork && fork.claudeSessionId !== parent.claudeSessionId &&
      (await store()).data.sessions.find((s) => s.id === parent.id)?.claudeSessionId === parent.claudeSessionId)
    t.check('...and opens it', !!(await waitFor(async () => (await activeTab()) === fork.id, 6000, 200)))
    await startClaude(fork.id)
    await prompt(fork.id, 'What is the codeword I told you? Reply with only the codeword.')
    t.check('the fork answers its first turn', !!(await turnDone(fork.id, /What is the codeword/)))
    const forkScreen = strip((await ev(`window.api.ptyReplay(${js(fork.id)})`)).data)
    t.check('the fork remembers the parent conversation (codeword on screen)', forkScreen.includes(CODEWORD), forkScreen.slice(-500))
    const parentFile = transcriptPath(parent.claudeSessionId)
    t.check('the parent conversation is untouched (no fork question in it)', !!parentFile && !fs.readFileSync(parentFile, 'utf8').includes('What is the codeword I told you'))

    // ---- a session without a conversation cannot be forked
    const fresh = await ev(`window.api.createSession({ cwd: ${js(ROOT)}, name: 'no conversation' })`)
    const refused = await ev(`window.api.forkSession(${js(fresh.id)}).then(() => 'ok', (e) => String(e.message || e))`)
    t.check('forking a session with no saved conversation is refused with a clear message', /Nothing to fork yet/.test(refused), refused)

    for (const s of [fork, parent, fresh]) await ev(`window.api.removeSession(${js(s.id)})`)
  } catch (error) {
    t.check('no unexpected error', false, String((error && error.stack) || error))
  } finally {
    if (app) app.kill()
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
