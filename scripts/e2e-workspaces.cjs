// E2E: the sidebar shows a workspace (root folder) sub-header inside each group; it collapses, persists, can be
// switched off, and its context menu starts a new session with the folder prefilled.
const os = require('node:os')
const path = require('node:path')
const { ROOT, sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')
async function main() {
  const t = makeChecker()
  let app
  try {
    app = await launchApp({ port: 9379 })
    await sleep(1200)
    const other = os.tmpdir()
    const mk = (name, cwd) => app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(cwd)}, name: ${JSON.stringify(name)} })`)
    await mk('ws-one', ROOT)
    await mk('ws-two', ROOT.replace(/\\/g, '/') + '/')
    await mk('ws-lone', other)
    await sleep(1500)

    const headers = () => app.evaluate(`[...document.querySelectorAll('[data-workspace]')].map((n) => n.getAttribute('data-workspace-collapsed') + ':' + n.querySelector('button').innerText.replace(/\\s+/g, ' ').trim())`)
    const rows = (name) => app.evaluate(`[...document.querySelectorAll('[role=treeitem]')].filter((n) => n.innerText.includes(${JSON.stringify(name)})).length`)

    const h = await headers()
    const rootName = path.basename(ROOT)
    t.check('two workspaces are shown (same folder in different spellings is one)', h.length === 2, JSON.stringify(h))
    t.check('the workspace is labelled with its folder name and counts its sessions', h.some((x) => x.includes(rootName) && x.includes('2')), JSON.stringify(h))
    t.check('the other folder is its own workspace', h.some((x) => x.includes(path.basename(other))), JSON.stringify(h))

    await app.evaluate(`[...document.querySelectorAll('[data-workspace]')].find((n) => n.innerText.includes(${JSON.stringify(rootName)})).querySelector('button').click()`)
    await sleep(400)
    t.check('collapsing hides that workspace\'s sessions', (await rows('ws-one')) === 0 && (await rows('ws-two')) === 0)
    t.check('other workspaces stay open', (await rows('ws-lone')) === 1)

    await app.evaluate('location.reload()')
    await sleep(2500)
    const after = await headers()
    t.check('the collapsed state survives a reload', after.some((x) => x.startsWith('true:') && x.includes(rootName)), JSON.stringify(after))

    await app.evaluate(`[...document.querySelectorAll('[data-workspace]')].find((n) => n.innerText.includes(${JSON.stringify(rootName)})).querySelector('button').click()`)
    await sleep(300)
    await app.evaluate(`(() => { const n = [...document.querySelectorAll('[data-workspace]')].find((x) => x.innerText.includes(${JSON.stringify(rootName)})).querySelector('button'); n.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })) })()`)
    const item = await waitFor(() => app.evaluate(`[...document.querySelectorAll('[role=menuitem]')].some((n) => n.innerText.includes('New session in this workspace'))`), 5000, 200)
    t.check('the workspace context menu offers a new session', !!item)
    await app.evaluate(`[...document.querySelectorAll('[role=menuitem]')].find((n) => n.innerText.includes('New session in this workspace'))?.click()`)
    const folder = await waitFor(() => app.evaluate(`[...document.querySelectorAll('[role=dialog] input')].map((i) => i.value).find((v) => v.length > 0) || null`), 5000, 200)
    t.check('the new-session dialog opens with the folder prefilled', typeof folder === 'string' && folder.toLowerCase().replace(/\\/g, '/').includes(rootName.toLowerCase()), String(folder))
    await app.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(300)

    await app.evaluate(`localStorage.setItem('sessiondeck-sidebar-show-workspaces', 'false'); location.reload()`)
    await sleep(2500)
    t.check('with "Show workspaces" off there are no workspace headers and all sessions show',
      (await headers()).length === 0 && (await rows('ws-one')) === 1 && (await rows('ws-lone')) === 1)
  } catch (e) {
    t.check('run completed without exception', false, String(e.message || e))
  } finally {
    if (app) app.kill()
    process.exit(t.summary() ? 1 : 0)
  }
}
main()
