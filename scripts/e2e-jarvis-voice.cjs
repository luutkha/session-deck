// E2E (D54): Jarvis voice. (1) Talk: Windows text-to-speech writes a WAV of "list my sessions"; the app's recognizer
// reads it instead of the microphone (SESSIONDECK_VOICE_WAV test seam) and the words go to Jarvis (OpenCode, free
// model). (2) Read aloud: a finished Claude-Jarvis turn (Stop hook + a transcript in a TEMP CLAUDE_CONFIG_DIR, never
// the user's ~/.claude) is spoken with the system voices when the panel's speaker toggle is on.
// Run: node scripts/e2e-jarvis-voice.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { sleep, strip, waitFor, makeChecker, launchApp, stopOpencodeService } = require('./e2e-lib.cjs')

const PORT = 9465
const MODEL = process.env.JARVIS_OC_MODEL || 'opencode/deepseek-v4.1-flash-free'
const CTRL = 2
const SHIFT = 8

function makeWav(file, words) {
  const script = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = -1; $s.SetOutputToWaveFile('${file}'); $s.Speak('${words}'); $s.Dispose()`
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('could not make the WAV: ' + r.stderr)
}

async function main() {
  const t = makeChecker()
  const js = (value) => JSON.stringify(value)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-voice-'))
  const wav = path.join(root, 'command.wav')
  const claudeDir = path.join(root, 'claude-config')
  const endpointFile = path.join(root, 'endpoint.json')
  fs.mkdirSync(claudeDir)
  makeWav(wav, 'list my sessions')
  process.env.SESSIONDECK_VOICE_WAV = wav
  process.env.CLAUDE_CONFIG_DIR = claudeDir
  process.env.SESSIONDECK_E2E_ENDPOINT_FILE = endpointFile
  let app
  try {
    stopOpencodeService()
    app = await launchApp({ port: PORT })
    await sleep(1200)
    const ev = (expression) => app.evaluate(expression)
    const store = async () => ev('window.api.getStore()')
    const click = async (expr, label) => {
      const point = await waitFor(() => ev(`(() => { const n = ${expr}; if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`), 8000, 200)
      if (!point) throw new Error('not found: ' + label)
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await app.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 })
      }
      await sleep(400)
    }

    // ---- (1) talk to Jarvis (OpenCode, free model)
    await ev(`window.api.updateSettings({ jarvis: { agent: 'opencode', opencodeModel: ${js(MODEL)} } })`)
    await ev('document.activeElement && document.activeElement.blur(); true')
    await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'J', code: 'KeyJ', windowsVirtualKeyCode: 74, modifiers: CTRL | SHIFT })
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'J', code: 'KeyJ', windowsVirtualKeyCode: 74, modifiers: CTRL | SHIFT })
    const jarvis = await waitFor(async () => (await store()).data.sessions.find((s) => s.role === 'jarvis') ?? null, 10000, 300)
    t.check('the panel opens Jarvis on OpenCode', !!jarvis && jarvis.agent === 'opencode')
    await waitFor(async () => (strip((await ev(`window.api.ptyReplay(${js(jarvis.id)})`)).data).length > 200 ? true : null), 60000, 1000)
    await sleep(6000)
    await click(`document.querySelector('[data-jarvis-mic]')`, 'mic')
    const heard = await waitFor(() => ev(`(document.querySelector('[data-jarvis-notice]')?.innerText ?? '').startsWith('Heard') ? document.querySelector('[data-jarvis-notice]').innerText : null`), 90000, 500)
    t.check('the mic button recognizes the spoken sentence', !!heard && /list my sessions/i.test(heard), String(heard))
    const typed = await waitFor(async () => (/my sessions/i.test(strip((await ev(`window.api.ptyReplay(${js(jarvis.id)})`)).data)) ? true : null), 20000, 500)
    t.check('...and sends it to Jarvis', typed === true)
    const log = fs.readFileSync(path.join(app.userData, 'jarvis', 'actions.log'), 'utf8')
    t.check('...the voice command is in the action log', /"tool":"voice"/.test(log) && /list my sessions/i.test(log))

    // ---- (2) read replies aloud (Claude engine; the reply comes from a transcript in the temp config dir)
    const claudeJarvis = await ev(`window.api.updateSettings({ jarvis: { agent: 'claude' } }).then(() => window.api.openJarvis())`)
    t.check('switching to Claude gives a Claude Jarvis', (claudeJarvis.agent ?? 'claude') === 'claude' && !!claudeJarvis.claudeSessionId)
    const projectDir = path.join(claudeDir, 'projects', 'jarvis-e2e')
    fs.mkdirSync(projectDir, { recursive: true })
    const reply = '## Done\n**API** is asleep and `Web` is running.'
    fs.writeFileSync(path.join(projectDir, `${claudeJarvis.claudeSessionId}.jsonl`), [
      JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: 'status?' } }),
      JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: reply }] } })
    ].join('\n'))
    await ev(`(() => { window.__spoken = []; const original = window.speechSynthesis.speak.bind(window.speechSynthesis); window.speechSynthesis.speak = (u) => { window.__spoken.push(u.text); original(u) }; return true })()`)
    t.check('the speaker toggle starts off', (await ev(`document.querySelector('[data-jarvis-speak]')?.getAttribute('aria-pressed')`)) === 'false')
    await click(`document.querySelector('[data-jarvis-speak]')`, 'speaker')
    t.check('...and turns on', (await ev(`document.querySelector('[data-jarvis-speak]')?.getAttribute('aria-pressed')`)) === 'true')
    const endpoint = JSON.parse(fs.readFileSync(endpointFile, 'utf8'))
    const hook = await fetch(`http://127.0.0.1:${endpoint.port}/hook/${encodeURIComponent(claudeJarvis.id)}/Stop`, { method: 'POST', headers: { 'x-token': endpoint.token, 'content-type': 'application/json' }, body: '{}' })
    t.check('a finished Jarvis turn is reported', hook.status === 204, String(hook.status))
    const spoken = await waitFor(() => ev('window.__spoken.length > 0 ? window.__spoken : null'), 8000, 200)
    t.check('...and its reply is read aloud as plain words', !!spoken && spoken[0] === 'Done API is asleep and Web is running.', js(spoken))
    await click(`document.querySelector('[data-jarvis-speak]')`, 'speaker off')
    await ev('window.__spoken = []; true')
    await fetch(`http://127.0.0.1:${endpoint.port}/hook/${encodeURIComponent(claudeJarvis.id)}/Stop`, { method: 'POST', headers: { 'x-token': endpoint.token, 'content-type': 'application/json' }, body: '{}' })
    await sleep(1500)
    t.check('with the toggle off nothing is spoken', (await ev('window.__spoken.length')) === 0)

    for (const s of (await store()).data.sessions) await ev(`window.api.removeSession(${js(s.id)})`)
  } catch (error) {
    t.check('no unexpected error', false, String((error && error.stack) || error))
  } finally {
    if (app) app.kill()
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
