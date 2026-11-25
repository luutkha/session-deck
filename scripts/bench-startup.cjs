// Benchmark: how fast the app becomes usable after launch (performance work, D87). Prints numbers to compare before/after
// a change; it is not a pass/fail suite. Each run starts the built app with a fresh user-data folder, so it measures the
// cold start of an empty profile (a profile with many sessions is slower: see the store size notes in DECISIONS D87).
// Run: npx electron-vite build && node scripts/bench-startup.cjs [runs=5]
// Reported per run: spawnToUsableMs = from process spawn until `window.api.getStore` answers in the first window
// (the window exists, its preload ran and the renderer has loaded); fcpMs = the renderer's first contentful paint
// (relative to its navigation start); domReadyMs / loadMs from the navigation timing entry. Medians at the end.
const { launchApp, sleep } = require('./e2e-lib.cjs')

const PORT = 9497
const RUNS = Number(process.argv[2] ?? 5)

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length === 0 ? null : sorted[Math.floor(sorted.length / 2)]
}

async function main() {
  const rows = []
  for (let run = 0; run < RUNS; run += 1) {
    const started = Date.now()
    const app = await launchApp({ port: PORT })
    const spawnToUsableMs = Date.now() - started
    // Paint entries appear shortly after the first render; give them a moment.
    await sleep(1500)
    const timing = await app.evaluate(`(() => {
      const nav = performance.getEntriesByType('navigation')[0]
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]
      return { fcpMs: fcp ? Math.round(fcp.startTime) : null, domReadyMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null, loadMs: nav ? Math.round(nav.loadEventEnd) : null }
    })()`)
    rows.push({ run: run + 1, spawnToUsableMs, ...timing })
    app.kill()
    await sleep(1500)
  }
  for (const row of rows) console.log(JSON.stringify(row))
  const summary = {
    runs: rows.length,
    medianSpawnToUsableMs: median(rows.map((r) => r.spawnToUsableMs)),
    medianFcpMs: median(rows.map((r) => r.fcpMs).filter((v) => v !== null)),
    medianDomReadyMs: median(rows.map((r) => r.domReadyMs).filter((v) => v !== null)),
    medianLoadMs: median(rows.map((r) => r.loadMs).filter((v) => v !== null))
  }
  console.log('STARTUP ' + JSON.stringify(summary))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
