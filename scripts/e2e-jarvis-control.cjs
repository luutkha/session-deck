// E2E (D55): Jarvis controls the whole app. Tools are called over the real MCP endpoint (exactly the way Claude calls
// them) and every check reads the real window or store: mode, views, grid, split, sidebar, side panel, dialogs, zoom,
// settings, queue, checklist, groups, statuses, presets, bulk actions, read/unread, cost report, undo.
// Uses Shell sessions only (no model, no quota). Run: node scripts/e2e-jarvis-control.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9473

async function main() {
  const t = makeChecker()
  const js = (value) => JSON.stringify(value)
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-jctl-'))
  let app
  try {
    app = await launchApp({ port: PORT })
    await sleep(1200)
    const ev = (expression) => app.evaluate(expression)
    const store = async () => (await ev('window.api.getStore()'))
    const byName = async (name) => (await store()).data.sessions.find((s) => s.name === name)
    const cfg = JSON.parse(fs.readFileSync(path.join(app.userData, 'jarvis', 'mcp.json'), 'utf8')).mcpServers.sessiondeck
    let rpcId = 0
    const rpc = async (method, params) => {
      const response = await fetch(cfg.url, { method: 'POST', headers: { ...cfg.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) })
      return response.json()
    }
    const tool = async (name, args = {}) => {
      const body = await rpc('tools/call', { name, arguments: args })
      return { text: body.result.content[0].text, error: body.result.isError === true }
    }
    const visiblePanes = () => ev('Array.from(document.querySelectorAll(".terminal-pane__viewport")).filter((v) => { const r = v.getBoundingClientRect(); return r.width > 0 && r.height > 0 }).length')

    const names = (await rpc('tools/list', {})).result.tools.map((x) => x.name)
    t.check('tools/list offers the D55 tools (95 in all with D58 + D60 + D74 + D86)', names.length === 95 && ['get_screen_state', 'set_grid', 'update_settings', 'bulk_action', 'queue_change'].every((n) => names.includes(n)), String(names.length))

    // Three shell sessions in one folder.
    for (const name of ['ctl one', 'ctl two', 'ctl three']) await tool('create_session', { folder, name, agent: 'shell' })
    await waitFor(async () => (await store()).runtime.filter((r) => r.run === 'running').length >= 3 || null, 15000, 300)
    await tool('open_session', { session: 'ctl one' })
    await sleep(800)

    // ---- screen state
    const state = await tool('get_screen_state')
    t.check('get_screen_state describes the window', !state.error && /Mode: Ops/.test(state.text) && /View: terminal/.test(state.text) && /On screen: "ctl one"/.test(state.text), state.text)

    // ---- views and the grid
    let r = await tool('set_view', { view: 'hub' })
    t.check('set_view hub shows the Hub board', !r.error && !!(await waitFor(() => ev('!!document.querySelector("[data-hub-board]") || null'), 5000, 200)), r.text)
    r = await tool('set_grid', { preset: '2x2', cells: ['ctl one', 'ctl two', null, 'ctl three'] })
    const gridShown = await waitFor(async () => (await ev('document.querySelector(\'[data-testid="grid-view"]\')?.getAttribute("data-grid-preset") ?? null')) === '2x2' && (await ev('document.querySelectorAll(\'[data-testid="grid-view"] [data-grid-cell] .terminal-pane__viewport\').length')) === 3 || null, 8000, 300)
    t.check('set_grid shows a 2x2 grid with three sessions in their cells', !r.error && !!gridShown, r.text)
    const cell4 = await ev(`document.querySelector('[data-grid-cell="3"] [aria-label="Choose the session for this cell"]')?.innerText ?? ''`)
    t.check('...in the order given (cell 4 = ctl three)', cell4.includes('ctl three'), cell4)
    r = await tool('set_view', { view: 'terminal' })
    t.check('set_view terminal leaves the grid', !r.error && !!(await waitFor(() => ev('!document.querySelector(\'[data-testid="grid-view"]\') || null'), 5000, 200)), r.text)

    // ---- split
    r = await tool('split_view', { how: 'right', session: 'ctl two' })
    t.check('split_view shows a second session beside the first', !r.error && !!(await waitFor(async () => (await visiblePanes()) === 2 || null, 5000, 200)), r.text)
    r = await tool('split_view', { how: 'unsplit' })
    t.check('split_view unsplit goes back to one pane', !r.error && !!(await waitFor(async () => (await visiblePanes()) === 1 || null, 5000, 200)), r.text)

    // ---- sidebar, side panel, dialogs, zoom
    r = await tool('show_sidebar', { open: false })
    t.check('show_sidebar hides the sidebar', !!(await waitFor(async () => (await ev('document.querySelector("aside").getBoundingClientRect().width')) < 2 || null, 5000, 200)), r.text)
    await tool('show_sidebar', { open: true })
    r = await tool('side_panel', { open: true, tab: 'queue', session: 'ctl one' })
    t.check('side_panel opens the side panel on the Queue tab', !r.error && !!(await waitFor(() => ev('document.querySelector("[data-side-tab=queue]")?.getAttribute("aria-selected") === "true" || null'), 5000, 200)), r.text)
    r = await tool('side_panel', { open: false })
    t.check('side_panel closes it', !!(await waitFor(() => ev('!document.querySelector("[data-side-tab]") || null'), 5000, 200)), r.text)
    r = await tool('open_dialog', { name: 'settings', page: 'quota' })
    t.check('open_dialog opens Settings', !r.error && !!(await waitFor(() => ev('[...document.querySelectorAll("[role=dialog]")].some((d) => d.innerText.includes("Settings")) || null'), 5000, 200)), r.text)
    r = await tool('open_dialog', { name: 'none' })
    t.check('open_dialog none closes it', !!(await waitFor(() => ev('document.querySelectorAll("[role=dialog]").length === 0 || null'), 5000, 200)), r.text)
    const zoomBefore = await ev('JSON.parse(localStorage.getItem("sessiondeck.termview.v1") || "{}").zoomPercent ?? 100')
    r = await tool('terminal_zoom', { action: 'in', steps: 2 })
    const zoomAfter = await waitFor(async () => { const z = await ev('JSON.parse(localStorage.getItem("sessiondeck.termview.v1") || "{}").zoomPercent ?? 100'); return z > zoomBefore ? z : null }, 5000, 200)
    t.check('terminal_zoom makes the terminal text bigger', !!zoomAfter, `${zoomBefore} -> ${zoomAfter} ${r.text}`)
    await tool('terminal_zoom', { action: 'reset' })

    // ---- mode
    r = await tool('switch_mode', { mode: 'code' })
    t.check('switch_mode code switches the window to Code mode', !r.error && !!(await waitFor(() => ev('document.querySelector("[data-ui-mode]")?.getAttribute("data-ui-mode") === "code" || null'), 5000, 200)), r.text)
    r = await tool('set_grid', { cells: ['ctl one'] })
    t.check('a screen tool on an Ops session switches back to Ops by itself', !r.error && !!(await waitFor(() => ev('document.querySelector("[data-ui-mode]")?.getAttribute("data-ui-mode") === "ops" || null'), 5000, 200)), r.text)
    await tool('set_view', { view: 'terminal' })

    // ---- settings, with undo
    const before = JSON.parse((await tool('get_settings', { section: 'hub' })).text)
    const key = Object.keys(before).find((k) => typeof before[k] === 'boolean')
    r = await tool('update_settings', { changes: { hub: { [key]: !before[key] } } })
    t.check('update_settings saves a change in the real store', !r.error && (await store()).data.settings?.hub?.[key] === !before[key], r.text)
    r = await tool('update_settings', { changes: { hub: { [key]: 'not a boolean' } } })
    t.check('...and refuses an invalid value like the Settings dialog does', r.error, r.text)
    await tool('undo_last_action')
    t.check('undo puts the old value back', (await store()).data.settings?.hub?.[key] === before[key])

    // ---- queue and checklist (a sleeping session keeps its queue)
    await tool('sleep_session', { session: 'ctl three' })
    await tool('queue_change', { session: 'ctl three', action: 'add', text: 'echo LATER_ONE' })
    await tool('queue_change', { session: 'ctl three', action: 'add', text: 'echo LATER_ZERO', position: 1 })
    t.check('queue_change adds at a position', js((await byName('ctl three')).queue?.map((q) => q.text)) === js(['echo LATER_ZERO', 'echo LATER_ONE']))
    await tool('queue_change', { session: 'ctl three', action: 'move', item: 1, to: 2 })
    t.check('queue_change moves an item', (await byName('ctl three')).queue?.[1]?.text === 'echo LATER_ZERO')
    await tool('queue_change', { session: 'ctl three', action: 'clear' })
    t.check('queue_change clears the queue', ((await byName('ctl three')).queue ?? []).length === 0)
    await tool('checklist_change', { session: 'ctl one', action: 'add', items: ['step A', 'step B'] })
    await tool('checklist_change', { session: 'ctl one', action: 'check', item: 'step B' })
    const list = (await byName('ctl one')).checklist ?? []
    t.check('checklist_change adds and checks steps', list.length === 2 && list[1].done === true && list[0].done === false, js(list))

    // ---- groups, statuses, presets
    await tool('create_group', { name: 'Ctl group' })
    await tool('group_change', { action: 'rename', group: 'Ctl group', name: 'Ctl renamed' })
    t.check('group_change renames a group', (await store()).data.groups.some((g) => g.name === 'Ctl renamed'))
    await tool('status_change', { action: 'create', name: 'Ctl status', color: '#22aa66' })
    t.check('status_change creates a status', (await store()).data.statuses.some((s) => s.name === 'Ctl status' && s.color === '#22aa66'))
    r = await tool('status_change', { action: 'create', name: 'Bad', color: 'red' })
    t.check('...and refuses a bad colour (same validation as the app)', r.error, r.text)
    await tool('preset_change', { action: 'save', name: 'ctl preset', folder, agent: 'shell', group: 'Ctl renamed' })
    t.check('preset_change saves a preset', ((await store()).data.presets ?? []).some((p) => p.name === 'ctl preset' && p.agent === 'shell'))

    // ---- bulk action, read/unread, needs you
    r = await tool('bulk_action', { action: 'move_to_group', value: 'Ctl renamed', sessions: ['ctl one', 'ctl two'] })
    const grp = (await store()).data.groups.find((g) => g.name === 'Ctl renamed')
    t.check('bulk_action moves several sessions', !r.error && (await byName('ctl one')).groupId === grp.id && (await byName('ctl two')).groupId === grp.id, r.text)
    r = await tool('bulk_action', { action: 'set_status', value: 'Ctl status', group: 'Ctl renamed' })
    const st = (await store()).data.statuses.find((s) => s.name === 'Ctl status')
    t.check('bulk_action by group sets the status of the group\'s sessions', (await byName('ctl one')).statusId === st.id && (await byName('ctl two')).statusId === st.id, r.text)
    await tool('set_read', { session: 'ctl two', read: false })
    const needs = await tool('needs_you')
    t.check('set_read unread flags a session and needs_you lists it', /"ctl two": marked unread/.test(needs.text), needs.text)

    // ---- reports
    const cost = await tool('cost_report', { days: 3 })
    t.check('cost_report answers with three days', !cost.error && (cost.text.match(/\d{4}-\d\d-\d\d: \$/g) ?? []).length === 3, cost.text)
    const workers = await tool('list_workers')
    t.check('list_workers answers', !workers.error && /No workers/.test(workers.text), workers.text)
    // A removal asks the user in the app; Cancel keeps everything.
    const removal = tool('status_change', { action: 'remove', status: 'Ctl status' })
    const asked = await waitFor(() => ev('!!document.querySelector("[role=alertdialog]") || null'), 8000, 200)
    await ev('[...document.querySelectorAll("[role=alertdialog] button")].find((b) => b.innerText.trim() === "Cancel")?.click()')
    const answered = await removal
    t.check('status_change remove asks Yes/No; Cancel keeps the status', !!asked && /did not allow/.test(answered.text) && (await store()).data.statuses.some((s) => s.name === 'Ctl status'), answered.text)
  } catch (error) {
    t.check('run completed without exception', false, String(error && error.stack || error))
  } finally {
    if (app) app.kill()
    await sleep(500)
    try { fs.rmSync(folder, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }) } catch { /* a shell or the app may still hold the folder: leave it to the OS temp cleanup */ }
  }
  process.exit(t.summary() ? 1 : 0)
}

main()
