// D80: Jarvis tools for task plans. plan_create turns the model's goal and steps into the strict PlanInput the service
// wants (exactly one target per step: an existing session or a new one), plan_status lists plans or shows one in
// detail, plan_cancel stops new steps. Every rule about limits, dependencies and sessions lives in PlanService; these
// tools only parse arguments and format the answer. Formatting is the pure formatPlan (own tests). Registered in
// index.ts like the other tool files.
import { isRecord } from '../../shared/guards'
import type { Plan, PlanService, PlanStep, PlanStepInput, PlanStepTarget } from './planTypes'
import { PLAN_GOAL_MAX, PLAN_RUNNING_STEPS_MAX, PLAN_STEPS_MAX, PLAN_TITLE_MAX } from './planTypes'
import type { McpTool } from './mcpProtocol'
import { clip, optionalText, schema, text } from './toolArgs'

/** The whole detail stops here, so one plan never floods Jarvis's context. */
export const PLAN_TEXT_MAX = 3500
const ANSWER_PREVIEW_MAX = 200
const PROBLEM_MAX = 200
const LIST_GOAL_MAX = 80
const AGENTS = ['claude', 'opencode'] as const

/** A non-empty string field, with an error that names the field. */
function requiredText(source: Readonly<Record<string, unknown>>, key: string, where: string): string {
  const value = source[key]
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${where}: "${key}" must be text.`)
  return value
}

/** An optional non-empty string field; null and undefined mean "not given". */
function optionalFieldText(source: Readonly<Record<string, unknown>>, key: string, where: string): string | undefined {
  const value = source[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${where}: "${key}" must be text.`)
  return value
}

/** depends_on is optional; when given it must be a list of step ids (unknown extra fields are ignored). */
function dependsOnOf(step: Readonly<Record<string, unknown>>, where: string): readonly string[] {
  const value = step.depends_on
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${where}: "depends_on" must be a list of step ids.`)
  return value.map((ref) => {
    if (typeof ref !== 'string' || ref.trim().length === 0) throw new Error(`${where}: "depends_on" must be a list of step ids.`)
    return ref.trim()
  })
}

/** Exactly one of session / new_session: an existing session (name or id) or the new session the step creates. */
function targetOf(step: Readonly<Record<string, unknown>>, where: string): PlanStepTarget {
  const hasSession = step.session !== undefined && step.session !== null
  const hasNew = step.new_session !== undefined && step.new_session !== null
  if (hasSession && hasNew) throw new Error(`${where}: give "session" or "new_session", not both.`)
  if (!hasSession && !hasNew) throw new Error(`${where}: give "session" (an existing session) or "new_session" (a new one).`)

  if (hasSession) {
    if (typeof step.session !== 'string' || step.session.trim().length === 0) {
      throw new Error(`${where}: "session" must be a session name or id.`)
    }
    return { kind: 'existing', session: step.session.trim() }
  }

  if (!isRecord(step.new_session)) throw new Error(`${where}: "new_session" must be an object with a "name".`)
  const raw = step.new_session
  const name = requiredText(raw, 'name', `${where}.new_session`).trim()
  const cwd = optionalFieldText(raw, 'cwd', `${where}.new_session`)?.trim()
  const model = optionalFieldText(raw, 'model', `${where}.new_session`)?.trim()
  const agentValue = raw.agent
  if (agentValue !== undefined && agentValue !== null && agentValue !== 'claude' && agentValue !== 'opencode') {
    throw new Error(`${where}: "agent" must be claude or opencode.`)
  }
  const agent = agentValue === 'claude' || agentValue === 'opencode' ? agentValue : undefined
  return {
    kind: 'new',
    name,
    ...(cwd !== undefined ? { cwd } : {}),
    ...(agent !== undefined ? { agent } : {}),
    ...(model !== undefined ? { model } : {})
  }
}

/** The steps as PlanInput wants them; anything that is not the right shape is refused with the field's name. */
function stepsOf(args: Readonly<Record<string, unknown>>): readonly PlanStepInput[] {
  const raw = args.steps
  if (!Array.isArray(raw)) throw new Error('"steps" must be a list of steps.')
  return raw.map((entry, index): PlanStepInput => {
    const where = `steps[${index}]`
    if (!isRecord(entry)) throw new Error(`${where} must be an object with "id", "title", "prompt" and "session" or "new_session".`)
    return {
      id: requiredText(entry, 'id', where).trim(),
      title: requiredText(entry, 'title', where).trim(),
      target: targetOf(entry, where),
      prompt: requiredText(entry, 'prompt', where),
      dependsOn: dependsOnOf(entry, where)
    }
  })
}

/** "under a minute", "12 min", "3 h 20 min", "2 days" (never negative). */
function durationText(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`
  return `${Math.round(hours / 24)} days`
}

/** The session the step runs in, or the session it will use when it has not started yet. */
function sessionText(step: PlanStep): string {
  if (step.sessionName !== undefined) return `session "${step.sessionName}"`
  if (step.sessionId !== undefined) return `session ${step.sessionId}`
  if (step.target.kind === 'existing') return `session "${step.target.session}" (not started)`
  return `new session "${step.target.name}" (not started)`
}

/** A step that has not started says so; a running one says for how long; a finished one how long it took. */
function howLongText(step: PlanStep, now: number): string {
  if (step.startedAt === undefined) return 'not started'
  if (step.status === 'running') return `running for ${durationText(now - step.startedAt)}`
  return `took ${durationText((step.finishedAt ?? now) - step.startedAt)}`
}

function stepText(step: PlanStep, now: number): string {
  const parts = [
    `- ${step.id} "${clip(step.title, PLAN_TITLE_MAX)}": ${step.status}`,
    sessionText(step),
    howLongText(step, now)
  ]
  if (step.problem !== undefined && step.problem.trim().length > 0) parts.push(`problem: ${clip(step.problem, PROBLEM_MAX)}`)
  const head = parts.join(' · ')
  if (step.status === 'done' && step.answer !== undefined && step.answer.trim().length > 0) {
    return `${head}\n  answer: ${clip(step.answer, ANSWER_PREVIEW_MAX)}`
  }
  return head
}

/** Keeps the end short: the formatter never returns more than PLAN_TEXT_MAX characters. */
function capped(value: string): string {
  if (value.length <= PLAN_TEXT_MAX) return value
  const note = '\n(cut)'
  return `${value.slice(0, PLAN_TEXT_MAX - note.length).trimEnd()}${note}`
}

/**
 * One plan as plain text: id, status and how many steps are done, the goal, then each step with its id, title, status,
 * session, how long it ran (or has run), any problem and, when it is done, the start of its answer. Pure: the caller
 * passes `now`, so tests do not depend on the clock. The end is cut with a "(cut)" note above 3500 characters.
 */
export function formatPlan(plan: Plan, now: number): string {
  const done = plan.steps.filter((step) => step.status === 'done').length
  const lines = [
    `Plan ${plan.id}: ${plan.status} · ${done}/${plan.steps.length} steps done`,
    `Goal: ${clip(plan.goal, PLAN_GOAL_MAX)}`
  ]
  for (const step of plan.steps) lines.push(stepText(step, now))
  return capped(lines.join('\n'))
}

/** The one-line form of plan_status without an id: id, status, goal clipped, steps done/total. */
function planSummary(plan: Plan): string {
  const done = plan.steps.filter((step) => step.status === 'done').length
  return `- ${plan.id}: ${plan.status}, ${done}/${plan.steps.length} steps done, goal: "${clip(plan.goal, LIST_GOAL_MAX)}"`
}

export function createPlanTools(plans: PlanService, log: (tool: string, detail: string) => void): McpTool[] {
  return [
    {
      name: 'plan_create',
      description: `Splits a goal into steps that run in sessions. A step starts when its depends_on steps are done and can use their answers with {{stepId}} in its prompt. Up to ${PLAN_STEPS_MAX} steps, ${PLAN_RUNNING_STEPS_MAX} running at once. Every step needs either "session" (an existing session name or id) or "new_session" (a new session: name, optional cwd, agent claude|opencode, model). When the plan ends you are given a "[Plan finished]" message to report. Use it for work that needs several sessions in order or in parallel; plans must be turned on in Settings (Jarvis > Task plans).`,
      inputSchema: schema({
        goal: { type: 'string', description: 'What the plan should achieve (up to 300 characters).' },
        steps: {
          type: 'array',
          minItems: 1,
          maxItems: PLAN_STEPS_MAX,
          description: `The steps, at most ${PLAN_STEPS_MAX}.`,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Short id other steps refer to in depends_on and {{id}} (letters, digits, - and _; max 20).' },
              title: { type: 'string', description: 'Short title shown in plan_status.' },
              prompt: { type: 'string', description: 'The prompt sent to the session; {{otherStepId}} is replaced with that done step\'s answer.' },
              depends_on: { type: 'array', items: { type: 'string' }, description: 'Ids of steps that must be done before this one starts.' },
              session: { type: 'string', description: 'An existing session name or id. Give this or new_session, not both.' },
              new_session: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Name for the new session.' },
                  cwd: { type: 'string', description: 'Folder for the new session (default: the app default).' },
                  agent: { type: 'string', enum: [...AGENTS], description: 'Which agent the new session runs.' },
                  model: { type: 'string', description: 'Model for the new session (agent default when omitted).' }
                },
                required: ['name'],
                additionalProperties: false
              }
            },
            required: ['id', 'title', 'prompt'],
            additionalProperties: false
          }
        }
      }, ['goal', 'steps']),
      run: async (args) => {
        const goal = text(args, 'goal').trim()
        const plan = plans.create({ goal, steps: stepsOf(args) })
        log('plan_create', clip(goal, 80))
        return formatPlan(plan, Date.now())
      }
    },
    {
      name: 'plan_status',
      description: 'Lists every task plan in one line each (id, status, goal, steps done/total), or shows one plan in detail with each step\'s id, title, status, session, how long it ran or has run, any problem, and the start of a done step\'s answer. Plans live in memory only. Use it to follow a plan you created.',
      inputSchema: schema({
        id: { type: 'string', description: 'The plan id; omit to list every plan.' }
      }),
      run: async (args) => {
        const id = optionalText(args, 'id')?.trim()
        if (id !== undefined) return formatPlan(plans.get(id), Date.now())
        const list = plans.list()
        if (list.length === 0) return 'No task plans.'
        return list.map(planSummary).join('\n')
      }
    },
    {
      name: 'plan_cancel',
      description: 'Cancels a running task plan: no new step starts. Steps already running are left alone in their sessions. Plans live in memory only.',
      inputSchema: schema({
        id: { type: 'string', description: 'The plan id to cancel.' }
      }, ['id']),
      run: async (args) => {
        const plan = plans.cancel(text(args, 'id').trim())
        if (plan.status !== 'cancelled') return `Plan ${plan.id} is already ${plan.status}; nothing to cancel.`
        return `Cancelled plan ${plan.id}. Steps that were already running were left alone in their sessions.`
      }
    }
  ]
}
