// E2E (no-GPU support, D63): a PC that only renders in software is detected, remembered, and the next start runs with the GPU
// process off; the saved preference "On" and SESSIONDECK_GPU override it. The no-GPU case is imitated with SwiftShader flags
// (software WebGL) and with --disable-gpu; the real-GPU check only runs when this PC has a GPU.
// Run: npx electron-vite build && node scripts/e2e-gpumode.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9498
const SWIFTSHADER = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
const NO_GPU = ['--disable-gpu']
const ROOT_SHOTS = require('node:os').tmpdir()

async function main() {
  const t = makeChecker()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-gpumode-'))
  const dirs = []
  const freshDir = () => {
    const dir = path.join(root, `u${dirs.length}`)
    fs.mkdirSync(dir)
    dirs.push(dir)
    return dir
  }
  const modeFile = (dir) => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, 'gpu-mode.json'), 'utf8')) } catch { return null }
  }
  /** Launches, waits for the first window, runs `fn(app)`, kills the app. */
  const run = async (userData, extraArgs, fn) => {
    const app = await launchApp({ port: PORT, userData, extraArgs })
    try {
      await sleep(2500)
      return await fn(app)
    } finally {
      app.kill()
      await sleep(1200)
    }
  }
  const gpuInfo = (app) => waitFor(() => app.evaluate('window.api.getGpuInfo()'), 10000, 300)

  try {
    // ---- no GPU (--disable-gpu): detected as software right away, remembered
    const dirA = freshDir()
    const first = await run(dirA, NO_GPU, async (app) => {
      const info = await gpuInfo(app)
      await sleep(500)
      return info
    })
    t.check('--disable-gpu is detected as software (WebGL unavailable)', first?.mode === 'software' && first?.accelerationDisabled === false, JSON.stringify(first))
    t.check('the software result is remembered in gpu-mode.json', modeFile(dirA)?.lastSoftware === true && modeFile(dirA)?.pref === 'auto', JSON.stringify(modeFile(dirA)))

    // ---- the next start (same data dir) turns the GPU process off by itself
    const second = await run(dirA, [], gpuInfo)
    t.check('the next start runs with the GPU process off (auto + remembered software)', second?.accelerationDisabled === true && second?.mode === 'software', JSON.stringify(second))
    t.check('the app keeps the remembered state while the GPU is off (a disabled GPU always looks like software)', modeFile(dirA)?.lastSoftware === true)

    // ---- pref "on" overrides the remembered state at the next start; the saved pref survives
    await run(dirA, [], async (app) => {
      await app.evaluate("window.api.setGpuPref('on')")
    })
    t.check('the preference is saved', modeFile(dirA)?.pref === 'on', JSON.stringify(modeFile(dirA)))
    const forcedOn = await run(dirA, [], gpuInfo)
    t.check('pref "on" starts with the GPU process on again', forcedOn?.accelerationDisabled === false && forcedOn?.pref === 'on', JSON.stringify(forcedOn))

    // ---- pref "off" turns it off even on a fresh data dir
    const dirB = freshDir()
    fs.writeFileSync(path.join(dirB, 'gpu-mode.json'), JSON.stringify({ version: 1, pref: 'off', lastSoftware: false, launches: 0 }))
    const forcedOff = await run(dirB, [], gpuInfo)
    t.check('pref "off" starts with the GPU process off', forcedOff?.accelerationDisabled === true && forcedOff?.pref === 'off', JSON.stringify(forcedOff))

    // ---- SESSIONDECK_GPU beats the file
    const dirC = freshDir()
    process.env.SESSIONDECK_GPU = 'off'
    const envOff = await run(dirC, [], gpuInfo)
    delete process.env.SESSIONDECK_GPU
    t.check('SESSIONDECK_GPU=off turns the GPU process off', envOff?.accelerationDisabled === true, JSON.stringify(envOff))

    // ---- a software WebGL that Chromium reports as enabled (SwiftShader): the window's probe reports it, main remembers it
    const dirD = freshDir()
    const probed = await run(dirD, SWIFTSHADER, async (app) => {
      await gpuInfo(app)
      await sleep(1500)
      return app.evaluate('document.documentElement.dataset.reduceEffects ?? null')
    })
    t.check('a software WebGL (SwiftShader) is remembered via the window probe', modeFile(dirD)?.lastSoftware === true, JSON.stringify(modeFile(dirD)))
    t.check('and the window switched to reduced effects (auto)', probed === 'true', String(probed))

    // ---- Settings > Terminal > Graphics shows what was detected and the three controls
    const dirF = freshDir()
    const ui = await run(dirF, NO_GPU, async (app) => {
      await gpuInfo(app)
      await app.evaluate(`document.querySelector('[aria-label="Settings"], [aria-label="Open Settings"]')?.click()`)
      await sleep(600)
      await app.evaluate(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Terminal')?.click()`)
      await sleep(600)
      const text = (id) => app.evaluate(`document.querySelector('[data-testid="${id}"]')?.innerText ?? null`)
      const info = await waitFor(async () => { const v = await text('settings-gpu-info'); return v && v.length > 0 ? v : null }, 6000, 200)
      const shot = await app.send('Page.captureScreenshot', { format: 'png' })
      if (shot.result?.data) fs.writeFileSync(path.join(ROOT_SHOTS, 'e2e-gpumode-settings.png'), Buffer.from(shot.result.data, 'base64'))
      return { info, renderer: await text('settings-renderer'), effects: await text('settings-effects'), gpu: await text('settings-gpu') }
    })
    t.check('Settings > Terminal shows the detected graphics as software', typeof ui.info === 'string' && /software/i.test(ui.info), String(ui.info))
    t.check('Settings > Terminal has the renderer, effects and GPU controls (all Auto)', ui.renderer === 'Auto' && ui.effects === 'Auto' && ui.gpu === 'Auto', JSON.stringify(ui))

    // ---- this PC's real GPU (skipped on a PC without one)
    if (process.env.SESSIONDECK_E2E_NO_REAL_GPU === '1') {
      console.log('SKIP  real GPU checks (SESSIONDECK_E2E_NO_REAL_GPU=1)')
    } else {
      const dirE = freshDir()
      const real = await run(dirE, [], async (app) => {
        const info = await gpuInfo(app)
        await sleep(1500)
        const effects = await app.evaluate('document.documentElement.dataset.reduceEffects ?? null')
        return { info, effects }
      })
      t.check('a real GPU is detected as hardware', real.info?.mode === 'hardware', JSON.stringify(real.info))
      t.check('a real GPU is never remembered as software, effects stay full', modeFile(dirE)?.lastSoftware === false && real.effects === 'false', `${JSON.stringify(modeFile(dirE))} ${real.effects}`)
    }
  } catch (error) {
    t.check('gpu-mode e2e ran without an exception', false, String(error))
  } finally {
    await sleep(500)
    fs.rmSync(root, { recursive: true, force: true })
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
