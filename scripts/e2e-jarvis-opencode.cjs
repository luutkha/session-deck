// E2E (D54) with a REAL OpenCode: Jarvis runs on OpenCode with a FREE model and controls the app through the same
// tool server. Settings > Agents "Jarvis engine" = OpenCode. Uses a temp profile; no Claude quota is used.
// Run: node scripts/e2e-jarvis-opencode.cjs   (JARVIS_OC_MODEL=<provider/model> to pick another model)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, strip, waitFor, makeChecker, launchApp, stopOpencodeService } = require('./e2e-lib.cjs')

const PORT = 9464
const MODEL = process.env.JARVIS_OC_MODEL || 'opencode/deepseek-v4.1-flash-free'

async function main() {
  const t = makeChecker()
  const js = (value) => JSON.stringify(value)
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-jarvis-oc-'))
  let app
  try {
    stopOpencodeService()
    app = await launchApp({ port: PORT })
    await sleep(1200)
    const ev = (expression) => app.evaluate(expression)
    const store = async () => ev('window.api.getStore()')
    const byName = async (name) => (await store()).data.sessions.find((s) => s.name === name)

    const saved = await ev(`window.api.updateSettings({ jarvis: { agent: 'opencode', opencodeModel: ${js(MODEL)} } }).then((s) => s.jarvis)`)
    t.check('Settings: Jarvis engine = OpenCode with a free model', saved.agent === 'opencode' && saved.opencodeModel === MODEL, js(saved))

    const jarvis = await ev('window.api.openJarvis()')
    t.check('Jarvis is created on OpenCode with that model', jarvis.role === 'jarvis' && jarvis.agent === 'opencode' && jarvis.model === MODEL, js(jarvis))
    const ready = await waitFor(async () => {
      const s = strip((await ev(`window.api.ptyReplay(${js(jarvis.id)})`)).data)
      return s.length > 200 ? s : null
    }, 60000, 1000)
    t.check('the OpenCode TUI starts', !!ready)
    await sleep(6000)

    const ask = `Use your sessiondeck tools: create a shell session named "oc demo" in the folder ${folder}. Then reply done.`
    await ev(`window.api.ptyWrite(${js(jarvis.id)}, ${js(ask)})`)
    await sleep(700)
    await ev(`window.api.ptyWrite(${js(jarvis.id)}, '\\r')`)
    const demo = await waitFor(async () => (await byName('oc demo')) ?? null, 240000, 2000)
    t.check('OpenCode Jarvis calls the tool server: "oc demo" exists', !!demo && demo.cwd === folder && demo.agent === 'shell',
      demo ? '' : strip((await ev(`window.api.ptyReplay(${js(jarvis.id)})`)).data).slice(-1500))

    const back = await ev(`window.api.updateSettings({ jarvis: { agent: 'claude' } }).then(() => window.api.openJarvis())`)
    t.check('switching the engine back gives a new Claude Jarvis (one Jarvis only)', (back.agent ?? 'claude') === 'claude' && back.id !== jarvis.id &&
      (await store()).data.sessions.filter((s) => s.role === 'jarvis').length === 1, js(back) + ' jarvis count ' + (await store()).data.sessions.filter((s) => s.role === 'jarvis').length)

    for (const s of (await store()).data.sessions) await ev(`window.api.removeSession(${js(s.id)})`)
  } catch (error) {
    t.check('no unexpected error', false, String((error && error.stack) || error))
  } finally {
    if (app) app.kill()
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
