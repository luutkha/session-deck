// E2E: an unsent checklist step survives switching to another session and back. No claude turn is sent.
const { ROOT, sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')
const centerOf = (app, pick) =>
  app.evaluate(`(() => { const el = (${pick}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
async function click(app, pick, label) {
  const c = await waitFor(() => centerOf(app, pick), 8000)
  if (!c) throw new Error(`target not found: ${label}`)
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
    await app.send('Input.dispatchMouseEvent', { type, x: c.x, y: c.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: 1, clickCount: 1 })
  await sleep(400)
}
const card = (n) => `[...document.querySelectorAll('[role="treeitem"]')].find((x) => x.innerText.includes('${n}'))`
const input = `document.querySelector('input[placeholder="Add a step and press Enter"]')`
async function main() {
  const t = makeChecker()
  let app
  try {
    app = await launchApp({ port: 9373 })
    await sleep(1200)
    await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'draft-one' })`)
    await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'draft-two' })`)
    await sleep(1500)
    await click(app, card('draft-one'), 'draft-one')
    await click(app, `document.querySelector('[aria-label="Notes and checklist"]')`, 'notes toggle')
    await click(app, input, 'input')
    await app.send('Input.insertText', { text: 'half typed step' })
    await sleep(300)
    await click(app, card('draft-two'), 'draft-two')
    t.check('the other session starts with an empty input', (await app.evaluate(`${input}?.value`)) === '')
    await click(app, card('draft-one'), 'draft-one again')
    const back = await waitFor(async () => (await app.evaluate(`${input}?.value`)) === 'half typed step', 4000)
    t.check('the unsent step is still there after switching back', !!back)

    // Add button, Save button, checkbox insert
    const btn = (label) => `document.querySelector('[aria-label="${label}"]')`
    const store = () => app.evaluate('window.api.getStore()')
    const sid = (await store()).data.sessions.find((x) => x.name === 'draft-one').id
    const stepsOf = async () => (await store()).data.sessions.find((x) => x.id === sid)?.checklist?.map((i) => i.text) || []
    t.check('Add step button is enabled once a step is typed', (await app.evaluate(`${btn('Add step')}.disabled`)) === false)
    await click(app, btn('Add step'), 'add step (still has draft)')
    t.check('the Add step button adds the typed step', !!(await waitFor(async () => (await stepsOf()).includes('half typed step'), 5000)))
    await click(app, input, 'input again')
    await app.send('Input.insertText', { text: '- [ ] via save button' })
    t.check('panel shows Save while a step is unsent', /Save/.test(await app.evaluate(`${btn('Save notes and checklist')}.innerText`)))
    await click(app, btn('Save notes and checklist'), 'save')
    t.check('Save adds the unsent step (checkbox prefix stripped)', !!(await waitFor(async () => (await stepsOf()).includes('via save button'), 5000)))
    t.check('after saving the panel reads Saved', !!(await waitFor(async () => /Saved/.test(await app.evaluate(`${btn('Save notes and checklist')}.innerText`)), 4000)))
    await click(app, `document.querySelector('textarea[aria-label="Session notes"]')`, 'notes')
    await click(app, btn('Insert checkbox'), 'checkbox')
    await app.send('Input.insertText', { text: 'buy milk' })
    const notesOk = await waitFor(async () => (await store()).data.sessions.find((x) => x.id === sid)?.notes === '- [ ] buy milk', 6000)
    t.check('Checkbox button inserts "- [ ] " and the note autosaves', !!notesOk)
  } catch (e) {
    t.check('run completed without exception', false, String(e.message || e))
  } finally {
    if (app) app.kill()
    process.exit(t.summary() ? 1 : 0)
  }
}
main()
