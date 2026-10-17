// Visual QA: builds realistic data in the real app and screenshots every UI state into scripts/visual/.
// Run: node scripts/e2e-visual.cjs   (then look at the PNGs; compare with reference/orca/docs/assets/readme-hero.jpg)
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, sleep, waitFor, launchApp } = require('./e2e-lib.cjs')

const OUT = path.join(ROOT, 'scripts', 'visual')
fs.mkdirSync(OUT, { recursive: true })
for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f))

let shotNo = 0
async function shot(app, name) {
  await sleep(500)
  const r = await app.send('Page.captureScreenshot', { format: 'png' })
  const file = `${String(++shotNo).padStart(2, '0')}-${name}.png`
  fs.writeFileSync(path.join(OUT, file), Buffer.from(r.result.data, 'base64'))
  console.log('saved', file)
}

/** Center of the first element matching `pick` (a JS expression returning an Element). */
async function centerOf(app, pick) {
  return app.evaluate(`(() => { const el = (${pick}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
}
async function mouse(app, type, x, y, button = 'left', clickCount = 1) {
  await app.send('Input.dispatchMouseEvent', { type, x, y, button, clickCount, buttons: button === 'left' ? 1 : 2 })
}
async function click(app, pick, label) {
  const c = await waitFor(() => centerOf(app, pick), 8000)
  if (!c) throw new Error(`target not found: ${label ?? pick}`)
  await mouse(app, 'mouseMoved', c.x, c.y, 'none', 0)
  await mouse(app, 'mousePressed', c.x, c.y)
  await mouse(app, 'mouseReleased', c.x, c.y)
  await sleep(350)
}
async function rightClick(app, pick, label) {
  const c = await waitFor(() => centerOf(app, pick), 8000)
  if (!c) throw new Error(`target not found: ${label ?? pick}`)
  await mouse(app, 'mouseMoved', c.x, c.y, 'none', 0)
  await mouse(app, 'mousePressed', c.x, c.y, 'right')
  await mouse(app, 'mouseReleased', c.x, c.y, 'right')
  await sleep(350)
}
async function press(app, key) {
  await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key })
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key })
  await sleep(300)
}
const byLabel = (l) => `document.querySelector('[aria-label="${l}"]')`
const byText = (sel, t) => `[...document.querySelectorAll('${sel}')].find((n) => n.innerText.trim().startsWith(${JSON.stringify(t)}))`

async function populated() {
  const app = await launchApp({ port: 9361 })
  const mk = (name, groupId, statusId) => app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: ${JSON.stringify(name)}, groupId: ${JSON.stringify(groupId)}, statusId: ${JSON.stringify(statusId)} })`)
  const work = await app.evaluate(`window.api.createGroup('Work')`)
  const personal = await app.evaluate(`window.api.createGroup('Personal')`)
  const a = await mk('api-server', work.id, 'working')
  const b = await mk('docs-site', work.id, 'review')
  const c = await mk('blog redesign', personal.id, 'todo')
  const d = await mk('old experiment', work.id, 'done')
  await mk('scratch notes', null, null)
  await app.evaluate(`window.api.closeSession(${JSON.stringify(d.id)})`)
  await sleep(1000)
  // Open three tabs; the last one clicked is active.
  for (const name of ['docs-site', 'blog redesign', 'api-server']) {
    await click(app, byText('[role="treeitem"]', name), `card ${name}`)
    await sleep(800)
  }
  console.log('waiting for claude to boot and attention to appear...')
  await sleep(12000)
  void a; void b; void c
  await shot(app, 'main')

  await click(app, byLabel('Open Hub'), 'Hub nav')
  await sleep(800)
  await shot(app, 'hub')
  await click(app, `[...document.querySelectorAll('[role="tab"]')].find((n) => n.innerText.includes('api-server'))`, 'api-server tab')

  await click(app, byLabel('Filter and group by'), 'filter button')
  await shot(app, 'filter-menu')
  await click(app, byText('[role="menuitemradio"], [role="menuitem"]', 'Status'), 'group by Status')
  await press(app, 'Escape')
  await shot(app, 'group-by-status')
  await click(app, byLabel('Filter and group by'), 'filter button')
  await click(app, byText('[role="menuitemradio"], [role="menuitem"]', 'Group'), 'group by Groups')
  await press(app, 'Escape')

  await click(app, byText('button', 'Closed'), 'Closed header')
  await shot(app, 'closed-expanded')

  await rightClick(app, byText('[role="treeitem"]', 'api-server'), 'card api-server')
  await shot(app, 'card-context-menu')
  await press(app, 'Escape')

  await rightClick(app, byText('button', 'Work'), 'group header')
  await shot(app, 'group-context-menu')
  await press(app, 'Escape')

  await click(app, byText('button', 'Search'), 'Search nav')
  await app.send('Input.insertText', { text: 'api' })
  await shot(app, 'search')
  await press(app, 'Escape')

  await click(app, byText('button', 'New session'), 'New session nav')
  await shot(app, 'new-session-dialog')
  await press(app, 'Escape')

  await click(app, byLabel('Edit statuses'), 'Statuses button')
  await shot(app, 'settings-statuses')
  await click(app, byText('[role="dialog"] button', 'Sound'), 'Settings Sound nav')
  await shot(app, 'settings-sound')
  await press(app, 'Escape')

  await click(app, byLabel('Hide sidebar'), 'Hide sidebar')
  await shot(app, 'sidebar-collapsed')
  app.kill()
}

async function empty() {
  const app = await launchApp({ port: 9362 })
  await sleep(2500)
  await shot(app, 'empty-state')
  app.kill()
}

;(async () => {
  try {
    await populated()
  } catch (e) {
    console.log('populated run FAILED:', e.message)
  }
  try {
    await empty()
  } catch (e) {
    console.log('empty run FAILED:', e.message)
  }
  console.log(`done, ${shotNo} screenshots in ${OUT}`)
  process.exit(0)
})()
