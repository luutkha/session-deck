// E2E (D88): move an Ops session into a Code-mode worktree, in the built app with a real git repo.
// Shell sessions only (no model, no quota). Checks: the palette offers "Move to Code mode: repo / worktree" for the
// session on screen, running it moves the SAME card (name and notes kept, left its Ops group, folder = the worktree),
// the shell really restarts inside the worktree, the app switches to Code mode, the session is listed under its worktree,
// and a repeat or an unknown worktree is refused. Run: node scripts/e2e-move-to-code.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { sleep, waitFor, strip, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9517
const CTRL = 2
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args], { cwd, encoding: 'utf8' }).trim()

async function main() {
  const t = makeChecker()
  const js = (value) => JSON.stringify(value)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-m2c-'))
  const userData = path.join(root, 'userdata')
  const worktreesRoot = path.join(root, 'wt')
  fs.mkdirSync(userData)
  const repo = path.join(root, 'shop')
  fs.mkdirSync(repo)
  git(root, 'init', '-q', '-b', 'main', repo)
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  const opsDir = path.join(root, 'notes')
  fs.mkdirSync(opsDir)
  let app
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1200)
    const ev = (expr) => app.evaluate(expr)
    const store = async () => (await ev('window.api.getStore()')).data
    const key = async (k, code, vk, modifiers = 0) => {
      await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers })
      await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers })
    }
    const items = () => ev('[...document.querySelectorAll("[cmdk-item]")].map((n) => n.innerText.replace(/\\s+/g, " ").trim())')

    await ev(`window.api.updateSettings({ code: { worktreesRoot: ${js(worktreesRoot)} } })`)
    const addedRepo = await ev(`window.api.addRepo(${js(repo)})`)
    const made = await ev(`window.api.createWorktree({ repoId: ${js(addedRepo.id)}, name: 'target', baseBranch: 'main', agent: 'shell' })`)
    const worktree = made.worktree
    const group = await ev(`window.api.createGroup('Work')`)
    const session = await ev(`window.api.createSession({ cwd: ${js(opsDir)}, name: 'Keep me', agent: 'shell', groupId: ${js(group.id)} })`)
    await ev(`window.api.setSessionNotes(${js(session.id)}, 'my notes')`).catch(() => undefined)
    await sleep(800)
    await ev(`document.querySelector('[data-session-card=${js(session.id)}]')?.click()`)
    await sleep(1500)

    // ---- 1. the palette offers the move for the session on screen
    await ev('document.activeElement && document.activeElement.blur(); true')
    await key('k', 'KeyK', 75, CTRL)
    await waitFor(() => ev('!!document.querySelector("[cmdk-input]") || null'), 3000, 100)
    await app.send('Input.insertText', { text: 'shop / target' })
    await sleep(400)
    const offered = await items()
    t.check('the palette offers "Move to Code mode: shop / target" for an Ops session', offered.some((i) => i.includes('Move to Code mode: shop / target')), offered.join(' | '))

    // ---- 2. running it moves the same card
    await key('Enter', 'Enter', 13)
    const moved = await waitFor(async () => {
      const s = (await store()).sessions.find((x) => x.id === session.id)
      return s && s.worktreeId === worktree.id ? s : null
    }, 8000, 200)
    t.check('the same session now belongs to the worktree', !!moved, js(moved))
    t.check('its folder is the worktree folder and it left its Ops group', !!moved && path.resolve(moved.cwd).toLowerCase() === path.resolve(worktree.path).toLowerCase() && moved.groupId === null, js(moved && { cwd: moved.cwd, groupId: moved.groupId }))
    t.check('name kept, id kept', !!moved && moved.name === 'Keep me' && moved.id === session.id)
    t.check('the app switched to Code mode', !!(await waitFor(() => ev('document.querySelector("[data-ui-mode]")?.dataset.uiMode === "code" || null'), 5000, 200)))
    t.check('the Code sidebar lists the session under its worktree', !!(await waitFor(() => ev(`!!document.querySelector('[data-worktree-id="${worktree.id}"]') && document.body.innerText.includes('Keep me') || null`), 5000, 200)))

    // ---- 3. the shell really restarted in the new folder
    // PowerShell drops keystrokes typed while it starts: wait for its prompt, then ask for the folder (long form: the temp path may be 8.3).
    const longWt = fs.realpathSync.native(worktree.path).toLowerCase()
    await waitFor(async () => /PS [^\n]*target>\s*$/.test(strip((await ev(`window.api.ptyReplay(${js(session.id)})`)).data)) || null, 30000, 400)
    await ev(`window.api.ptyWrite(${js(session.id)}, 'Write-Output ("cwd=" + (Get-Location).Path)\\r')`)
    let tail = ''
    const shown = await waitFor(async () => {
      tail = strip((await ev(`window.api.ptyReplay(${js(session.id)})`)).data)
      return tail.toLowerCase().includes('cwd=' + longWt) || null
    }, 25000, 500)
    t.check('the shell prints the worktree folder as its working directory', !!shown, JSON.stringify(tail.slice(-200)))
    const run = (await ev('window.api.getStore()')).runtime.find((r) => r.sessionId === session.id)
    t.check('it is running (not stopped, not sleeping)', run?.run === 'running' && run?.sleeping !== true, js(run))

    // ---- 4. refusals change nothing
    const before = js((await store()).sessions.find((x) => x.id === session.id))
    const again = await ev(`window.api.moveSessionToCode(${js(session.id)}, ${js(worktree.id)}).then(() => 'ok', (e) => String(e && e.message || e))`)
    const unknown = await ev(`window.api.moveSessionToCode(${js(session.id)}, 'nope').then(() => 'ok', (e) => String(e && e.message || e))`)
    t.check('moving again into the same worktree is refused', again.includes('already in this worktree'), again)
    t.check('an unknown worktree is refused', unknown.includes('Worktree not found'), unknown)
    t.check('refusals left the session as it was', js((await store()).sessions.find((x) => x.id === session.id)) === before)

    // ---- 5. a session already in Code gets no move items
    await ev('document.activeElement && document.activeElement.blur(); true')
    await key('k', 'KeyK', 75, CTRL)
    await waitFor(() => ev('!!document.querySelector("[cmdk-input]") || null'), 3000, 100)
    await app.send('Input.insertText', { text: 'Move to Code' })
    await sleep(400)
    const none = await items()
    t.check('a worktree session is not offered the move', !none.some((i) => i.includes('Move to Code mode')), none.join(' | '))
    await key('Escape', 'Escape', 27)

    // ---- 6. Jarvis does it too (MCP tool move_session_to_code, the user confirms in the app)
    const cfg = JSON.parse(fs.readFileSync(path.join(app.userData, 'jarvis', 'mcp.json'), 'utf8')).mcpServers.sessiondeck
    let rpcId = 0
    const tool = async (name, args = {}) => {
      const response = await fetch(cfg.url, { method: 'POST', headers: { ...cfg.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) })
      const body = await response.json()
      return { text: body.result.content[0].text, error: body.result.isError === true }
    }
    const second = await ev(`window.api.createSession({ cwd: ${js(opsDir)}, name: 'Jarvis moves me', agent: 'shell' })`)
    await sleep(800)
    const declined = tool('move_session_to_code', { session: 'jarvis moves me', worktree: 'target' })
    const dialog = await waitFor(() => ev(`document.querySelector('[role=alertdialog]')?.innerText ?? null`), 8000, 200)
    t.check('Jarvis asks the user before moving', !!dialog && dialog.includes('Jarvis wants to move'), String(dialog))
    await ev(`[...document.querySelectorAll('[role=alertdialog] button')].find((b) => b.innerText.trim() === 'Cancel')?.click()`)
    t.check('Cancel = declined, session still in Ops', /declined/.test((await declined).text) && (await store()).sessions.find((x) => x.id === second.id)?.worktreeId === undefined)
    const accepted = tool('move_session_to_code', { session: 'jarvis moves me', worktree: 'target' })
    await waitFor(() => ev(`!!document.querySelector('[role=alertdialog]') || null`), 8000, 200)
    await ev(`[...document.querySelectorAll('[role=alertdialog] button')].find((b) => b.innerText.trim() === 'Move')?.click()`)
    const done = await accepted
    t.check('Move = the session joins the worktree', /^Moved "Jarvis moves me"/.test(done.text) && (await store()).sessions.find((x) => x.id === second.id)?.worktreeId === worktree.id, done.text)
    const again2 = await tool('move_session_to_code', { session: 'jarvis moves me', worktree: 'target' })
    t.check('a Code session is refused without asking', again2.error && /already a Code session/.test(again2.text), again2.text)

    // ---- 7. Jarvis's undo puts the session back in its old folder (Ops, not grouped), on a fresh conversation
    const undone = await tool('undo_last_action', {})
    const afterUndo = (await store()).sessions.find((x) => x.id === second.id)
    t.check('undo_last_action moves it back to its old folder in Ops', !undone.error && afterUndo?.worktreeId === undefined && path.resolve(afterUndo?.cwd ?? '').toLowerCase() === path.resolve(opsDir).toLowerCase(), undone.text + ' ' + js(afterUndo && { cwd: afterUndo.cwd, wt: afterUndo.worktreeId }))

    // ---- 8. "Move to Code mode: new worktree…": the New worktree dialog, and the session moves in (no extra session)
    await ev(`document.querySelector('[data-mode-switch] [data-mode="ops"]')?.click()`)
    await waitFor(() => ev('document.querySelector("[data-ui-mode]")?.dataset.uiMode === "ops" || null'), 5000, 200)
    await ev(`document.querySelector('[data-session-card=${js(second.id)}]')?.click()`)
    await sleep(1200)
    const sessionsBefore = (await store()).sessions.length
    await ev('document.activeElement && document.activeElement.blur(); true')
    await key('k', 'KeyK', 75, CTRL)
    await waitFor(() => ev('!!document.querySelector("[cmdk-input]") || null'), 3000, 100)
    await app.send('Input.insertText', { text: 'new worktree' })
    await sleep(400)
    const newItems = await items()
    t.check('the palette offers "Move to Code mode: new worktree…"', newItems.some((i) => i.includes('Move to Code mode: new worktree')), newItems.join(' | '))
    await key('Enter', 'Enter', 13)
    const dialogOpen = await waitFor(() => ev('!!document.querySelector("[data-testid=new-worktree-dialog]") || null'), 5000, 200)
    t.check('the New worktree dialog opens in Ops', !!dialogOpen)
    await waitFor(() => ev('!document.querySelector("[data-testid=new-worktree-dialog] button[type=submit]")?.disabled || document.querySelector("input[name=worktree-name]") !== null || null'), 5000, 200)
    t.check('it says the session moves in and has no agent picker', await ev('!!document.querySelector("[data-testid=new-worktree-move-note]") && !document.querySelector("[data-testid=new-worktree-dialog] [aria-label=Agent]")'))
    await ev('document.querySelector("input[name=worktree-name]").focus()')
    await app.send('Input.insertText', { text: 'second target' })
    await waitFor(() => ev('!document.querySelector("[data-testid=new-worktree-dialog] button[type=submit]").disabled || null'), 15000, 200)
    await ev('document.querySelector("[data-testid=new-worktree-dialog] button[type=submit]").click()')
    const movedNew = await waitFor(async () => {
      const d = await store()
      const w = (d.worktrees ?? []).find((x) => x.name === 'second target')
      const s = d.sessions.find((x) => x.id === second.id)
      return w && s?.worktreeId === w.id ? { w, count: d.sessions.length } : null
    }, 20000, 300)
    t.check('the session moved into the NEW worktree', !!movedNew)
    t.check('and no extra first session was started', !!movedNew && movedNew.count === sessionsBefore, `${sessionsBefore} -> ${movedNew?.count}`)

    // ---- 9. right-click "Move to Code mode…" on an Ops card opens the same dialog (D88 follow-up)
    await ev(`document.querySelector('[data-mode-switch] [data-mode="ops"]')?.click()`)
    await waitFor(() => ev('document.querySelector("[data-ui-mode]")?.dataset.uiMode === "ops" || null'), 5000, 200)
    const third = await ev(`window.api.createSession({ cwd: ${js(opsDir)}, name: 'Right click me', agent: 'shell' })`)
    const card = `[data-session-card=${js(third.id)}]`
    await waitFor(() => ev(`!!document.querySelector(${js(card)}) || null`), 5000, 200)
    const rightClick = (sel) => ev(`(() => { const el = document.querySelector(${js(sel)}); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 10, button: 2 })); return true })()`)
    await rightClick(card)
    const menuItem = await waitFor(() => ev('!!document.querySelector("[data-move-to-code]") || null'), 3000, 100)
    t.check('the Ops card menu has "Move to Code mode…"', !!menuItem)
    await ev('document.querySelector("[data-move-to-code]")?.click()')
    t.check('choosing it opens the New worktree dialog for that session', !!(await waitFor(() => ev('(!!document.querySelector("[data-testid=new-worktree-dialog]") && !!document.querySelector("[data-testid=new-worktree-move-note]")) || null'), 5000, 200)))
    await key('Escape', 'Escape', 27)
    await sleep(500)
    // a Code session's card has no such item
    await ev(`document.querySelector('[data-mode-switch] [data-mode="code"]')?.click()`)
    await waitFor(() => ev('document.querySelector("[data-ui-mode]")?.dataset.uiMode === "code" || null'), 5000, 200)
    await ev(`document.querySelector('[data-session-card=${js(second.id)}]')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))`)
    await sleep(500)
    t.check('a Code session menu has no "Move to Code mode…"', !(await ev('!!document.querySelector("[data-move-to-code]")')))
  } catch (error) {
    t.check('run completed without exception', false, String(error && error.stack || error))
  } finally {
    if (app) app.kill()
    await sleep(800)
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* a shell may still hold a folder */ }
  }
  process.exit(t.summary() ? 1 : 0)
}

main()
