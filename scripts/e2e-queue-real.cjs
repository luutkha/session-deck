// E2E (D47) with a REAL Claude: a queued prompt is submitted by itself when the first turn finishes.
// Proof comes from Claude's own UserPromptSubmit hook (the timeline records the prompt text Claude received) and the
// answer on screen. Sends TWO tiny prompts (costs a few cents of the user's plan). Run: node scripts/e2e-queue-real.cjs
const { ROOT, sleep, strip, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const QUEUED = 'Reply with exactly the word QUEUEPONG and nothing else'

async function main() {
  const t = makeChecker()
  let app
  const js = (value) => JSON.stringify(value)
  try {
    app = await launchApp({ port: 9433 })
    await sleep(1200)
    const ev = (expression) => app.evaluate(expression)
    const s = await ev(`window.api.createSession({ cwd: ${js(ROOT)}, name: 'queue real' })`)
    const sid = js(s.id)
    await sleep(1000)
    await ev(`[...document.querySelectorAll('[role=treeitem]')].find((n) => n.innerText.includes('queue real'))?.click()`)
    await waitFor(async () => /[A-Za-z]{6,}/.test(strip((await ev(`window.api.ptyReplay(${sid})`)).data)), 45000, 1000)
    await sleep(2000)
    // Same first-run dialog handling as scripts/e2e.cjs (trust prompt: move to "Yes" first; never a blind Enter on "No, exit").
    for (let i = 0; i < 3; i += 1) {
      const screen = await ev(`window.api.ptyReplay(${sid}).then((r) => r.data.slice(-4000))`)
      if (/Yes, I trust this folder/.test(screen) && /No, exit/.test(screen)) { await ev(`window.api.ptyWrite(${sid}, '\\x1b[B')`); await sleep(500) }
      await ev(`window.api.ptyWrite(${sid}, '\\r')`)
      await sleep(2500)
    }

    // Queue while no turn has finished yet: it must wait.
    await ev(`window.api.setSessionQueue(${sid}, [{ id: 'q1', text: ${js(QUEUED)}, addedAt: Date.now() }])`)
    await sleep(1500)
    const early = await ev(`window.api.getTimeline(${sid})`)
    t.check('the queued prompt waits while no turn has finished', !early.some((turn) => turn.prompt.includes('QUEUEPONG')), js(early))

    // A real first turn; when it finishes, the queue types the next prompt by itself.
    await ev(`window.api.ptyWrite(${sid}, 'Reply with the single word ok')`)
    await sleep(500)
    await ev(`window.api.ptyWrite(${sid}, '\\r')`)
    const queuedTurn = await waitFor(async () => (await ev(`window.api.getTimeline(${sid})`)).find((turn) => turn.prompt.includes('QUEUEPONG')) ?? null, 180000, 1500)
    t.check('Claude received the queued prompt as a real submitted prompt (UserPromptSubmit)', !!queuedTurn, queuedTurn ? queuedTurn.prompt : 'no such turn within 180 s')
    const turns = await ev(`window.api.getTimeline(${sid})`)
    // getTimeline lists the newest turn first; compare start times.
    const firstTurn = turns.find((x) => /single word ok/.test(x.prompt))
    const queued = turns.find((x) => x.prompt.includes('QUEUEPONG'))
    t.check('it started after the first turn finished', !!firstTurn && !!queued && firstTurn.endedAt !== null && queued.startedAt >= firstTurn.endedAt, js(turns.map((x) => [x.prompt, x.startedAt, x.endedAt])))
    const finished = await waitFor(async () => (await ev(`window.api.getTimeline(${sid})`)).find((turn) => turn.prompt.includes('QUEUEPONG') && turn.end === 'finished') ?? null, 180000, 1500)
    t.check('the queued turn ran to the end (Stop)', !!finished)
    const screen = strip((await ev(`window.api.ptyReplay(${sid})`)).data)
    t.check('Claude answered it on screen', (screen.match(/QUEUEPONG/g) ?? []).length >= 2, screen.slice(-600))
    t.check('the queue is empty afterwards', ((await ev('window.api.getStore()')).data.sessions.find((x) => x.id === s.id)?.queue ?? []).length === 0)
    await ev(`window.api.removeSession(${sid})`)
  } catch (error) {
    t.check('no unexpected error', false, String((error && error.stack) || error))
  } finally {
    if (app) app.kill()
  }
  process.exit(t.summary() === 0 ? 0 : 1)
}

main()
