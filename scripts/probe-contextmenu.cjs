// Where does the card context menu open? Compares a synthetic DOM contextmenu event with a CDP right-click.
const { ROOT, sleep, launchApp } = require('./e2e-lib.cjs')

async function menuRect(app) {
  return app.evaluate(`(() => { const m = document.querySelector('[role="menu"]'); if (!m) return null; const r = m.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } })()`)
}

async function main() {
  const app = await launchApp({ port: 9363 })
  try {
    await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'ctx probe' })`)
    await sleep(2500)
    const card = await app.evaluate(`(() => { const el = [...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('ctx probe')); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + 60), y: Math.round(r.top + 20) } })()`)
    console.log('card point        =', JSON.stringify(card))

    await app.evaluate(`(() => { const el = [...document.querySelectorAll('[role="treeitem"]')].find((n) => n.innerText.includes('ctx probe')); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${card.x}, clientY: ${card.y}, button: 2 })) })()`)
    await sleep(500)
    console.log('synthetic event   =', JSON.stringify(await menuRect(app)))
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
    await sleep(400)

    await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x, y: card.y, button: 'none' })
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: card.x, y: card.y, button: 'right', buttons: 2, clickCount: 1 })
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: card.x, y: card.y, button: 'right', buttons: 2, clickCount: 1 })
    await sleep(500)
    console.log('CDP right-click   =', JSON.stringify(await menuRect(app)))
    console.log('wrapper style     =', await app.evaluate(`(() => { const w = document.querySelector('[data-radix-popper-content-wrapper]'); if (!w) return 'none'; const cs = getComputedStyle(w); return JSON.stringify({ inline: w.getAttribute('style'), position: cs.position, transform: cs.transform, translate: cs.translate, zoom: getComputedStyle(document.documentElement).zoom }) })()`))
    console.log('menu style        =', await app.evaluate(`(() => { const m = document.querySelector('[role=menu]'); const cs = getComputedStyle(m); return JSON.stringify({ position: cs.position, top: cs.top, left: cs.left, transform: cs.transform, inset: cs.inset }) })()`))
  } finally {
    app.kill()
  }
}
main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
