// D80: Jarvis task plans — a goal split into steps that run in sessions, in order or in parallel. A step starts when
// every step it depends on is done, and its answer can be pasted into a later prompt as {{stepId}}. Everything lives in
// memory: a restart of the app forgets every plan. A timer calls tick() every 5 s; create() runs one tick right away.
// All side effects (sessions, prompts, Jarvis, errors) are injected so unit tests use fakes.
import { QUEUE_TEXT_MAX } from '../../shared/types'
import {
  PLAN_ACTIVE_MAX,
  PLAN_ANSWER_MAX,
  PLAN_GOAL_MAX,
  PLAN_PROMPT_MAX,
  PLAN_RUNNING_STEPS_MAX,
  PLAN_STEPS_MAX,
  PLAN_STEP_TIMEOUT_MS,
  PLAN_TITLE_MAX,
  type Plan,
  type PlanInput,
  type PlanService,
  type PlanServiceDeps,
  type PlanStep,
  type PlanStatus
} from './planTypes'

const PLAN_TICK_MS = 5000
/** A prompt that never produced a turn must not hang forever: after this long a 'finished' phase is accepted as done. */
const PLAN_FINISHED_GRACE_MS = 20_000
/** How much of each done step's answer goes into the message Jarvis gets when the plan ends. */
const PLAN_ANSWER_SUMMARY_MAX = 600
const PLAN_NEW_SESSION_NAME_MAX = 60
const PLANS_KEPT_MAX = 20
const STEP_ID_PATTERN = /^[A-Za-z0-9_-]{1,20}$/
const NO_ANSWER = '(no answer was found)'
const WAITING_PROBLEM = 'waiting for you in that session'
const TURNED_OFF_PROBLEM = 'Task plans were turned off'

interface StepRun {
  /**
   * When sendPrompt RESOLVED (the text was typed or queued), ms. Undefined while the call is still in flight (it may wake
   * a session and wait for it to be ready for a minute): nothing is judged until then.
   */
  sentAt?: number
  /** The tick in which the prompt was typed; 'finished' is never judged in that same tick. */
  sentTick?: number
  /** True once a tick saw the session 'working' after the prompt was typed. */
  sawWorking: boolean
}

/** What a pasted answer must at least leave room for; below this the prompt is refused instead of pasting a stub. */
const PASTE_MIN_CHARS = 40
/** The message to Jarvis must stay under the prompt limit of send_prompt (QUEUE_TEXT_MAX), with some margin. */
const DELIVER_MAX_CHARS = QUEUE_TEXT_MAX - 100
const PLACEHOLDER = /\{\{([^{}]+)\}\}/g

/**
 * The step's prompt with {{id}} replaced by that dependency's answer, kept within QUEUE_TEXT_MAX: when the answers do not
 * fit they are cut (with a note) and share the room equally. Throws when even a stub would not fit.
 */
export function fillPrompt(prompt: string, answers: ReadonlyMap<string, string>): string {
  const slots = [...prompt.matchAll(PLACEHOLDER)].length
  if (slots === 0) return prompt
  const fixed = prompt.replace(PLACEHOLDER, '').length
  const room = Math.floor((QUEUE_TEXT_MAX - fixed) / slots)
  if (room < PASTE_MIN_CHARS) throw new Error('the prompt is too long once the earlier answers are pasted in')
  return prompt.replace(PLACEHOLDER, (_whole: string, id: string) => {
    const answer = answers.get(id) ?? ''
    return answer.length <= room ? answer : `${answer.slice(0, Math.max(0, room - 8))} (cut)`
  })
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function withoutProblem(step: PlanStep): PlanStep {
  if (step.problem === undefined) return step
  const { problem, ...rest } = step
  void problem
  return rest
}

function skippedStep(step: PlanStep, problem: string, at: number): PlanStep {
  return { ...step, status: 'skipped', problem, finishedAt: at }
}

function failedStep(step: PlanStep, problem: string, at: number): PlanStep {
  return { ...step, status: 'failed', problem, finishedAt: at }
}

/** Checks a plan before it is created (pure apart from findSession). Throws an Error with a clear message. */
export function validatePlanInput(input: PlanInput, findSession: PlanServiceDeps['findSession']): void {
  const goal = input.goal.trim()
  if (goal.length === 0 || goal.length > PLAN_GOAL_MAX) {
    throw new Error(`The goal must be 1 to ${PLAN_GOAL_MAX} characters.`)
  }
  const steps = input.steps
  if (steps.length === 0 || steps.length > PLAN_STEPS_MAX) {
    throw new Error(`A plan needs 1 to ${PLAN_STEPS_MAX} steps; it has ${steps.length}.`)
  }

  const ids = new Set<string>()
  for (const step of steps) {
    if (!STEP_ID_PATTERN.test(step.id)) {
      throw new Error(`Step id "${step.id}" is not valid; use 1 to 20 letters, digits, - or _.`)
    }
    if (ids.has(step.id)) throw new Error(`Step id "${step.id}" is used by more than one step.`)
    ids.add(step.id)
  }

  for (const step of steps) {
    const title = step.title.trim()
    if (title.length === 0 || title.length > PLAN_TITLE_MAX) {
      throw new Error(`Step "${step.id}": the title must be 1 to ${PLAN_TITLE_MAX} characters.`)
    }
    const prompt = step.prompt.trim()
    if (prompt.length === 0 || prompt.length > PLAN_PROMPT_MAX) {
      throw new Error(`Step "${step.id}": the prompt must be 1 to ${PLAN_PROMPT_MAX} characters.`)
    }
    for (const dep of step.dependsOn) {
      if (dep === step.id) throw new Error(`Step "${step.id}" depends on itself.`)
      if (!ids.has(dep)) throw new Error(`Step "${step.id}" depends on "${dep}", which is not a step in this plan.`)
    }
    const placeholders = [...step.prompt.matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => match[1])
    for (const name of placeholders) {
      if (!step.dependsOn.includes(name)) {
        throw new Error(`Step "${step.id}" uses {{${name}}} in its prompt, but "${name}" is not one of its dependencies.`)
      }
    }
    if (step.target.kind === 'existing') {
      if (findSession(step.target.session) === null) {
        throw new Error(`Session "${step.target.session}" was not found; no step was created.`)
      }
    } else {
      const name = step.target.name.trim()
      if (name.length === 0 || name.length > PLAN_NEW_SESSION_NAME_MAX) {
        throw new Error(`Step "${step.id}": a new session needs a name of 1 to ${PLAN_NEW_SESSION_NAME_MAX} characters.`)
      }
    }
  }

  // A cycle is found with a depth-first walk; dependency ids were checked to exist above.
  const byId = new Map(steps.map((step) => [step.id, step] as const))
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (id: string, path: readonly string[]): void => {
    const seen = state.get(id)
    if (seen === 'done') return
    if (seen === 'visiting') {
      const cycle = [...path.slice(path.indexOf(id)), id].join(' -> ')
      throw new Error(`The steps depend on each other in a cycle: ${cycle}.`)
    }
    state.set(id, 'visiting')
    const step = byId.get(id)
    if (step !== undefined) for (const dep of step.dependsOn) visit(dep, [...path, id])
    state.set(id, 'done')
  }
  for (const step of steps) visit(step.id, [])
}

export function createPlanService(deps: PlanServiceDeps): PlanService {
  let plans: readonly Plan[] = []
  let clockTicks = 0
  let ticking = false
  let timer: ReturnType<typeof setInterval> | null = null
  const runs = new Map<string, StepRun>()

  const runKey = (planId: string, stepId: string): string => `${planId}/${stepId}`

  function find(id: string): Plan {
    const plan = plans.find((candidate) => candidate.id === id)
    if (plan === undefined) throw new Error(`No plan with id ${id}.`)
    return plan
  }

  function replace(updated: Plan): Plan {
    plans = plans.map((plan) => (plan.id === updated.id ? updated : plan))
    return updated
  }

  function stepOf(plan: Plan, id: string): PlanStep | undefined {
    return plan.steps.find((step) => step.id === id)
  }

  function updateStep(plan: Plan, stepId: string, change: (step: PlanStep) => PlanStep): Plan {
    return replace({ ...plan, steps: plan.steps.map((step) => (step.id === stepId ? change(step) : step)) })
  }

  function fail(plan: Plan, stepId: string, problem: string): Plan {
    return updateStep(plan, stepId, (step) => failedStep(step, problem, deps.now()))
  }

  /** Steps running right now in plans that still run; a cancelled plan's steps are left alone and do not hold slots. */
  function runningSteps(): number {
    let count = 0
    for (const plan of plans) {
      if (plan.status !== 'running') continue
      for (const step of plan.steps) if (step.status === 'running') count += 1
    }
    return count
  }

  function forgetRuns(plan: Plan): void {
    for (const step of plan.steps) runs.delete(runKey(plan.id, step.id))
  }

  /** Keeps the newest PLANS_KEPT_MAX plans; the oldest finished (or cancelled) ones go first. */
  function prunePlans(): void {
    while (plans.length > PLANS_KEPT_MAX) {
      let drop = -1
      for (let index = plans.length - 1; index >= 0; index -= 1) {
        if (plans[index].status !== 'running') {
          drop = index
          break
        }
      }
      if (drop === -1) return
      const gone = plans[drop]
      forgetRuns(gone)
      plans = plans.filter((_, index) => index !== drop)
    }
  }

  /** One running step: finish it, fail it, or wait. Never judges 'finished' in the tick that sent the prompt. */
  async function judgeRunning(plan: Plan, step: PlanStep): Promise<Plan> {
    const sessionId = step.sessionId
    if (sessionId === undefined) return fail(plan, step.id, 'the session was not recorded')

    if (step.startedAt !== undefined && deps.now() - step.startedAt > PLAN_STEP_TIMEOUT_MS) {
      return fail(plan, step.id, 'timed out')
    }
    // The prompt is still being typed (the session is starting or waking): nothing to judge yet.
    const sent = runs.get(runKey(plan.id, step.id))
    if (sent !== undefined && sent.sentAt === undefined) return plan

    const phase = deps.sessionPhase(sessionId)
    if (phase === 'gone') return fail(plan, step.id, 'the session was closed, stopped or put to sleep')
    if (phase === 'waiting') {
      return updateStep(plan, step.id, (current) =>
        current.problem === WAITING_PROBLEM ? current : { ...current, problem: WAITING_PROBLEM }
      )
    }
    if (phase === 'working') {
      const run = runs.get(runKey(plan.id, step.id))
      if (run !== undefined && run.sentTick !== undefined && clockTicks > run.sentTick) run.sawWorking = true
      return updateStep(plan, step.id, withoutProblem)
    }

    // 'finished': only on a later tick, and only once it was seen working or the prompt had time to produce a turn.
    const run = runs.get(runKey(plan.id, step.id))
    if (run !== undefined && run.sentTick !== undefined && clockTicks <= run.sentTick) return plan
    const promptAt = run?.sentAt ?? step.startedAt ?? deps.now()
    if (run?.sawWorking !== true && deps.now() - promptAt < PLAN_FINISHED_GRACE_MS) return plan
    let text: string | null = null
    try {
      text = await deps.lastAnswer(sessionId)
    } catch (error) {
      deps.onError('jarvis plan answer', error)
    }
    const current = plans.find((candidate) => candidate.id === plan.id)
    if (current === undefined || current.status !== 'running') return current ?? plan
    const answer = text === null || text.trim().length === 0 ? NO_ANSWER : text.slice(0, PLAN_ANSWER_MAX)
    const updated = updateStep(current, step.id, (stepNow) => ({
      ...withoutProblem(stepNow),
      status: 'done',
      answer,
      finishedAt: deps.now()
    }))
    deps.log('plan step', `${updated.id}/${step.id}: ${answer}`)
    return updated
  }

  /** Starts a pending step in its session. Resolving or sending errors mark the step failed instead of throwing. */
  function startStep(plan: Plan, step: PlanStep): Plan {
    let session: { readonly id: string; readonly name: string }
    try {
      if (step.target.kind === 'existing') {
        const found = deps.findSession(step.target.session)
        if (found === null) throw new Error(`Session "${step.target.session}" was not found; the step was not started.`)
        session = found
      } else {
        session = deps.createSession(step.target)
      }
    } catch (error) {
      return fail(plan, step.id, message(error))
    }

    let prompt: string
    try {
      const answers = new Map<string, string>()
      for (const depId of step.dependsOn) answers.set(depId, stepOf(plan, depId)?.answer ?? '')
      prompt = fillPrompt(step.prompt, answers)
    } catch (error) {
      return fail(plan, step.id, message(error))
    }

    let sending: Promise<string>
    try {
      sending = deps.sendPrompt(session.id, prompt)
    } catch (error) {
      return fail(plan, step.id, message(error))
    }
    const startedAt = deps.now()
    const key = runKey(plan.id, step.id)
    runs.set(key, { sawWorking: false })
    const next = updateStep(plan, step.id, (current) => ({
      ...current,
      status: 'running',
      sessionId: session.id,
      sessionName: session.name,
      startedAt
    }))
    sending
      .then((text) => {
        const run = runs.get(key)
        if (run !== undefined) {
          run.sentAt = deps.now()
          run.sentTick = clockTicks
        }
        deps.log('plan step prompt', `${plan.id}/${step.id}: ${text}`)
      })
      .catch((error: unknown) => failLate(plan.id, step.id, message(error)))
    return next
  }

  /** A sendPrompt that rejects later: fail the step if it is still waiting or running. */
  function failLate(planId: string, stepId: string, problem: string): void {
    const plan = plans.find((candidate) => candidate.id === planId)
    if (plan === undefined || plan.status !== 'running') return
    const step = stepOf(plan, stepId)
    if (step === undefined || (step.status !== 'running' && step.status !== 'pending')) return
    runs.delete(runKey(planId, stepId))
    fail(plan, stepId, problem)
  }

  function summaryOf(plan: Plan): string {
    const head: string[] = [`[Plan finished] ${plan.goal} (${plan.status})`, '']
    for (const step of plan.steps) {
      const parts = [step.id, step.title, step.status]
      if (step.sessionName !== undefined) parts.push(step.sessionName)
      if (step.problem !== undefined) parts.push(step.problem)
      head.push(`- ${parts.join(' | ')}`)
    }
    const tail = 'Report to the user in plain words what was done and what failed.'
    const answered = plan.steps.filter((step) => step.status === 'done')
    // The whole message must fit send_prompt's limit: the answers share what the list and the closing line leave over.
    const fixed = head.join('\n').length + tail.length + answered.length * 40 + 8
    const share = Math.floor((DELIVER_MAX_CHARS - fixed) / Math.max(1, answered.length))
    const each = Math.max(0, Math.min(PLAN_ANSWER_SUMMARY_MAX, share))
    const lines = [...head]
    if (answered.length > 0) {
      lines.push('')
      for (const step of answered) {
        lines.push(`Answer from ${step.id} (${step.title}):`)
        const answer = step.answer ?? NO_ANSWER
        lines.push(answer.length <= each ? answer : `${answer.slice(0, each)} (cut)`)
        lines.push('')
      }
    }
    lines.push(tail)
    const text = lines.join('\n')
    return text.length <= DELIVER_MAX_CHARS ? text : `${text.slice(0, DELIVER_MAX_CHARS - 8)} (cut)`
  }

  function finishIfOver(plan: Plan): void {
    if (plan.steps.some((step) => step.status === 'pending' || step.status === 'running')) return
    const status: PlanStatus = plan.steps.every((step) => step.status === 'done') ? 'done' : 'failed'
    const finished = replace({ ...plan, status, finishedAt: deps.now() })
    forgetRuns(finished)
    deps.log('plan finished', `${finished.id}: ${status}`)
    deps.deliver(summaryOf(finished)).catch((error: unknown) => deps.onError(`jarvis plan ${finished.id} deliver`, error))
  }

  /** The toggle went off: every running plan is cancelled; its pending steps are skipped and nothing is delivered. */
  function cancelAllOff(): void {
    const at = deps.now()
    for (const plan of [...plans]) {
      if (plan.status !== 'running') continue
      const steps = plan.steps.map((step) =>
        step.status === 'pending' ? skippedStep(step, TURNED_OFF_PROBLEM, at) : step
      )
      const cancelled = replace({ ...plan, status: 'cancelled', finishedAt: at, steps })
      forgetRuns(cancelled)
    }
  }

  async function tick(): Promise<void> {
    if (ticking) return
    ticking = true
    try {
      clockTicks += 1
      if (!deps.enabled()) {
        cancelAllOff()
        return
      }
      for (const snapshot of [...plans]) {
        if (snapshot.status !== 'running') continue
        let plan = snapshot

        for (const step of plan.steps) {
          if (step.status !== 'running') continue
          plan = await judgeRunning(plan, step)
        }
        if (plan.status !== 'running') continue

        for (const step of plan.steps) {
          if (step.status !== 'pending') continue
          if (!step.dependsOn.every((id) => stepOf(plan, id)?.status === 'done')) continue
          if (runningSteps() >= PLAN_RUNNING_STEPS_MAX) break
          plan = startStep(plan, step)
        }

        for (const step of plan.steps) {
          if (step.status !== 'pending') continue
          const blocked = step.dependsOn
            .map((id) => stepOf(plan, id))
            .find((dep) => dep !== undefined && (dep.status === 'failed' || dep.status === 'skipped'))
          if (blocked === undefined) continue
          const why: string = blocked.status === 'failed' ? 'failed' : 'was skipped'
          plan = updateStep(plan, step.id, (current) => skippedStep(current, `depends on ${blocked.id} which ${why}`, deps.now()))
        }

        finishIfOver(plan)
      }
    } catch (error) {
      deps.onError('jarvis plans tick', error)
    } finally {
      ticking = false
    }
  }

  return {
    create(input: PlanInput): Plan {
      if (!deps.enabled()) {
        throw new Error('Task plans are off. Turn them on in Settings > Agents > Jarvis (Task plans), then try again.')
      }
      validatePlanInput(input, deps.findSession)
      if (plans.filter((plan) => plan.status === 'running').length >= PLAN_ACTIVE_MAX) {
        throw new Error(`At most ${PLAN_ACTIVE_MAX} task plans can run at once; wait for one to finish or cancel one first.`)
      }
      const plan: Plan = {
        id: deps.newId(),
        goal: input.goal.trim(),
        status: 'running',
        createdAt: deps.now(),
        steps: input.steps.map((step): PlanStep => ({
          ...step,
          title: step.title.trim(),
          prompt: step.prompt.trim(),
          dependsOn: [...new Set(step.dependsOn)],
          status: 'pending'
        }))
      }
      plans = [plan, ...plans]
      prunePlans()
      deps.log('plan create', `${plan.id}: ${plan.goal}`)
      void tick().catch((error: unknown) => deps.onError('jarvis plans tick', error))
      return plan
    },

    list: () => plans,

    get: (id: string): Plan => find(id),

    // Cancelling a running plan starts no new step, but steps already running keep running in their sessions: the
    // service stops looking at them (cancel never closes a session). Other plans are returned as they are.
    cancel(id: string): Plan {
      const plan = find(id)
      if (plan.status !== 'running') return plan
      const at = deps.now()
      const steps = plan.steps.map((step) => (step.status === 'pending' ? skippedStep(step, 'cancelled', at) : step))
      const cancelled = replace({ ...plan, status: 'cancelled', finishedAt: at, steps })
      forgetRuns(cancelled)
      deps.log('plan cancel', cancelled.id)
      return cancelled
    },

    tick,

    start(): void {
      if (timer !== null) return
      timer = deps.setInterval(() => {
        void tick()
      }, PLAN_TICK_MS)
    },

    stop(): void {
      if (timer !== null) deps.clearInterval(timer)
      timer = null
    }
  }
}
