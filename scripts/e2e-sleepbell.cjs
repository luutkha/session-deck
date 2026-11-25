// E2E (D27): putting a session to sleep keeps its attention bell. A background session finishes (real Stop hook),
// is put to sleep, and still shows its bell on the card, the tab and in the header count; opening it wakes it and
// clears the bell. Run: node scripts/e2e-sleepbell.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

async function main() {
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-sleepbell-'))
  const endpointFile = path.join(root, 'endpoint.json')
  process.env.SESSIONDECK_E2E_ENDPOINT_FILE = endpointFile
  try {
    const proj = path.join(root, 'proj')
    fs.mkdirSync(proj)
    app = await launchApp({ port: 9398 })
    await sleep(1200)
    const js = (value) => JSON.stringify(value)
    const mk = (name) => app.evaluate(`window.api.createSession({ cwd: ${js(proj)}, name: ${js(name)} })`)
    const a = await mk('front-a')
    const b = await mk('sleepy-b')
    await sleep(1500)
    const endpoint = JSON.parse(fs.readFileSync(endpointFile, 'utf8'))

    const card = (name) => `[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes(${js(name)}))`
    const clickCard = (name) => app.evaluate(`${card(name)}?.click()`)
    const cardBell = (name) => app.evaluate(`${card(name)}?.querySelector('[data-attention-bell]')?.getAttribute('data-attention-bell') ?? null`)
    const headerCount = () => app.evaluate(`Number(document.querySelector('[data-needs-you-button]')?.getAttribute('data-count') ?? -1)`)
    const runtimeOf = async (id) => (await app.evaluate('window.api.getStore()')).runtime.find((r) => r.sessionId === id)
    const postHook = async (id, event) => {
      const res = await fetch(`http://127.0.0.1:${endpoint.port}/hook/${encodeURIComponent(id)}/${event}`, {
        method: 'POST', headers: { 'x-token': endpoint.token, 'content-type': 'application/json' }, body: '{}'
      })
      return res.status
    }

    // Start both (B first, A stays on screen) and get past Claude's folder-trust prompt.
    for (const s of [b, a]) {
      await clickCard(s.name)
      await waitFor(async () => /[A-Za-z]{6,}/.test((await app.evaluate(`window.api.ptyReplay(${js(s.id)})`)).data.replace(/\x1b\[[0-9;?<>]*[A-Za-z]/g, '')), 40000, 1000)
      await sleep(1500)
      const screen = await app.evaluate(`window.api.ptyReplay(${js(s.id)}).then((r) => r.data.slice(-4000))`)
      if (/Yes, I trust this folder/.test(screen) && /No, exit/.test(screen)) {
        await app.evaluate(`window.api.ptyWrite(${js(s.id)}, '\\x1b[B')`); await sleep(500)
        await app.evaluate(`window.api.ptyWrite(${js(s.id)}, '\\r')`); await sleep(2500)
      }
      await app.evaluate(`window.api.clearAttention(${js(s.id)})`)
    }
    await sleep(800)

    const status = await postHook(b.id, 'Stop')
    const raised = await waitFor(async () => (await cardBell('sleepy-b')) === 'done', 5000, 200)
    t.check('a finished background session shows the bell', status === 204 && !!raised, `hook=${status}`)
    const before = await runtimeOf(b.id)

    await app.evaluate(`window.api.sleepSession(${js(b.id)})`)
    const asleep = await waitFor(async () => (await runtimeOf(b.id))?.sleeping === true, 8000, 300)
    t.check('the session went to sleep', !!asleep)
    await sleep(800)
    const after = await runtimeOf(b.id)
    t.check('runtime keeps the bell reason while asleep', after?.attention === 'done', String(after?.attention))
    t.check('runtime keeps the bell time while asleep', after?.attentionAt === before?.attentionAt, `${before?.attentionAt} vs ${after?.attentionAt}`)
    t.check('the sidebar card still shows the bell', (await cardBell('sleepy-b')) === 'done', String(await cardBell('sleepy-b')))
    // D55: a sleeping session that is not on screen has no tab (only awake, running ones do), so the bell lives on its card and in the header count.
    const tabIds = await app.evaluate(`[...document.querySelectorAll('[role=tab]')].map((x) => x.dataset.tabId)`)
    t.check('a sleeping session off screen has no tab (D55); the bell stays on its card', !tabIds.includes(b.id), tabIds.join(','))
    t.check('the header count still includes it', (await headerCount()) === 1, String(await headerCount()))

    await clickCard('sleepy-b')
    const awake = await waitFor(async () => { const r = await runtimeOf(b.id); return r?.run === 'running' && !r.sleeping }, 20000, 400)
    t.check('opening it wakes it', !!awake)
    const cleared = await waitFor(async () => (await runtimeOf(b.id))?.attention === null, 5000, 200)
    t.check('opening it clears the bell', !!cleared)
    t.check('the header count drops to 0', (await headerCount()) === 0, String(await headerCount()))
  } catch (error) {
    t.check('run completed without exception', false, String((error && error.message) || error))
  } finally {
    t.summary()
    if (app) app.kill()
  }
}
main()
