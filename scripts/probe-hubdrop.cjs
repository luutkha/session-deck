const { ROOT, sleep, launchApp } = require('./e2e-lib.cjs')
;(async () => {
  const app = await launchApp({ port: 9370 })
  try {
    await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'drop-probe', statusId: 'working' })`)
    await sleep(1500)
    await app.evaluate(`document.querySelector('[aria-label="Open Hub"]').click()`)
    await sleep(800)
    const info = await app.evaluate(`(() => {
      const col = [...document.querySelectorAll('main [aria-label]')].find((n) => (n.getAttribute('aria-label') || '').startsWith('Done, '))
      col.scrollIntoView({ inline: 'center', block: 'nearest' })
      const r = col.getBoundingClientRect()
      const x = r.left + r.width / 2, y = r.top + Math.min(r.height - 24, 170)
      const el = document.elementFromPoint(x, y)
      const chain = []
      for (let n = el; n && n !== col.parentElement; n = n.parentElement) chain.push(n.tagName.toLowerCase() + '.' + String(n.className).split(' ').slice(0, 3).join('.'))
      return JSON.stringify({ rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], point: [Math.round(x), Math.round(y)], viewport: [innerWidth, innerHeight], chain })
    })()`)
    console.log(info)
    // Try the drop on every descendant to see which one carries the handler
    const result = await app.evaluate(`(async () => {
      const card = [...document.querySelectorAll('main [draggable="true"]')].find((n) => n.innerText.includes('drop-probe'))
      const dt = new DataTransfer()
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
      await new Promise((r) => setTimeout(r, 200))
      const col = [...document.querySelectorAll('main [aria-label]')].find((n) => (n.getAttribute('aria-label') || '').startsWith('Done, '))
      const all = [col, ...col.querySelectorAll('*')]
      let handled = []
      for (const el of all) {
        const ev = new DragEvent('dragover', { bubbles: false, cancelable: true, dataTransfer: dt })
        const notPrevented = el.dispatchEvent(ev)
        if (!notPrevented) handled.push(el.tagName.toLowerCase() + '.' + String(el.className).split(' ').slice(0, 2).join('.'))
      }
      return JSON.stringify(handled)
    })()`)
    console.log('elements that preventDefault dragover (= have a dragover handler):', result)
  } finally {
    app.kill()
  }
})().catch((e) => { console.log('ERR', e.message); process.exit(1) })
