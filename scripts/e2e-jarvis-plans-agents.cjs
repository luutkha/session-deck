// E2E (D80): Jarvis task plans with REAL OpenCode agent sessions, in the real built app. The steps start/speak to
// OpenCode sessions running the cheap flash model; the Jarvis tools are called directly over the MCP endpoint (the way
// a real Jarvis calls them). Checks: a plan creates a session it starts and whose answer it keeps; a second step in an
// EXISTING session gets the first answer pasted in ({{a}}) and must answer in its own NEW turn; two such steps run in
// parallel; a bad cwd fails the step and skips its dependent; plan_cancel and "plans off" cancel a running plan and
// start nothing more while the running session is left alive; and a prompt queued behind a running turn must not make
// the step "done" with the EARLIER turn's answer.
// Run: npx electron-vite build && node scripts/e2e-jarvis-plans-agents.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { ROOT, sleep, waitFor, makeChecker, launchApp, stopOpencodeService } = require('./e2e-lib.cjs')

const PORT = 9510
const MODEL = 'opencode-go/deepseek-v4.1-flash'
const BAD_CWD = 'C:\\definitely\\not\\here'
const END = /: (done|failed|cancelled)\b/

async function main() {
  stopOpencodeService()
  const t = makeChecker()
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-e2e-plans-agents-'))
  const userData = path.join(rootDir, 'userdata')
  fs.mkdirSync(userData)
  const logFile = path.join(userData, 'jarvis', 'actions.log')
  let app
  const created = new Set()
  try {
    app = await launchApp({ port: PORT, userData })
    await sleep(1500)
    const cfgFile = path.join(userData, 'jarvis', 'mcp.json')
    await waitFor(() => (fs.existsSync(cfgFile) ? true : null), 20000, 300)
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')).mcpServers.sessiondeck
    let rpcId = 0
    const tool = async (name, args = {}) => {
      try {
        const res = await fetch(cfg.url, { method: 'POST', headers: { ...cfg.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) })
        const body = await res.json()
        if (body.error !== undefined) return { text: JSON.stringify(body.error), error: true }
        const result = body.result
        return { text: result.content?.[0]?.text ?? '', error: result.isError === true }
      } catch (error) {
        return { text: error && error.message ? error.message : String(error), error: true }
      }
    }
    const store = () => app.evaluate('window.api.getStore()')
    const sessionNamed = async (name) => (await store()).data.sessions.find((s) => s.name === name)
    const runtimeOf = async (id) => (await store()).runtime.find((r) => r.sessionId === id)
    const waitSession = (name, ms = 45000) => waitFor(() => sessionNamed(name), ms, 400)
    const readLog = () => {
      try {
        return fs.readFileSync(logFile, 'utf8').split('\n').filter((line) => line.trim().length > 0).map((line) => {
          try { return JSON.parse(line) } catch { return null }
        }).filter((entry) => entry !== null)
      } catch {
        return []
      }
    }
    /** The moment this plan step's prompt was typed (sendPrompt resolved), in ms; NaN when no line yet. */
    const stepPromptAt = (planId, stepId) => {
      const line = readLog().find((entry) => entry.tool === 'plan step prompt' && entry.detail.startsWith(`${planId}/${stepId}:`))
      return line === undefined ? Number.NaN : Date.parse(line.at)
    }
    const planIdOf = (text) => (text.match(/^Plan ([0-9a-f]{8}):/m) || [])[1]
    const statusOf = async (id) => tool('plan_status', { id })
    const firstLine = (r) => r.text.split('\n')[0] ?? ''
    const planStatus = (r) => (firstLine(r).match(/: (\w+)/) || [])[1] ?? ''
    const stepLine = (text, id) => text.split('\n').find((line) => line.startsWith(`- ${id} "`)) ?? ''
    const stepStatus = (text, id) => (stepLine(text, id).match(/: (pending|running|done|failed|skipped)\b/) || [])[1] ?? ''
    /** A done step's answer as plan_status prints it (clip flattens it to one line). */
    const answerOf = (text, id) => {
      const lines = text.split('\n')
      const at = lines.findIndex((line) => line.startsWith(`- ${id} "`))
      if (at < 0) return ''
      const next = lines[at + 1] ?? ''
      return next.startsWith('  answer: ') ? next.slice('  answer: '.length).trim() : ''
    }
    const waitPlanEnd = (id, ms = 180000) => waitFor(async () => {
      const r = await statusOf(id)
      return END.test(firstLine(r)) ? r : null
    }, ms, 700)
    const planText = async (r, id) => (r ? r.text : (await statusOf(id)).text)
    const typeInto = async (id, text) => {
      await app.evaluate(`window.api.ptyWrite(${JSON.stringify(id)}, ${JSON.stringify(text)})`)
      await sleep(500)
      await app.evaluate(`window.api.ptyWrite(${JSON.stringify(id)}, '\\r')`)
    }

    // ---- task plans on (they are OFF by default; the settings tool is the same path a Jarvis uses)
    const on = await tool('update_settings', { changes: { jarvis: { plansEnabled: true } } })
    t.check('task plans can be switched on', !on.error, on.text.slice(0, 160))

    // ================= 1. plan creates an OpenCode session, starts it, keeps its answer
    const c1 = await tool('plan_create', { goal: 'one OpenCode session answers one word', steps: [
      { id: 'a', title: 'ask the new OpenCode session for BANANA', prompt: 'reply with exactly this word and nothing else: BANANA',
        new_session: { name: 'plan oc A', cwd: ROOT, agent: 'opencode', model: MODEL } }] })
    const p1 = planIdOf(c1.text)
    t.check('1: plan_create accepts a step that creates an OpenCode session', !c1.error && p1 !== undefined && /^Plan .*: running/.test(firstLine(c1)), c1.text.split('\n')[0])
    const sA = await waitSession('plan oc A')
    const runA = sA === undefined ? undefined : await runtimeOf(sA.id)
    t.check('1: new SessionDeck session "plan oc A" appears and starts', sA !== undefined && runA?.run === 'running', sA === undefined ? 'no session' : `run=${runA?.run} activity=${runA?.activity}`)
    const r1 = p1 === undefined ? null : await waitPlanEnd(p1, 150000)
    const a1 = r1 ? answerOf(r1.text, 'a') : ''
    t.check('1: the plan ends done and the step answer contains BANANA', r1 !== null && planStatus(r1) === 'done' && /banana/i.test(a1), r1 ? `status=${planStatus(r1)} answer=${JSON.stringify(a1.slice(0, 120))}` : (await statusOf(p1)).text.split('\n')[0])
    t.check('1: the step was not judged from an empty/stale answer', r1 !== null && a1.length > 0 && !/no answer was found/i.test(a1), JSON.stringify(a1.slice(0, 120)))
    const aSession = await sessionNamed('plan oc A')
    t.check('1: the session has an OpenCode conversation (it really replied)', aSession !== undefined && /^ses_/.test(aSession.opencodeSessionId || ''), String(aSession && aSession.opencodeSessionId))

    // ================= 2. second step in the EXISTING session, fed with {{a}}
    const c2 = await tool('plan_create', { goal: 'paste an answer into an existing session', steps: [
      { id: 'a', title: 'new session answers PINEAPPLE', prompt: 'reply with exactly one word: PINEAPPLE',
        new_session: { name: 'plan oc B', cwd: ROOT, agent: 'opencode', model: MODEL } },
      { id: 'b', title: 'existing session lowercases it', prompt: 'Here is a word: {{a}}. Reply with that same word in lower case and nothing else.',
        session: 'plan oc A', depends_on: ['a'] }] })
    const p2 = planIdOf(c2.text)
    t.check('2: a two-step plan is created (new session, then an existing one)', !c2.error && p2 !== undefined, c2.text.split('\n')[0])
    const r2 = p2 === undefined ? null : await waitPlanEnd(p2, 180000)
    const a2 = r2 ? answerOf(r2.text, 'b') : ''
    const line2 = r2 ? stepLine(r2.text, 'b') : ''
    t.check('2: the plan ends done', r2 !== null && planStatus(r2) === 'done', r2 ? r2.text.split('\n')[0] : (await statusOf(p2)).text.split('\n')[0])
    t.check('2: step b ran in the EXISTING session "plan oc A"', /session "plan oc A"/.test(line2), line2.slice(0, 160))
    t.check('2: step b pasted {{a}} in and answered "pineapple"', /pineapple/i.test(a2), JSON.stringify(a2.slice(0, 120)))
    t.check('2: step b did NOT reuse check 1\'s stale answer "banana"', !/banana/i.test(a2), JSON.stringify(a2.slice(0, 120)))

    // ================= 3. two new-session steps run in parallel; a third waits for both
    const c3 = await tool('plan_create', { goal: 'two sessions in parallel then one more step', steps: [
      { id: 'c', title: 'new session answers GRAPE', prompt: 'reply with exactly one word: GRAPE',
        new_session: { name: 'plan oc C', cwd: ROOT, agent: 'opencode', model: MODEL } },
      { id: 'd', title: 'new session answers MANGO', prompt: 'reply with exactly one word: MANGO',
        new_session: { name: 'plan oc D', cwd: ROOT, agent: 'opencode', model: MODEL } },
      { id: 'e', title: 'both words together', prompt: 'Here are two words: {{c}} and {{d}}. Reply with both words and nothing else.',
        session: 'plan oc A', depends_on: ['c', 'd'] }] })
    const p3 = planIdOf(c3.text)
    t.check('3: a three-step plan is created', !c3.error && p3 !== undefined, c3.text.split('\n')[0])
    const both3 = p3 === undefined ? null : await waitFor(async () => {
      const r = await statusOf(p3)
      return stepStatus(r.text, 'c') === 'running' && stepStatus(r.text, 'd') === 'running' ? r : null
    }, 90000, 300)
    t.check('3: steps c and d were running at the same moment', both3 !== null, both3 ? 'both "running" in one plan_status' : 'never both running')
    const r3 = p3 === undefined ? null : await waitPlanEnd(p3, 180000)
    const a3 = r3 ? answerOf(r3.text, 'e') : ''
    const cAt = p3 === undefined ? Number.NaN : stepPromptAt(p3, 'c')
    const dAt = p3 === undefined ? Number.NaN : stepPromptAt(p3, 'd')
    const gap = Math.abs(cAt - dAt)
    t.check('3: the two parallel steps started within 10 s of each other', Number.isFinite(gap) && gap <= 10000, `gap=${Number.isFinite(gap) ? `${gap} ms` : 'no timestamps'}`)
    t.check('3: the plan ends done and step e has both words', r3 !== null && planStatus(r3) === 'done' && /grape/i.test(a3) && /mango/i.test(a3), r3 ? `status=${planStatus(r3)} answer=${JSON.stringify(a3.slice(0, 140))}` : (await statusOf(p3)).text.split('\n')[0])

    // ================= 4. a bad cwd fails its step, the dependent is skipped, the plan fails
    const c4 = await tool('plan_create', { goal: 'a new session in a folder that does not exist', steps: [
      { id: 'a', title: 'new session in a missing folder', prompt: 'say hi',
        new_session: { name: 'plan oc bad', cwd: BAD_CWD, agent: 'opencode', model: MODEL } },
      { id: 'b', title: 'depends on the missing session', prompt: 'say hi again', session: 'plan oc A', depends_on: ['a'] }] })
    const p4 = planIdOf(c4.text)
    if (c4.error || p4 === undefined) {
      t.check('4: plan_create refused the bad cwd up front (accepted behaviour), no plan was left hanging', true, c4.text.slice(0, 180))
      t.check('4: no session "plan oc bad" was created', (await sessionNamed('plan oc bad')) === undefined)
    } else {
      const r4 = await waitPlanEnd(p4, 40000)
      const text4 = await planText(r4, p4)
      t.check('4: plan_create accepted it and the step failed on the missing folder', /folder not found/i.test(stepLine(text4, 'a')), stepLine(text4, 'a').slice(0, 190))
      t.check('4: the dependent step was skipped with the reason', stepStatus(text4, 'b') === 'skipped' && /depends on a which failed/.test(stepLine(text4, 'b')), stepLine(text4, 'b').slice(0, 190))
      t.check('4: the plan ends failed (no hang)', r4 !== null && planStatus(r4) === 'failed', r4 ? r4.text.split('\n')[0] : (await statusOf(p4)).text.split('\n')[0])
      t.check('4: no new session was made for either step', (await sessionNamed('plan oc bad')) === undefined)
    }

    // ================= 5. plan_cancel while step 1 runs: step 2 is skipped and never starts
    const c5 = await tool('plan_create', { goal: 'cancel a running plan', steps: [
      { id: 'a', title: 'count slowly', prompt: 'count slowly from 1 to 200, one number per line',
        new_session: { name: 'plan oc count', cwd: ROOT, agent: 'opencode', model: MODEL } },
      { id: 'b', title: 'after the count', prompt: 'reply with exactly one word: AFTER', depends_on: ['a'],
        new_session: { name: 'plan oc cancel second', cwd: ROOT, agent: 'opencode', model: MODEL } }] })
    const p5 = planIdOf(c5.text)
    t.check('5: the counting plan is created', !c5.error && p5 !== undefined, c5.text.split('\n')[0])
    const typed5 = p5 === undefined ? null : await waitFor(() => (Number.isFinite(stepPromptAt(p5, 'a')) ? true : null), 90000, 400)
    const st5 = p5 === undefined ? { text: '' } : await statusOf(p5)
    t.check('5: step a is running when plan_cancel is called', typed5 !== null && stepStatus(st5.text, 'a') === 'running', stepLine(st5.text, 'a').slice(0, 160))
    const cancel5 = await tool('plan_cancel', { id: p5 })
    const after5 = await statusOf(p5)
    const text5 = after5.text
    t.check('5: plan_cancel reports it cancelled the plan', !cancel5.error && /Cancelled plan/.test(cancel5.text), cancel5.text.slice(0, 140))
    t.check('5: the plan is cancelled and step b is skipped with "cancelled"', planStatus(after5) === 'cancelled' && stepStatus(text5, 'b') === 'skipped' && /problem: cancelled/.test(stepLine(text5, 'b')), stepLine(text5, 'b').slice(0, 190))
    const count5 = await sessionNamed('plan oc count')
    const countRun5 = count5 === undefined ? undefined : await runtimeOf(count5.id)
    t.check('5: the running step\'s session is left alive (not closed)', count5 !== undefined && count5.closedAt === undefined && countRun5?.run === 'running', count5 === undefined ? 'no session' : `run=${countRun5?.run} activity=${countRun5?.activity} closedAt=${count5.closedAt}`)
    await sleep(20000)
    const late5 = await statusOf(p5)
    const countAfter5 = await sessionNamed('plan oc count')
    const countRunAfter5 = countAfter5 === undefined ? undefined : await runtimeOf(countAfter5.id)
    t.check('5: after 20 s the second step created no session', (await sessionNamed('plan oc cancel second')) === undefined, 'checked "plan oc cancel second"')
    t.check('5: the plan stays cancelled with step b skipped', planStatus(late5) === 'cancelled' && stepStatus(late5.text, 'b') === 'skipped', late5.text.split('\n')[0])
    t.check('5: the first session is still not closed after 20 s', countAfter5 !== undefined && countAfter5.closedAt === undefined, countAfter5 === undefined ? 'no session' : `run=${countRunAfter5?.run} sleeping=${countRunAfter5?.sleeping} closedAt=${countAfter5.closedAt}`)

    // ================= 6. turning plans off while a step runs cancels the plan
    const c6 = await tool('plan_create', { goal: 'turning plans off cancels this plan', steps: [
      { id: 'a', title: 'count slowly', prompt: 'count slowly from 1 to 200, one number per line',
        new_session: { name: 'plan oc count off', cwd: ROOT, agent: 'opencode', model: MODEL } },
      { id: 'b', title: 'after the count', prompt: 'reply with exactly one word: AFTER', depends_on: ['a'],
        new_session: { name: 'plan oc off second', cwd: ROOT, agent: 'opencode', model: MODEL } }] })
    const p6 = planIdOf(c6.text)
    t.check('6: the counting plan is created', !c6.error && p6 !== undefined, c6.text.split('\n')[0])
    const typed6 = p6 === undefined ? null : await waitFor(() => (Number.isFinite(stepPromptAt(p6, 'a')) ? true : null), 90000, 400)
    const off6 = await tool('update_settings', { changes: { jarvis: { plansEnabled: false } } })
    const r6 = p6 === undefined ? null : await waitFor(async () => {
      const r = await statusOf(p6)
      return planStatus(r) === 'cancelled' ? r : null
    }, 30000, 700)
    t.check('6: turning task plans off records it', !off6.error, off6.text.slice(0, 140))
    t.check('6: the running plan is cancelled and step b skipped ("turned off")', typed6 !== null && r6 !== null && stepStatus(r6.text, 'b') === 'skipped' && /turned off/i.test(stepLine(r6.text, 'b')), r6 ? stepLine(r6.text, 'b').slice(0, 190) : (await statusOf(p6)).text.split('\n')[0])
    await sleep(20000)
    const countOff = await sessionNamed('plan oc count off')
    const countRunOff = countOff === undefined ? undefined : await runtimeOf(countOff.id)
    t.check('6: after 20 s the second step created no session', (await sessionNamed('plan oc off second')) === undefined, 'checked "plan oc off second"')
    t.check('6: the first session is left alive (not closed)', countOff !== undefined && countOff.closedAt === undefined && countRunOff?.run === 'running', countOff === undefined ? 'no session' : `run=${countRunOff?.run} activity=${countRunOff?.activity} closedAt=${countOff.closedAt}`)
    const backOn = await tool('update_settings', { changes: { jarvis: { plansEnabled: true } } })
    t.check('6: task plans can be switched back on', !backOn.error, backOn.text.slice(0, 120))

    // ================= 7. a prompt queued behind a running turn must not use the earlier turn's answer
    const a7Session = await sessionNamed('plan oc A')
    t.check('7: session "plan oc A" is idle and running before the check', a7Session !== undefined && (await runtimeOf(a7Session.id))?.run === 'running' && (await runtimeOf(a7Session.id))?.activity === 'finished', JSON.stringify(await runtimeOf(a7Session.id)))
    await typeInto(a7Session.id, 'Start your reply with the word ZEBRA on its own line, then count slowly from 1 to 80, one number per line.')
    const busy7 = await waitFor(async () => ((await runtimeOf(a7Session.id))?.activity === 'working' ? true : null), 30000, 300)
    t.check('7: the session is busy when the plan is created', busy7 !== null, JSON.stringify(await runtimeOf(a7Session.id)))
    const c7 = await tool('plan_create', { goal: 'a prompt queued behind a running turn', steps: [
      { id: 'a', title: 'queued prompt', prompt: 'reply with exactly one word: KIWI', session: 'plan oc A' }] })
    const p7 = planIdOf(c7.text)
    t.check('7: the plan on the busy session is created', !c7.error && p7 !== undefined, c7.text.split('\n')[0])
    const queued7 = await waitFor(async () => {
      const session = await sessionNamed('plan oc A')
      return (session?.queue ?? []).some((item) => /KIWI/.test(item.text)) ? session : null
    }, 20000, 300)
    t.check('7: the plan prompt was queued behind the running turn', queued7 !== null, queued7 ? `queue=${(queued7.queue ?? []).length}` : 'no queued item')
    const r7 = p7 === undefined ? null : await waitPlanEnd(p7, 300000)
    const a7 = r7 ? answerOf(r7.text, 'a') : ''
    const done7 = r7 !== null && planStatus(r7) === 'done'
    t.check('7: a queued step never ends done with an answer that is not its own KIWI', !(done7 && !/kiwi/i.test(a7)), r7 ? `status=${planStatus(r7)} answer=${JSON.stringify(a7.slice(0, 160))}` : 'still running/failed')
    t.check('7: the earlier turn\'s ZEBRA answer never became the step answer', !/zebra/i.test(a7), JSON.stringify(a7.slice(0, 160)))
    t.check('7: the plan does not hang while its prompt is queued (ends on its own)', r7 !== null, r7 ? r7.text.split('\n')[0] : (await statusOf(p7)).text.split('\n')[0])
    const final7 = await statusOf(p7)
    console.log(`   check 7 evidence: ${final7.text.split('\n').slice(0, 3).join(' | ').slice(0, 400)}`)
  } catch (error) {
    t.check('e2e ran without an exception', false, error && error.stack ? error.stack : String(error))
  } finally {
    // The OpenCode conversations this run made live in the user's real OpenCode store: remove them (best effort).
    try {
      const st = app ? await store() : null
      for (const x of st ? st.data.sessions : []) if (x.agent === 'opencode' && /^ses_[A-Za-z0-9]+$/.test(x.opencodeSessionId || '')) created.add(x.opencodeSessionId)
    } catch { /* app gone */ }
    if (app) app.kill()
    stopOpencodeService()
    for (const id of created) { try { require('node:child_process').execFileSync('opencode', ['session', 'delete', id], { shell: true, stdio: 'ignore', timeout: 20000 }) } catch { /* best effort */ } }
    try { fs.rmSync(rootDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }) } catch { /* a shell or the app may still hold the folder: leave it to the OS temp cleanup */ }
    process.exit(t.summary() === 0 ? 0 : 1)
  }
}

main()
