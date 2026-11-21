// E2E (D71): Jarvis can tune the app to the PC it runs on. Over Jarvis's own MCP endpoint (the way a real Jarvis calls it):
// get_system_info reads the PC, terminal_settings / gpu_setting / sidebar_width / jarvis_panel_settings change settings and the
// real window follows (localStorage, live DOM, gpu-mode.json), update_settings takes status NAMES for the auto-status mapping,
// and get_screen_state reports the sidebar width. No model is involved: the tools are called directly.
// Run: npx electron-vite build && node scripts/e2e-jarvis-tuning.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9503

async function main() {
  const t = makeChecker()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-tuning-'))
  const userData = path.join(root, 'userdata')
  fs.mkdirSync(userData)
  let app
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    const ev = (expr) => app.evaluate(expr)
    const cfgFile = path.join(userData, 'jarvis', 'mcp.json')
    await waitFor(() => (fs.existsSync(cfgFile) ? true : null), 20000, 300)
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')).mcpServers.sessiondeck
    let rpcId = 0
    const rpc = async (method, params) => (await fetch(cfg.url, { method: 'POST', headers: { ...cfg.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) })).json()
    const tool = async (name, args = {}) => {
      const body = await rpc('tools/call', { name, arguments: args })
      return { text: body.result.content[0].text, error: body.result.isError === true }
    }
    const ls = (key) => ev(`localStorage.getItem(${JSON.stringify(key)})`)
    // The sidebar's width animates for 200 ms: read it after the animation.
    const asideWidth = async () => {
      await sleep(450)
      return ev('Math.round(document.querySelector("aside").getBoundingClientRect().width)')
    }

    // ---- the tools exist
    const names = (await rpc('tools/list', {})).result.tools.map((x) => x.name)
    const added = ['get_system_info', 'gpu_setting', 'terminal_settings', 'sidebar_width', 'jarvis_panel_settings']
    t.check('tools/list offers the five tuning tools (87 in all)', names.length === 87 && added.every((n) => names.includes(n)), `${names.length} missing: ${added.filter((n) => !names.includes(n))}`)

    // ---- Jarvis reads the PC
    const info = await tool('get_system_info')
    t.check('get_system_info reports CPU, memory, displays, GPU, load and tuning hints', !info.error && ['PC:', 'CPU:', 'Memory:', 'Displays:', 'GPU:', 'App load:', 'Tuning hints'].every((k) => info.text.includes(k)), info.text.slice(0, 400))
    const cores = Number((/\((\d+) logical cores\)/.exec(info.text) ?? [])[1])
    t.check('the core count is this PC\'s', cores === os.cpus().length, `${cores} vs ${os.cpus().length}`)
    t.check('the RAM figure is this PC\'s (within 0.2 GB)', Math.abs(Number((/Memory: ([\d.]+) GB total/.exec(info.text) ?? [])[1]) - os.totalmem() / 2 ** 30) < 0.2, info.text.split('\n')[2])

    // ---- terminal preferences: stored and applied live
    const term = await tool('terminal_settings', { renderer: 'dom', effects: 'reduced', scrollback_lines: 5000, zoom_percent: 110, right_click: 'copy-paste' })
    t.check('terminal_settings answers with the new values', !term.error && /renderer: dom/i.test(term.text) && /effects: reduced/i.test(term.text) && /5000 lines/.test(term.text) && /110%/.test(term.text) && /copy-paste/.test(term.text), term.text)
    t.check('the renderer and effects preferences are stored', (await ls('sessiondeck.renderer.v1')) === 'dom' && (await ls('sessiondeck.effects.v1')) === 'reduced', `${await ls('sessiondeck.renderer.v1')} ${await ls('sessiondeck.effects.v1')}`)
    t.check('reduced effects apply to the window at once', (await ev('document.documentElement.dataset.reduceEffects')) === 'true')
    const view = JSON.parse((await ls('sessiondeck.termview.v1')) ?? '{}')
    t.check('zoom and scrollback are stored', view.zoomPercent === 110 && view.scrollbackLines === 5000, JSON.stringify(view))
    t.check('right-click is "copy / paste"', (await ls('sessiondeck.rightclick.v1')) === 'paste', String(await ls('sessiondeck.rightclick.v1')))
    const clamped = await tool('terminal_settings', { scrollback_lines: 100 })
    t.check('a scrollback below the limit is refused with the limits named', clamped.error || /1000/.test(clamped.text), clamped.text)
    const bad = await tool('terminal_settings', { renderer: 'fast' })
    t.check('an unknown renderer is refused in plain words', bad.error && /auto, webgl, canvas|dom/i.test(bad.text), bad.text)
    await tool('terminal_settings', { renderer: 'auto', effects: 'auto', right_click: 'menu', zoom_percent: 100, scrollback_lines: 10000 })

    // ---- GPU acceleration (main, applies at the next start)
    const gpu = await tool('gpu_setting', { pref: 'off' })
    const modeFile = path.join(userData, 'gpu-mode.json')
    const saved = fs.existsSync(modeFile) ? JSON.parse(fs.readFileSync(modeFile, 'utf8')) : null
    t.check('gpu_setting off is saved for the next start and says so', !gpu.error && saved?.pref === 'off' && /restart/i.test(gpu.text), `${gpu.text.slice(0, 120)} ${JSON.stringify(saved)}`)
    t.check('the Settings dialog\'s reading agrees', (await ev('window.api.getGpuInfo()')).pref === 'off')
    const gpuBad = await tool('gpu_setting', { pref: 'maybe' })
    t.check('an unknown GPU value is refused', gpuBad.error, gpuBad.text)
    await tool('gpu_setting', { pref: 'auto' })

    // ---- sidebar width
    await tool('sidebar_width', { width: 420 })
    t.check('sidebar_width 420 makes the sidebar 420px wide', (await asideWidth()) === 420, String(await asideWidth()))
    t.check('...and it is saved', (await ls('sessiondeck.sidebarWidth.v1')) === '420')
    const state = await tool('get_screen_state')
    t.check('get_screen_state reports the sidebar width', /Sidebar: shown, 420px wide/.test(state.text), state.text.split('\n').filter((l) => l.startsWith('Sidebar')).join())
    const wide = await tool('sidebar_width', { width: 5000 })
    t.check('a too-wide request is refused naming the limits', wide.error && /220/.test(wide.text) && /640/.test(wide.text), wide.text)
    const rep = await tool('sidebar_width')
    t.check('with no arguments it reports the width', /420px/.test(rep.text), rep.text)
    await tool('sidebar_width', { reset: true })
    t.check('reset goes back to 300px', (await asideWidth()) === 300, String(await asideWidth()))

    // ---- Jarvis panel
    const panel = await tool('jarvis_panel_settings', { panel_width: 400, read_aloud: true })
    t.check('jarvis_panel_settings stores the width and read-aloud', !panel.error && (await ls('sessiondeck.jarvis.width.v1')) === '400' && (await ls('sessiondeck.jarvis.speak.v1')) === '1', panel.text)
    await tool('jarvis_panel_settings', { read_aloud: false, reset_panel_width: true })
    t.check('...and turns them off / back', (await ls('sessiondeck.jarvis.speak.v1')) === '0' || (await ls('sessiondeck.jarvis.speak.v1')) === null)

    // ---- auto-status mapping by status NAME
    const store = await ev('window.api.getStore()')
    const target = store.data.statuses[store.data.statuses.length - 1]
    const out = await tool('update_settings', { changes: { autoStatus: { finished: target.name } } })
    const after = (await ev('window.api.getStore()')).data.settings?.autoStatus
    t.check('update_settings accepts a status name for autoStatus.finished (stored as its id)', !out.error && after?.finished === target.id, `${out.text.slice(0, 160)} -> ${JSON.stringify(after)}`)
    const missing = await tool('update_settings', { changes: { autoStatus: { finished: 'No such status' } } })
    t.check('an unknown status name is refused', missing.error, missing.text.slice(0, 160))
  } catch (error) {
    t.check('jarvis-tuning e2e ran without an exception', false, String(error))
  } finally {
    if (app) app.kill()
    await sleep(500)
    fs.rmSync(root, { recursive: true, force: true })
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
