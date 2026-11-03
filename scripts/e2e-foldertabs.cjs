// E2E: the tab bar only shows open sessions from the active session's folder; a lone session stands alone.
const { ROOT, sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')
async function main() {
  const t = makeChecker()
  let app
  try {
    app = await launchApp({ port: 9374 })
    await sleep(1200)
    const other = require('node:os').tmpdir()
    const mk = (name, cwd) => app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(cwd)}, name: ${JSON.stringify(name)} })`)
    const a = await mk('same-one', ROOT)
    const b = await mk('same-two', ROOT)
    const c = await mk('lone-other', other)
    await sleep(1500)
    const tabs = () => app.evaluate(`[...document.querySelectorAll('[role=tab]')].map((n) => n.innerText.trim())`)
    const open = async (id) => { await app.evaluate(`window.api.setActiveSession(${JSON.stringify(id)})`); await sleep(500) }
    const click = (name) => app.evaluate(`[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes(${JSON.stringify(name)}))?.click()`)
    await click('same-one'); await click('same-two'); await sleep(800)
    let names = await tabs()
    t.check('same-folder sessions show together', names.length === 2 && names.some((n) => n.includes('same-one')) && names.some((n) => n.includes('same-two')), names.join(' | '))
    await click('lone-other'); await sleep(800)
    names = await tabs()
    t.check('a session alone in its folder shows as a single tab', names.length === 1 && names[0].includes('lone-other'), names.join(' | '))
    await click('same-one'); await sleep(800)
    names = await tabs()
    t.check('switching back brings the folder group back without the other folder', names.length === 2 && !names.some((n) => n.includes('lone-other')), names.join(' | '))
    // D55: only running, awake sessions keep a tab (the one on screen always does).
    await app.evaluate(`window.api.sleepSession(${JSON.stringify(b.id)})`)
    names = await waitFor(async () => { const n = await tabs(); return n.length === 1 ? n : null }, 15000, 300)
    t.check('a sleeping session of the folder loses its tab', !!names && names[0].includes('same-one'), String(names && names.join(' | ')))
    await click('same-two')
    names = await waitFor(async () => { const n = await tabs(); return n.length === 2 ? n : null }, 15000, 300)
    t.check('the session on screen keeps its tab, and waking it brings the tab back', !!names, String(names && names.join(' | ')))
    await app.evaluate(`window.api.closeSession(${JSON.stringify(a.id)})`)
    names = await waitFor(async () => { const n = await tabs(); return n.length === 1 && n[0].includes('same-two') ? n : null }, 15000, 300)
    t.check('a stopped session of the folder loses its tab', !!names, String(names && names.join(' | ')))
  } catch (e) {
    t.check('run completed without exception', false, String(e.message || e))
  } finally {
    if (app) app.kill()
    process.exit(t.summary() ? 1 : 0)
  }
}
main()
