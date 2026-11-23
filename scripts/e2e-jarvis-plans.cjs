// E2E (D80): Jarvis task plans and watch settings, in the real built app. No model runs: the plan steps type into plain SHELL
// sessions and the Jarvis tools are called directly over the MCP endpoint (the way a real Jarvis calls them).
// Checks: both features are OFF by default and refuse/skip until switched on; settings validate; plan_create (off, bad input,
// a two-step plan A -> B where B uses {{a}}; a plan step that CREATES a session needs a real Claude/OpenCode, so that path is unit-tested only), plan_status, plan_cancel, and "turning plans off cancels a running plan".
// Run: npx electron-vite build && node scripts/e2e-jarvis-plans.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { ROOT, sleep, waitFor, makeChecker, launchApp } = require('./e2e-lib.cjs')

const PORT = 9508

async function main() {
  const t = makeChecker()
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-plans-'))
  const userData = path.join(rootDir, 'userdata')
  fs.mkdirSync(userData)
  let app
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    const cfgFile = path.join(userData, 'jarvis', 'mcp.json')
    await waitFor(() => (fs.existsSync(cfgFile) ? true : null), 20000, 300)
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')).mcpServers.sessiondeck
    let rpcId = 0
    const rpc = async (method, params) => {
      const res = await fetch(cfg.url, { method: 'POST', headers: { ...cfg.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) })
      return (await res.json()).result
    }
    const tool = async (name, args = {}) => {
      const r = await rpc('tools/call', { name, arguments: args })
      return { text: r.content[0].text, error: r.isError === true }
    }
    const settings = () => app.evaluate('window.api.getStore()').then((s) => s.settings || s.data.settings)

    // ---- defaults and validation
    const names = (await rpc('tools/list', {})).tools.map((x) => x.name)
    t.check('tools/list offers plan_create, plan_status, plan_cancel', ['plan_create', 'plan_status', 'plan_cancel'].every((n) => names.includes(n)), String(names.length))
    const s0 = (await tool('get_settings')).text
    t.check('watch mode and task plans are OFF by default', /"watchEnabled":\s*false/.test(s0) && /"plansEnabled":\s*false/.test(s0), s0.slice(0, 300))
    const off = await tool('plan_create', { goal: 'x', steps: [{ id: 'a', title: 'a', prompt: 'echo hi', session: 'nothing' }] })
    t.check('plan_create refuses while plans are off, and says where to turn them on', off.error && /Settings/.test(off.text), off.text.slice(0, 200))
    const badInterval = await tool('update_settings', { changes: { jarvis: { watchEveryMinutes: 0 } } })
    t.check('a watch interval of 0 is refused', badInterval.error || /watchEveryMinutes|whole number/i.test(badInterval.text), badInterval.text.slice(0, 200))
    const good = await tool('update_settings', { changes: { jarvis: { watchEnabled: true, watchEveryMinutes: 15, plansEnabled: true } } })
    t.check('watch and plans can be switched on (interval 15)', !good.error, good.text.slice(0, 200))
    const s1 = (await tool('get_settings')).text
    t.check('the new values are stored', /"watchEnabled":\s*true/.test(s1) && /"watchEveryMinutes":\s*15/.test(s1) && /"plansEnabled":\s*true/.test(s1), s1.slice(0, 300))

    // ---- plan input checks
    const shellA = await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'plan shell A', agent: 'shell' })`)
    await sleep(2500)
    await app.evaluate(`window.api.createSession({ cwd: ${JSON.stringify(ROOT)}, name: 'plan shell B', agent: 'shell' })`)
    await sleep(2500)
    const noSession = await tool('plan_create', { goal: 'x', steps: [{ id: 'a', title: 'a', prompt: 'echo hi', session: 'no such session xyz' }] })
    t.check('an unknown session is refused with its name', noSession.error && /no such session xyz/.test(noSession.text), noSession.text.slice(0, 200))
    const cyc = await tool('plan_create', { goal: 'x', steps: [
      { id: 'a', title: 'a', prompt: 'echo a', session: 'plan shell A', depends_on: ['b'] },
      { id: 'b', title: 'b', prompt: 'echo b', session: 'plan shell A', depends_on: ['a'] }] })
    t.check('a dependency cycle is refused', cyc.error && /cycle/i.test(cyc.text), cyc.text.slice(0, 200))
    const badRef = await tool('plan_create', { goal: 'x', steps: [{ id: 'a', title: 'a', prompt: 'echo {{zzz}}', session: 'plan shell A' }] })
    t.check('a {{placeholder}} that is not a dependency is refused', badRef.error && /zzz/.test(badRef.text), badRef.text.slice(0, 200))
    const both = await tool('plan_create', { goal: 'x', steps: [{ id: 'a', title: 'a', prompt: 'p', session: 'plan shell A', new_session: { name: 'n' } }] })
    t.check('a step with both session and new_session is refused', both.error, both.text.slice(0, 200))

    // ---- a real two-step plan: A runs in shell A, B in shell B and uses {{a}}
    const created = await tool('plan_create', { goal: 'e2e two-step plan', steps: [
      { id: 'a', title: 'first', prompt: 'echo PLAN_STEP_A', session: 'plan shell A' },
      { id: 'b', title: 'second', prompt: 'echo got: {{a}}', session: 'plan shell B', depends_on: ['a'] }] })
    t.check('plan_create starts a plan', !created.error && /running/i.test(created.text), created.text.slice(0, 300))
    const planId = (created.text.match(/\b([0-9a-f]{8})\b/) || [])[1]
    t.check('the plan has an id', !!planId, created.text.slice(0, 200))
    const typedA = await waitFor(async () => {
      const r = await tool('read_screen', { session: 'plan shell A' })
      return /PLAN_STEP_A/.test(r.text) ? r : null
    }, 30000, 1000)
    t.check('step A was typed into the existing shell', !!typedA)
    const typedB = await waitFor(async () => {
      const r = await tool('read_screen', { session: 'plan shell B' })
      return /got:/.test(r.text) ? r : null
    }, 90000, 1000)
    t.check('step B ran in shell B after A finished (the answer of A pasted in)', !!typedB)
    const doneAll = await waitFor(async () => {
      const r = await tool('plan_status', { id: planId })
      return /^Plan \w+: (done|failed)\b/.test(r.text) ? r : null
    }, 120000, 2000)
    t.check('the plan ends (done or failed) and plan_status shows it', !!doneAll, doneAll ? doneAll.text.slice(0, 300) : (await tool('plan_status', { id: planId })).text.slice(0, 400))
    const list = await tool('plan_status')
    t.check('plan_status without an id lists the plan', !list.error && list.text.includes(planId), list.text.slice(0, 200))

    // ---- turning plans off cancels a running plan
    const running = await tool('plan_create', { goal: 'plan to cancel', steps: [
      { id: 'a', title: 'a', prompt: 'echo first', session: 'plan shell A' },
      { id: 'b', title: 'b', prompt: 'echo second', session: 'plan shell A', depends_on: ['a'] }] })
    const id2 = (running.text.match(/\b([0-9a-f]{8})\b/) || [])[1]
    await tool('update_settings', { changes: { jarvis: { plansEnabled: false } } })
    const cancelled = await waitFor(async () => {
      const r = await tool('plan_status', { id: id2 })
      return /cancelled/i.test(r.text.split('\n')[0]) ? r : null
    }, 20000, 1000)
    t.check('turning task plans off cancels the running plan', !!cancelled, (await tool('plan_status', { id: id2 })).text.slice(0, 300))
    const offAgain = await tool('plan_create', { goal: 'x', steps: [{ id: 'a', title: 'a', prompt: 'echo hi', session: 'plan shell A' }] })
    t.check('plan_create refuses again once switched off', offAgain.error, offAgain.text.slice(0, 120))
    const cancelDone = await tool('plan_cancel', { id: planId })
    t.check('plan_cancel on a finished plan just returns it, unchanged', !cancelDone.error && /done/.test(cancelDone.text), cancelDone.text.slice(0, 160))
    const noPlan = await tool('plan_cancel', { id: 'ffffffff' })
    t.check('plan_cancel with an unknown id is an error', noPlan.error, noPlan.text.slice(0, 120))
    void shellA
  } catch (error) {
    t.check('e2e ran without an exception', false, error && error.stack ? error.stack : String(error))
  } finally {
    if (app) app.kill()
    fs.rmSync(rootDir, { recursive: true, force: true })
    process.exit(t.summary() === 0 ? 0 : 1)
  }
}

main()
