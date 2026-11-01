// E2E (D53): Jarvis's tools against the real built app, called over its MCP endpoint exactly the way Claude calls them,
// plus the UI: the right-side Jarvis panel in Ops and Code mode, Ctrl+Shift+J, the tab-bar button, the in-app Yes/No for
// destructive tools, palette, settings.
// The tool calls use Shell sessions (no model, no quota). Ctrl+Shift+J starts the real `claude` for Jarvis in the run's
// temp profile; no prompt is sent to it. Run: node scripts/e2e-jarvis.cjs   (E2E_SHOT_DIR=<dir> saves screenshots)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, strip, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9462
const CTRL = 2
const SHIFT = 8

async function main() {
  const t = makeChecker()
  const js = (value) => JSON.stringify(value)
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-jarvis-'))
  let app
  try {
    app = await launchApp({ port: PORT })
    await sleep(1200)
    const ev = (expression) => app.evaluate(expression)
    const store = async () => (await ev('window.api.getStore()'))
    const byName = async (name) => (await store()).data.sessions.find((s) => s.name === name)
    const runtimeOf = async (id) => (await store()).runtime.find((r) => r.sessionId === id)
    const shot = async (name) => {
      if (!process.env.E2E_SHOT_DIR) return
      const r = await app.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(process.env.E2E_SHOT_DIR, name + '.png'), Buffer.from(r.result.data, 'base64'))
    }
    const center = (expr) => ev(`(() => { const n = ${expr}; if (!n) return null; n.scrollIntoView({ block: 'center' }); const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    const click = async (expr, label) => {
      const point = await waitFor(() => center(expr), 8000, 200)
      if (!point) throw new Error('not found: ' + label)
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await app.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 })
      }
      await sleep(400)
    }
    const button = (text) => `[...document.querySelectorAll('[role=alertdialog] button')].find((b) => b.innerText.trim() === ${js(text)})`

    // ---- the MCP endpoint (what `claude --mcp-config` is given)
    const cfgFile = path.join(app.userData, 'jarvis', 'mcp.json')
    t.check('the MCP config is written to <userData>/jarvis/mcp.json', fs.existsSync(cfgFile))
    t.check('the system prompt file is written next to it', fs.existsSync(path.join(app.userData, 'jarvis', 'system-prompt.md')))
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')).mcpServers.sessiondeck
    let rpcId = 0
    const rpc = async (method, params, headers = cfg.headers) => {
      const response = await fetch(cfg.url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) })
      return { status: response.status, body: response.status === 200 ? await response.json() : null }
    }
    const tool = async (name, args = {}) => {
      const { body } = await rpc('tools/call', { name, arguments: args })
      return { text: body.result.content[0].text, error: body.result.isError === true }
    }
    t.check('the endpoint listens on 127.0.0.1 only', cfg.url.startsWith('http://127.0.0.1:'))
    t.check('a call without the token is refused (401)', (await rpc('tools/list', {}, {})).status === 401)
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } })
    t.check('initialize answers with the tools capability', init.body?.result?.capabilities?.tools !== undefined, js(init.body))
    const list = await rpc('tools/list', {})
    const names = list.body.result.tools.map((x) => x.name)
    t.check('every tool is offered (27)', names.length === 27, names.join(','))

    // ---- the pinned sidebar entry before Jarvis exists
    t.check('the tab bar has the Jarvis button, the panel is not open yet', (await waitFor(() => ev(`!!document.querySelector('[data-jarvis-toggle]') || null`), 5000, 200)) === true &&
      (await ev(`document.querySelector('[data-jarvis-panel]')?.getAttribute('data-jarvis-panel') ?? 'none'`)) === 'none')

    // ---- create + first prompt (a Shell session: no model)
    const created = await tool('create_session', { folder, name: 'jv shell', agent: 'shell', prompt: 'echo JARVIS_WAS_HERE' })
    t.check('create_session creates the session and types the first prompt', !created.error && /Created "jv shell"/.test(created.text) && /Typed into the shell/.test(created.text), created.text)
    const shell = await byName('jv shell')
    t.check('...the session is in the store with the folder and agent', !!shell && shell.cwd === folder && shell.agent === 'shell')
    t.check('...and shows in the sidebar like any session', !!(await waitFor(() => ev(`[...document.querySelectorAll('[role=treeitem]')].some((n) => n.innerText.includes('jv shell'))`), 5000, 200)))
    const screen = await waitFor(async () => {
      const r = await tool('read_screen', { session: 'jv shell', lines: 60 })
      return /JARVIS_WAS_HERE\s*\n/.test(r.text.split('----- screen -----')[1] ?? '') ? r.text : null
    }, 15000, 800)
    t.check('read_screen shows the command output as plain text', !!screen && !/\x1b\[/.test(screen), String(screen).slice(-300))

    const listed = await tool('list_sessions')
    t.check('list_sessions lists it as running', /"jv shell" \(id [^)]+\) · shell · running/.test(listed.text), listed.text)

    // ---- D54: wait / last answer / usage / away
    const waited = await tool('wait_for_session', { session: 'jv shell', timeout_seconds: 5 })
    t.check('wait_for_session returns at once for an idle shell, pointing to read_screen', /"jv shell" is running, idle \(waited \d+ s\)\. Use read_screen/.test(waited.text), waited.text)
    const last = await tool('get_last_answer', { session: 'jv shell' })
    t.check('get_last_answer falls back to the screen for a shell', /No saved conversation/.test(last.text) && last.text.includes('JARVIS_WAS_HERE'), last.text.slice(-200))
    const usageText = await tool('get_usage')
    t.check('get_usage answers with the cost of today', !usageText.error && /Cost of all sessions today: \$\d+\.\d\d/.test(usageText.text), usageText.text)
    const awayText = await tool('get_away_summary')
    t.check('get_away_summary answers (none yet in a fresh run)', /No away summary yet/.test(awayText.text), awayText.text)

    // ---- sleep / wake (reconnect)
    const slept = await tool('sleep_session', { session: 'jv shell' })
    t.check('sleep_session puts it to sleep', slept.text === '"jv shell" is asleep.' && !!(await waitFor(async () => (await runtimeOf(shell.id))?.sleeping === true, 5000, 200)), slept.text)
    const woke = await tool('wake_session', { session: 'jv' })
    t.check('wake_session wakes it (partial name)', /waking up/.test(woke.text) && !!(await waitFor(async () => { const r = await runtimeOf(shell.id); return r?.run === 'running' && !r.sleeping }, 8000, 200)), woke.text)

    // ---- organize
    await tool('create_group', { name: 'Jarvis group' })
    const moved = await tool('move_to_group', { session: 'jv shell', group: 'jarvis group' })
    const group = (await store()).data.groups.find((g) => g.name === 'Jarvis group')
    t.check('create_group + move_to_group move the session', !!group && (await byName('jv shell'))?.groupId === group.id, moved.text)
    await tool('rename_session', { session: 'jv shell', name: 'jv shell one' })
    t.check('rename_session renames it', !!(await byName('jv shell one')))

    // ---- ambiguity and Jarvis protection
    await tool('create_session', { folder, name: 'jv shell two', agent: 'shell' })
    const ambiguous = await tool('close_session', { session: 'jv shell' })
    t.check('an ambiguous name is refused with the candidates', ambiguous.error && /matches 2 sessions/.test(ambiguous.text), ambiguous.text)

    // ---- destructive: the user answers in the app
    const pendingNo = tool('remove_session', { session: 'jv shell two' })
    const dialog = await waitFor(() => ev(`document.querySelector('[role=alertdialog]')?.innerText ?? null`), 8000, 200)
    t.check('remove_session asks the user in the app', !!dialog && dialog.includes('Jarvis wants to remove session “jv shell two”'), String(dialog))
    await shot('jarvis-confirm')
    await click(button('Cancel'), 'Cancel')
    const no = await pendingNo
    t.check('Cancel = nothing removed, Jarvis is told', /did not allow/.test(no.text) && !!(await byName('jv shell two')), no.text)
    const pendingYes = tool('remove_session', { session: 'jv shell two' })
    await waitFor(() => ev(`!!document.querySelector('[role=alertdialog]')`), 8000, 200)
    await click(button('Remove'), 'Remove')
    const yes = await pendingYes
    t.check('Remove = the session is removed', yes.text === '"jv shell two" was removed.' && !(await byName('jv shell two')), yes.text)

    // ---- prompts into a sleeping session wake it first
    await tool('sleep_session', { session: 'jv shell one' })
    await waitFor(async () => (await runtimeOf(shell.id))?.sleeping === true, 5000, 200)
    const sent = await tool('send_prompt', { session: 'jv shell one', text: 'echo SECOND_PROMPT' })
    t.check('send_prompt wakes a sleeping session, then types', /^Woke it first\. Typed into the shell/.test(sent.text), sent.text)

    // ---- the action log
    const logFile = path.join(app.userData, 'jarvis', 'actions.log')
    const logged = await waitFor(() => (fs.existsSync(logFile) && fs.readFileSync(logFile, 'utf8').includes('remove_session') ? fs.readFileSync(logFile, 'utf8') : null), 3000, 200)
    t.check('actions are written to <userData>/jarvis/actions.log', !!logged && logged.includes('create_session') && logged.includes('sleep_session'))

    // ---- Ctrl+Shift+J opens the Jarvis panel over the current session (real claude, no prompt)
    const panelState = () => ev(`document.querySelector('[data-jarvis-panel]')?.getAttribute('data-jarvis-panel') ?? 'none'`)
    const pressJ = async () => {
      await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'J', code: 'KeyJ', windowsVirtualKeyCode: 74, modifiers: CTRL | SHIFT })
      await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'J', code: 'KeyJ', windowsVirtualKeyCode: 74, modifiers: CTRL | SHIFT })
      await sleep(300)
    }
    const modeButton = (label) => `[...document.querySelectorAll('[aria-label=Mode] button, [aria-label=Mode] [role=radio]')].find((b) => b.innerText.trim().startsWith(${js(label)}))`
    const tabBefore = await ev(`document.querySelector('[role=tab][aria-selected=true]')?.getAttribute('data-tab-id') ?? null`)
    await ev('document.activeElement && document.activeElement.blur(); true')
    await pressJ()
    t.check('Ctrl+Shift+J opens the Jarvis panel', (await waitFor(async () => (await panelState()) === 'open' || null, 5000, 200)) === true)
    const jarvis = await waitFor(async () => (await store()).data.sessions.find((s) => s.role === 'jarvis') ?? null, 10000, 300)
    t.check('...creating the Jarvis session (named Jarvis, in <userData>/jarvis)', !!jarvis && jarvis.name === 'Jarvis' && jarvis.cwd === path.join(app.userData, 'jarvis'))
    const panelBox = await waitFor(() => ev(`(() => { const p = document.querySelector('[data-jarvis-panel=open]'); const x = p?.querySelector('.xterm'); if (!p || !x) return null; const a = p.getBoundingClientRect(); const b = x.getBoundingClientRect(); return { right: Math.round(a.right), left: Math.round(a.left), win: window.innerWidth, xw: Math.round(b.width), xh: Math.round(b.height) } })()`), 10000, 300)
    t.check('...on the right side, over the page, with a sized terminal', !!panelBox && panelBox.right === panelBox.win && panelBox.left > panelBox.win / 4 && panelBox.xw > 200 && panelBox.xh > 200, js(panelBox))
    t.check('...without opening a tab: the session on screen stays the same', (await ev(`document.querySelector('[role=tab][aria-selected=true]')?.getAttribute('data-tab-id') ?? null`)) === tabBefore)
    t.check('Jarvis is never a tab or a sidebar card', !(await ev(`[...document.querySelectorAll('[role=tab]')].some((n) => n.getAttribute('data-tab-id') === ${js(jarvis.id)})`)) &&
      !(await ev(`[...document.querySelectorAll('[role=treeitem]')].some((n) => n.innerText.trim().startsWith('Jarvis'))`)))
    t.check('the tab-bar button shows the panel is open', (await ev(`document.querySelector('[data-jarvis-toggle]')?.getAttribute('aria-pressed')`)) === 'true')
    const ready = await waitFor(async () => {
      const s = strip((await ev(`window.api.ptyReplay(${js(jarvis.id)})`)).data).slice(-3000)
      return /bypass\s*permissions/i.test(s) ? s : null
    }, 60000, 1000)
    t.check('Jarvis\'s Claude starts past the folder-trust question by itself', !!ready)
    t.check('the panel draws the terminal (WebGL canvas, no DOM text to read)', !!(await waitFor(() => ev(`(() => { const c = document.querySelector('[data-jarvis-panel] .xterm-screen canvas'); return c && c.getBoundingClientRect().height > 100 ? true : null })()`), 10000, 300)))
    await shot('jarvis-panel-ops')

    // ---- Code mode: the panel stays open across the mode switch and works there too
    await click(modeButton('Code'), 'Code mode')
    await sleep(800)
    t.check('switching to Code mode keeps the panel open', (await panelState()) === 'open' && !!(await ev(`!!document.querySelector('[data-jarvis-panel=open] .xterm')`)))
    await shot('jarvis-panel-code')
    await click(`document.querySelector('[data-jarvis-toggle]')`, 'Jarvis button (Code)')
    t.check('Code mode has the Jarvis button; it closes the panel', (await waitFor(async () => (await panelState()) === 'closed' || null, 3000, 200)) === true)
    const kept = await ev(`(() => { const x = document.querySelector('[data-jarvis-panel] .xterm'); return x ? Math.round(x.getBoundingClientRect().width) : 0 })()`)
    t.check('closing keeps the terminal at its size (no redraw at a tiny width)', kept > 200, String(kept))
    await pressJ()
    t.check('Ctrl+Shift+J opens it again in Code mode', (await waitFor(async () => (await panelState()) === 'open' || null, 3000, 200)) === true)
    await pressJ()
    t.check('...and closes it', (await waitFor(async () => (await panelState()) === 'closed' || null, 3000, 200)) === true)
    await click(modeButton('Ops'), 'Ops mode')
    await sleep(500)

    const again = await ev('window.api.openJarvis()')
    t.check('opening Jarvis again reuses the same session', again.id === jarvis.id && (await store()).data.sessions.filter((s) => s.role === 'jarvis').length === 1)
    const self = await tool('close_session', { session: 'Jarvis' })
    t.check('Jarvis\'s tools cannot act on Jarvis', self.error && /No session matches "Jarvis"/.test(self.text), self.text)

    // ---- palette and settings
    await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'K', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: CTRL | SHIFT })
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'K', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: CTRL | SHIFT })
    await waitFor(() => ev('!!document.querySelector("[cmdk-input]")'), 3000, 100)
    await app.send('Input.insertText', { text: 'jarvis' })
    await sleep(300)
    const items = await ev(`[...document.querySelectorAll('[cmdk-item]')].map((n) => n.innerText)`)
    t.check('the palette offers Open Jarvis and a new Jarvis conversation', items.some((x) => x.includes('Open Jarvis')) && items.some((x) => x.includes('start a new conversation')), js(items))
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
    t.check('Jarvis uses Sonnet by default', (await store()).data.settings?.jarvis?.model === undefined || (await store()).data.settings.jarvis.model === 'sonnet')
    const saved = await ev(`window.api.updateSettings({ jarvis: { model: 'opus' } }).then((s) => s.jarvis.model)`)
    t.check('the Jarvis model can be changed', saved === 'opus')
    const refused = await ev(`window.api.updateSettings({ jarvis: { model: 'opus & calc' } }).then(() => 'ok', (e) => String(e.message))`)
    t.check('...but not to something that is not a model name', /Invalid settings: jarvis/.test(refused), refused)

    const reset = await ev('window.api.resetJarvis()')
    t.check('"new conversation" replaces Jarvis with a fresh session', reset.id !== jarvis.id && reset.claudeSessionId !== jarvis.claudeSessionId && (await store()).data.sessions.filter((s) => s.role === 'jarvis').length === 1)

    for (const s of (await store()).data.sessions) await ev(`window.api.removeSession(${js(s.id)})`)
  } catch (error) {
    t.check('no unexpected error', false, String((error && error.stack) || error))
  } finally {
    if (app) app.kill()
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
