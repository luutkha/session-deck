// E2E (D49): session presets through the real UI. A fake `claude` on PATH (no real Claude, ~/.claude untouched).
// Verifies: "Save as preset" in the New Session dialog stores the form (folder, args, Remote Control, group); the
// Presets menu fills the form again; the palette's "New session: <preset>" starts a session in one step; a preset can
// be deleted; presets survive a restart.
// Run: node scripts/e2e-presets.cjs   (E2E_SHOT_DIR=<dir> saves screenshots)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9437
const CTRL = 2
const SHIFT = 8

function writeFakeClaude(binDir) {
  fs.writeFileSync(path.join(binDir, 'claude.cmd'), '@echo off\r\nnode "%~dp0fake-claude.js" %*\r\n')
  fs.writeFileSync(path.join(binDir, 'fake-claude.js'), "process.stdout.write('fake claude\\r\\n> ')\nprocess.stdin.resume()\nsetInterval(() => {}, 1 << 30)\n")
}

async function main() {
  const t = makeChecker()
  let app
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-presets-'))
  const binDir = path.join(root, 'bin')
  const projA = path.join(root, 'api-project')
  const projB = path.join(root, 'other-project')
  for (const dir of [binDir, projA, projB]) fs.mkdirSync(dir)
  writeFakeClaude(binDir)
  process.env.PATH = binDir + path.delimiter + process.env.PATH
  const js = (value) => JSON.stringify(value)

  try {
    app = await launchApp({ port: PORT })
    const userData = app.userData
    await sleep(1200)
    const ev = (expression) => app.evaluate(expression)
    const store = async () => (await ev('window.api.getStore()')).data
    const group = await ev(`window.api.createGroup('Team')`)
    const center = (expr) => ev(`(() => { const n = ${expr}; if (!n) return null; n.scrollIntoView({ block: 'center' }); const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    const click = async (expr, label) => {
      const point = await waitFor(() => center(expr), 6000, 200)
      if (!point) throw new Error('not found: ' + label)
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await app.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 })
      }
      await sleep(350)
    }
    const key = async (k, code, vk, modifiers = 0) => {
      await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers })
      await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers })
      await sleep(150)
    }
    const replaceText = async (selector, text) => {
      await click(`document.querySelector(${js(selector)})`, selector)
      await key('a', 'KeyA', 65, CTRL)
      await key('Backspace', 'Backspace', 8)
      await app.send('Input.insertText', { text })
      await sleep(200)
    }
    const shot = async (name) => {
      if (!process.env.E2E_SHOT_DIR) return
      const r = await app.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(process.env.E2E_SHOT_DIR, name + '.png'), Buffer.from(r.result.data, 'base64'))
    }
    const dialogButton = (text) => `[...document.querySelectorAll('[role=dialog] button')].find((b) => b.innerText.trim() === ${js(text)})`
    const openNewDialog = async () => {
      await click(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim().startsWith('New session'))`, 'New session')
      await waitFor(() => ev(`!!document.querySelector('#new-session-folder')`), 5000, 200)
    }

    // ---- fill the form and save it as a preset
    await openNewDialog()
    await replaceText('#new-session-folder', projA)
    await replaceText('#new-session-args', '--verbose')
    await click(`document.querySelector('#new-session-remote')`, 'Remote Control checkbox')
    await click(`document.querySelector('#new-session-group')`, 'group select')
    await click(`[...document.querySelectorAll('[role=option]')].find((o) => o.innerText.trim() === 'Team')`, 'Team option')
    await click(dialogButton('Save as preset'), 'Save as preset')
    const suggested = await waitFor(() => ev(`document.querySelector('[data-preset-name]')?.value ?? null`), 4000, 200)
    t.check('Save as preset suggests the folder name', suggested === 'api-project', String(suggested))
    await replaceText('[data-preset-name]', 'Backend preset')
    await shot('preset-save-row')
    await click(dialogButton('Save preset'), 'Save preset')
    const saved = await waitFor(async () => (await store()).presets?.[0] ?? null, 5000, 200)
    t.check('the preset is stored with folder, args, Remote Control and group', !!saved && saved.name === 'Backend preset' && saved.cwd === projA &&
      saved.agent === 'claude' && js(saved.claudeArgs) === js(['--verbose', '--remote-control']) && saved.groupId === group.id, js(saved))
    t.check('the dialog says it was saved', /Saved preset "Backend preset"/.test(await ev(`document.querySelector('[data-preset-notice]')?.innerText ?? ''`)))
    await key('Escape', 'Escape', 27)
    await sleep(500)

    // ---- the Presets menu fills a fresh form
    await openNewDialog()
    await replaceText('#new-session-folder', projB)
    await click(`document.querySelector('[data-preset-menu]')`, 'Presets menu')
    await shot('preset-menu')
    await click(`document.querySelector('[data-preset-item="Backend preset"]')`, 'preset item')
    const filled = await ev(`({ folder: document.querySelector('#new-session-folder').value, args: document.querySelector('#new-session-args').value, remote: document.querySelector('#new-session-remote').getAttribute('data-state'), group: document.querySelector('#new-session-group').innerText.trim() })`)
    t.check('picking the preset fills folder, args, Remote Control and group', filled.folder === projA && filled.args === '--verbose' && filled.remote === 'checked' && filled.group === 'Team', js(filled))
    await click(dialogButton('Create session'), 'Create session')
    const created = await waitFor(async () => (await store()).sessions.find((s) => s.cwd === projA) ?? null, 8000, 200)
    t.check('the session created from the filled form keeps the preset values', !!created && js(created.claudeArgs) === js(['--verbose', '--remote-control']) && created.groupId === group.id, js(created))

    // ---- one step from the palette
    await ev('document.activeElement && document.activeElement.blur(); true')
    await key('K', 'KeyK', 75, CTRL | SHIFT)
    await waitFor(() => ev('!!document.querySelector("[cmdk-input]")'), 3000, 100)
    await app.send('Input.insertText', { text: 'New session: Backend' })
    await sleep(300)
    const first = await ev('document.querySelector("[cmdk-item][data-selected=true]")?.innerText ?? ""')
    t.check('the palette offers "New session: Backend preset"', /New session: Backend preset/.test(first), first)
    await key('Enter', 'Enter', 13)
    const two = await waitFor(async () => (await store()).sessions.filter((s) => s.cwd === projA).length === 2, 8000, 200)
    t.check('Enter starts a second session from the preset in one step', !!two)
    const second = (await store()).sessions.filter((s) => s.cwd === projA).sort((a, b) => b.createdAt - a.createdAt)[0]
    t.check('...with the preset values', second.groupId === group.id && js(second.claudeArgs) === js(['--verbose', '--remote-control']), js(second))
    const opened = await waitFor(async () => (await ev(`document.querySelector('[role=tab][aria-selected=true]')?.getAttribute('data-tab-id') ?? null`)) === second.id, 5000, 200)
    t.check('...and opens it', !!opened)

    // ---- survives a restart
    await ev('window.api.quitApp()').catch(() => undefined)
    await sleep(4000)
    app.kill()
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    t.check('the preset is still there after a restart', ((await app.evaluate('window.api.getStore()')).data.presets ?? []).length === 1)

    // ---- delete through the menu
    await openNewDialog()
    await click(`document.querySelector('[data-preset-menu]')`, 'Presets menu')
    await click(`[...document.querySelectorAll('[role=menuitem]')].find((n) => n.innerText.includes('Delete a preset'))`, 'Delete submenu')
    await click(`document.querySelector('[data-preset-delete="Backend preset"]')`, 'delete item')
    const deleted = await waitFor(async () => ((await app.evaluate('window.api.getStore()')).data.presets ?? []).length === 0, 5000, 200)
    t.check('Delete a preset removes it', !!deleted)
  } catch (error) {
    t.check('no unexpected error', false, String((error && error.stack) || error))
  } finally {
    if (app) app.kill()
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
