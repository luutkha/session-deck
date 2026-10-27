// E2E (W6): opt-in auto-answer for Claude Code's "Do you trust the files in this folder?" prompt.
// A fake `claude` on PATH prints the real menu and records every byte it receives, so this test never touches the
// user's ~/.claude trust store. Verifies: default OFF leaves the prompt alone, the Settings > Code switch persists,
// and a fresh Claude session in a new worktree gets the exact Down + Enter answer exactly once.
// Run: node scripts/e2e-trust.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9417
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args], { cwd, encoding: 'utf8' }).trim()

/** A git repo with one commit, for a real `git worktree add`. */
function makeRepo(root) {
  const repo = path.join(root, 'trust-app')
  fs.mkdirSync(repo, { recursive: true })
  git(root, 'init', '-q', '-b', 'main', repo)
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  return repo
}

/**
 * Writes a fake `claude` (and the node script it runs) into `binDir`. The stub prints the real trust menu after a
 * short delay, then records every byte it receives as a JSON line in events.log. It stays alive until it is answered
 * or killed, and exits 0 shortly after the Down + Enter answer arrives.
 */
function writeFakeClaude(binDir) {
  const events = path.join(binDir, 'events.log')
  fs.writeFileSync(events, '')
  fs.writeFileSync(path.join(binDir, 'claude.cmd'), '@echo off\r\nnode "%~dp0fake-claude.js" %*\r\n')
  fs.writeFileSync(
    path.join(binDir, 'fake-claude.js'),
    `const fs = require('node:fs')
const path = require('node:path')
const events = ${JSON.stringify(events)}
const args = process.argv.slice(2)
const at = args.indexOf('--session-id')
const id = at >= 0 ? args[at + 1] : (args.indexOf('--resume') >= 0 ? args[args.indexOf('--resume') + 1] : 'unknown')
const record = (event, data) => fs.appendFileSync(events, JSON.stringify({ t: Date.now(), id, event, ...(data === undefined ? {} : { data }) }) + '\\n')
record('start')
if (process.stdin.isTTY) process.stdin.setRawMode(true)
process.stdin.resume()
process.stdin.on('data', (chunk) => {
  const text = chunk.toString('utf8')
  record('data', text)
  if (text.includes('\\x1b[B\\r')) {
    record('answered')
    setTimeout(() => process.exit(0), 200)
  }
})
setTimeout(() => {
  process.stdout.write('Do you trust the files in this folder?\\r\\n  Yes, I trust this folder\\r\\n  No, exit\\r\\n')
}, 400)
setInterval(() => {}, 1 << 30)
`
  )
  return events
}

function eventsOf(file) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

async function main() {
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-trust-'))
  const binDir = path.join(root, 'bin')
  fs.mkdirSync(binDir)
  const repo = makeRepo(root)
  const worktreesRoot = path.join(root, 'wt')
  const js = (value) => JSON.stringify(value)
  const eventsFile = writeFakeClaude(binDir)
  process.env.PATH = binDir + path.delimiter + process.env.PATH

  try {
    app = await launchApp({ port: PORT })
    await sleep(1200)
    const ev = (expression) => app.evaluate(expression)
    const store = () => ev('window.api.getStore()')
    const settings = async () => (await store()).data.settings

    await ev(`window.api.updateSettings({ code: { worktreesRoot: ${js(worktreesRoot)} } })`)
    const added = await ev(`window.api.addRepo(${js(repo)})`)
    t.check('a temp git repo is added for the worktree', added.name === 'trust-app', added.path)

    const defaults = await settings()
    t.check('auto-answer is OFF by default', defaults?.code?.autoTrustWorktrees !== true, js(defaults?.code))

    // ---- OFF: a fresh Claude worktree session shows the prompt and receives nothing.
    const off = await ev(`window.api.createWorktree({ repoId: ${js(added.id)}, name: ${js('off-worktree')}, baseBranch: 'main', agent: 'claude' })`)
    t.check('the first worktree starts a Claude session inside it', (off.session?.agent ?? 'claude') === 'claude', js(off.session))
    const offStart = await waitFor(() => eventsOf(eventsFile).some((e) => e.id === off.session.id && e.event === 'start'), 20000, 300)
    t.check('the fake Claude inside the worktree printed the trust menu', !!offStart)
    await sleep(3500)
    const offAnswers = eventsOf(eventsFile).filter((e) => e.id === off.session.id && e.event === 'data')
    t.check('with the setting off nothing is typed into the prompt', offAnswers.length === 0, js(offAnswers))

    // ---- toggle it through the real Settings dialog
    const gear = await waitFor(() => ev(`(() => { const n = document.querySelector('[aria-label="Settings"]'); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`), 8000, 300)
    t.check('the Settings button is available', !!gear)
    const press = async (point) => {
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0 })
      await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 })
      await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 })
      await sleep(400)
    }
    await press(gear)
    const dialog = await waitFor(() => ev(`!!document.querySelector('[role=dialog]')`), 6000, 200)
    t.check('Settings opens', !!dialog)
    const codeNav = await waitFor(() => ev(`(() => { const n = [...document.querySelectorAll('[role=dialog] button')].find((b) => b.innerText.trim().startsWith('Code')); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`), 5000, 200)
    t.check('Settings has a Code section', !!codeNav)
    await press(codeNav)
    const switchState = await waitFor(() => ev(`document.querySelector('#code-auto-trust')?.getAttribute('aria-checked') ?? null`), 5000, 200)
    t.check('the Code section shows the auto-answer switch, off', switchState === 'false', String(switchState))
    const switchPoint = await ev(`(() => { const n = document.querySelector('#code-auto-trust'); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    await press(switchPoint)
    const onStored = await waitFor(async () => (await settings())?.code?.autoTrustWorktrees === true, 6000, 300)
    t.check('clicking the switch saves autoTrustWorktrees = true', !!onStored)
    t.check('the switch now shows on', (await ev(`document.querySelector('#code-auto-trust')?.getAttribute('aria-checked')`)) === 'true')
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
    await sleep(400)
    await ev(`window.api.closeSession(${js(off.session.id)})`)
    await sleep(500)

    // ---- ON: a second fresh worktree gets the exact answer once
    const on = await ev(`window.api.createWorktree({ repoId: ${js(added.id)}, name: ${js('on-worktree')}, baseBranch: 'main', agent: 'claude' })`)
    const answered = await waitFor(() => eventsOf(eventsFile).find((e) => e.id === on.session.id && e.event === 'answered'), 20000, 300)
    t.check('the fresh worktree prompt is answered automatically', !!answered, answered ? 'after ' + String(answered.t) : '')
    const onData = eventsOf(eventsFile).filter((e) => e.id === on.session.id && e.event === 'data')
    t.check('the answer is exactly Down + Enter (the menu default is No, exit)', onData.length === 1 && onData[0].data === '\x1b[B\r', js(onData))
    t.check('the answer is typed only once per process', eventsOf(eventsFile).filter((e) => e.id === on.session.id && e.event === 'answered').length === 1)

    const persisted = (await store()).data.settings
    t.check('the setting survives in the store', persisted?.code?.autoTrustWorktrees === true)
  } catch (error) {
    t.check('no unexpected error', false, String((error && error.stack) || error))
  } finally {
    if (app) app.kill()
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
