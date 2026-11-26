// E2E (D89): the file preview belongs to the session, with its own back/forward list. Two shell sessions; files are
// opened through the Jarvis `preview_file` tool. Checks: Back/Forward buttons walk this session's files, Alt+Left
// works while the preview has focus, another session shows its own preview (or none), switching back restores the
// first session's file and history, Close clears only that session. Run: node scripts/e2e-preview-history.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9484
const js = (v) => JSON.stringify(v)

async function main() {
  const t = makeChecker()
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-phist-')))
  for (const n of ['one', 'two', 'three']) fs.writeFileSync(path.join(dir, `${n}.md`), `# File ${n}\n`)
  let app
  try {
    app = await launchApp({ port: PORT })
    await sleep(1500)
    const ev = (x) => app.evaluate(x)
    const a = await ev(`window.api.createSession({ cwd: ${js(dir)}, name: 'hist a', agent: 'shell' })`)
    const b = await ev(`window.api.createSession({ cwd: ${js(dir)}, name: 'hist b', agent: 'shell' })`)
    await sleep(1500)
    const cfg = JSON.parse(fs.readFileSync(path.join(app.userData, 'jarvis', 'mcp.json'), 'utf8')).mcpServers.sessiondeck
    let rpcId = 0
    const tool = async (name, args) => {
      const r = await fetch(cfg.url, { method: 'POST', headers: { ...cfg.headers, 'content-type': 'application/json' }, body: js({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) })
      const body = await r.json()
      return { text: body.result.content[0].text, error: body.result.isError === true }
    }
    const select = (name) => ev(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes(${js(name)}))?.click()`)
    const shown = () => ev(`document.querySelector('[data-preview-name]')?.textContent ?? ''`)
    const waitShown = (name) => waitFor(async () => ((await shown()) === name ? name : null), 8000, 200)
    const enabled = (sel) => ev(`(() => { const n = document.querySelector(${js(sel)}); return !!n && !n.disabled })()`)

    await select('hist a')
    await sleep(1200)
    await tool('preview_file', { path: 'one.md', session: 'hist a' })
    t.check('opening one.md shows it', !!(await waitShown('one.md')))
    t.check('with one file there is nowhere to go back or forward', !(await enabled('[data-preview-back]')) && !(await enabled('[data-preview-forward]')))
    await tool('preview_file', { path: 'two.md', session: 'hist a' })
    t.check('opening two.md shows it', !!(await waitShown('two.md')))
    t.check('Back is on, Forward is off', (await enabled('[data-preview-back]')) && !(await enabled('[data-preview-forward]')))

    await ev(`document.querySelector('[data-preview-back]').click()`)
    t.check('Back shows one.md again', !!(await waitShown('one.md')))
    t.check('now Forward is on', await enabled('[data-preview-forward]'))
    await ev(`document.querySelector('[data-preview-forward]').click()`)
    t.check('Forward shows two.md', !!(await waitShown('two.md')))
    await ev(`document.querySelector('[data-preview-tab]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true }))`)
    t.check('Alt+Left goes back to one.md', !!(await waitShown('one.md')))
    await ev(`document.querySelector('[data-preview-forward]').click()`)
    await waitShown('two.md')

    // ---- another session has its own preview
    await select('hist b')
    await sleep(1200)
    t.check('session b shows no preview of session a', (await ev(`document.querySelector('[data-side-tab="preview"]') === null`)))
    await tool('preview_file', { path: 'three.md', session: 'hist b' })
    t.check('session b previews its own file', !!(await waitShown('three.md')))
    t.check('and its history is empty (no Back)', !(await enabled('[data-preview-back]')))

    // ---- back to a: its file and its history are still there
    await select('hist a')
    t.check('session a still shows two.md', !!(await waitShown('two.md')))
    t.check('and can still go Back', await enabled('[data-preview-back]'))

    // ---- Close clears only this session's preview
    await ev(`document.querySelector('[data-preview-close]').click()`)
    await sleep(500)
    t.check('closing a returns to Notes', await ev(`document.querySelector('[data-side-tab="preview"]') === null`))
    await select('hist b')
    // The panel stays on Notes (the tab choice is shared); b's Preview tab is still offered with its file.
    t.check('session b still offers its Preview tab', !!(await waitFor(() => ev(`document.querySelector('[data-side-tab="preview"]') !== null || null`), 4000, 200)))
    await ev(`document.querySelector('[data-side-tab="preview"]').click()`)
    t.check('session b keeps its preview', !!(await waitShown('three.md')))
    void a
    void b
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.stack) || error))
  } finally {
    if (app) app.kill()
    await sleep(800)
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* a shell may still hold the folder */ }
  }
  process.exit(t.summary() ? 1 : 0)
}

main()
