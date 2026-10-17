const lib = require('../e2e-lib.cjs')
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC'
;(async () => {
  const app = await lib.launchApp({ port: 9400 }); await lib.sleep(1500)
  const s = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(lib.ROOT)}, name: 'ocimg', agent: 'opencode', model: 'opencode/deepseek-v4.1-flash-free' })`)
  await lib.sleep(1500)
  await app.evaluate(`[...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('ocimg')).click()`)
  await lib.sleep(9000)
  await app.evaluate(`navigator.clipboard.write([new ClipboardItem({ 'image/png': Promise.resolve(new Blob([Uint8Array.from(atob('${PNG}'), (c) => c.charCodeAt(0))], { type: 'image/png' })) })])`)
  for (const [label, keys] of [['alt+v (ESC v)', '\x1bv'], ['ctrl+v', '\x16']]) {
    await app.evaluate(`window.api.ptyWrite(${JSON.stringify(s.id)}, ${JSON.stringify(keys)})`)
    await lib.sleep(2500)
    const shot = await app.send('Page.captureScreenshot', { format: 'png' })
    require('fs').writeFileSync(require('path').join(lib.ROOT, 'scripts', 'visual', 'ocimg-' + label.replace(/\W/g, '') + '.png'), Buffer.from(shot.result.data, 'base64'))
    const r = lib.strip((await app.evaluate(`window.api.ptyReplay(${JSON.stringify(s.id)})`)).data)
    console.log(label, '->', JSON.stringify((r.match(/.{0,20}(Image|image|clipboard).{0,30}/gi) || []).slice(-3)))
  }
  app.kill()
})()
