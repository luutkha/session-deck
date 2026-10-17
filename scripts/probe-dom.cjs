// Dumps the interactive elements of the running app (aria-labels, roles, texts) so visual scripts can target them.
const { ROOT, sleep, waitFor, launchApp } = require('./e2e-lib.cjs')

async function main() {
  const app = await launchApp({ port: 9360 })
  try {
    const g = await app.evaluate(`window.api.createGroup('Work')`)
    const s = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'probe one', groupId: ${JSON.stringify(g.id)} })`)
    await sleep(1500)
    await app.evaluate(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('probe one'))?.click()`)
    await sleep(1500)
    const dump = await app.evaluate(`JSON.stringify([...document.querySelectorAll('button, [role="button"], [role="treeitem"], [role="tab"], input, [role="menuitem"]')].map((el) => ({
      tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), label: el.getAttribute('aria-label'), title: el.getAttribute('title'),
      text: (el.innerText || '').trim().slice(0, 40), ph: el.getAttribute('placeholder') })))`)
    for (const e of JSON.parse(dump)) console.log(JSON.stringify(e))
    void s
  } finally {
    app.kill()
  }
}
main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
