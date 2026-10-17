// What happens in the DOM when the New session dialog opens? Used to debug dialogs that did not appear.
const { ROOT, sleep, launchApp } = require('./e2e-lib.cjs')

async function main() {
  const app = await launchApp({ port: 9364 })
  try {
    await sleep(1500)
    console.log('viewport          =', await app.evaluate('innerWidth + "x" + innerHeight'))
    console.log('root height       =', await app.evaluate('Math.round(document.getElementById("root").getBoundingClientRect().height)'))
    const c = await app.evaluate(`(() => { const el = [...document.querySelectorAll('button')].find((n) => n.innerText.trim().startsWith('New session')); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none' })
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 })
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 })
    await sleep(1200)
    console.log('dialogs in DOM    =', await app.evaluate('document.querySelectorAll("[role=dialog], [role=alertdialog]").length'))
    console.log('dialog info       =', await app.evaluate(`(() => { const d = document.querySelector('[role=dialog], [role=alertdialog]'); if (!d) return 'none'; const r = d.getBoundingClientRect(); const cs = getComputedStyle(d); return JSON.stringify({ rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], position: cs.position, opacity: cs.opacity, display: cs.display, visibility: cs.visibility, transform: cs.transform, animation: cs.animationName, state: d.getAttribute('data-state') }) })()`))
    console.log('overlay           =', await app.evaluate(`(() => { const o = document.querySelector('[data-slot=dialog-overlay], [data-radix-dialog-overlay]'); if (!o) return 'none'; const cs = getComputedStyle(o); return JSON.stringify({ position: cs.position, bg: cs.backgroundColor, opacity: cs.opacity, z: cs.zIndex }) })()`))
    console.log('body              =', await app.evaluate(`JSON.stringify({ h: Math.round(document.body.getBoundingClientRect().height), overflow: getComputedStyle(document.body).overflow, style: document.body.getAttribute('style') })`))
    console.log('children of body  =', await app.evaluate(`JSON.stringify([...document.body.children].map((c) => c.tagName + (c.id ? '#' + c.id : '') + ' ' + Math.round(c.getBoundingClientRect().height)))`))
    console.log('dialog text       =', await app.evaluate(`(document.querySelector('[role=dialog], [role=alertdialog]')?.innerText || '').slice(0, 120).replace(/\\n/g, ' | ')`))
  } finally {
    app.kill()
  }
}
main().catch((e) => { console.log('ERR', e.message); process.exit(1) })
