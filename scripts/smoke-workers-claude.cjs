// Manual smoke test of the REAL path (uses a real Claude turn and a free OpenCode model): a Claude session inside
// SessionDeck is told to run `opencode`; the worker must appear as a tab with no help from this script.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

async function main() {
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-smoke-claude-'))
  try {
    const proj = path.join(root, 'proj')
    fs.mkdirSync(proj)
    app = await launchApp({ port: 9378 })
    await sleep(1200)
    const s = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(proj)}, name: 'real-claude' })`)
    await sleep(1500)
    await app.evaluate(`[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes('real-claude'))?.click()`)
    const write = (data) => app.evaluate(`window.api.ptyWrite(${JSON.stringify(s.id)}, ${JSON.stringify(data)})`)
    const screen = () => app.evaluate(`window.api.ptyReplay(${JSON.stringify(s.id)}).then((r) => r.data.slice(-6000))`)
    await waitFor(async () => /[A-Za-z]{6,}/.test(await screen()), 40000, 1000)
    for (let i = 0; i < 4; i += 1) {
      const text = await screen()
      if (/Yes, I trust this folder/.test(text) && /No, exit/.test(text)) { await write(String.fromCharCode(27) + '[B'); await sleep(400) }
      await write(String.fromCharCode(13))
      await sleep(2500)
    }
    const prompt = 'Run exactly this one bash command and then stop: echo "# Smoke task: say hi" | opencode run -m opencode/big-pickle'
    await write(prompt)
    await sleep(500)
    await write(String.fromCharCode(13))

    const chips = () => app.evaluate(`[...document.querySelectorAll('[data-worker-id]')].map((n) => n.getAttribute('data-worker-status') + ':' + n.innerText.trim())`)
    const seen = await waitFor(async () => { const c = await chips(); return c.length >= 1 ? c : null }, 150000, 1000)
    t.check('opencode started by a real Claude session appears as a worker tab', !!seen, JSON.stringify(seen))
    const done = await waitFor(async () => ((await chips())[0] || '').startsWith('done:'), 90000, 1000)
    t.check('it finishes as done', !!done, JSON.stringify(await chips()))
    if (!seen) console.log('TERMINAL TAIL:\n' + (await screen()).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').slice(-1500))
  } catch (e) {
    t.check('run completed without exception', false, String(e.message || e))
  } finally {
    if (app) app.kill()
    await sleep(500)
    fs.rmSync(root, { recursive: true, force: true })
    process.exit(t.summary() ? 1 : 0)
  }
}
main()
