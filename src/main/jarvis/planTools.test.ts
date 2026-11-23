import { describe, expect, it, vi } from 'vitest'
import type { Plan, PlanInput, PlanService, PlanStep } from './planTypes'
import { createPlanTools, formatPlan, PLAN_TEXT_MAX } from './planTools'

const NOW = 1_700_000_000_000
const MIN = 60_000

function step(id: string, extra: Partial<PlanStep> = {}): PlanStep {
  return {
    id,
    title: `Step ${id}`,
    target: { kind: 'existing', session: 'Web' },
    prompt: `do ${id}`,
    dependsOn: [],
    status: 'pending',
    ...extra
  }
}

function plan(id: string, extra: Partial<Plan> = {}): Plan {
  return {
    id,
    goal: `goal ${id}`,
    status: 'running',
    createdAt: NOW - 10 * MIN,
    steps: [step('a')],
    ...extra
  }
}

/** The service is another worker's; these tools only use the interface, so the fake speaks exactly that. */
class FakePlans implements PlanService {
  all: Plan[] = []
  created: PlanInput[] = []
  cancelled: string[] = []
  createError: string | undefined
  getError: string | undefined
  cancelError: string | undefined

  create(input: PlanInput): Plan {
    if (this.createError !== undefined) throw new Error(this.createError)
    this.created.push(input)
    const made = plan('p1', {
      goal: input.goal,
      status: 'running',
      steps: input.steps.map((item) => ({ ...item, status: 'pending' as const }))
    })
    this.all.push(made)
    return made
  }

  list(): readonly Plan[] {
    return this.all
  }

  get(id: string): Plan {
    if (this.getError !== undefined) throw new Error(this.getError)
    const found = this.all.find((candidate) => candidate.id === id)
    if (found === undefined) throw new Error(`No plan "${id}".`)
    return found
  }

  cancel(id: string): Plan {
    if (this.cancelError !== undefined) throw new Error(this.cancelError)
    this.cancelled.push(id)
    return { ...this.get(id), status: 'cancelled' }
  }

  async tick(): Promise<void> {
    // The timer path belongs to the service.
  }

  start(): void {
    // The timer path belongs to the service.
  }

  stop(): void {
    // The timer path belongs to the service.
  }
}

function setup() {
  const plans = new FakePlans()
  const log = vi.fn()
  const tools = createPlanTools(plans, log)
  const run = (name: string, args: Record<string, unknown> = {}): Promise<string> => {
    const tool = tools.find((candidate) => candidate.name === name)
    if (tool === undefined) throw new Error(`No tool ${name}`)
    return tool.run(args)
  }
  return { plans, log, tools, run }
}

describe('plan tools (D80)', () => {
  it('exposes the three plan tools and the plan_create schema', () => {
    const { tools } = setup()
    expect(tools.map((tool) => tool.name)).toEqual(['plan_create', 'plan_status', 'plan_cancel'])
    const create = tools[0]
    expect(create.description).toContain('depends_on')
    expect(create.description).toContain('{{stepId}}')
    expect(create.description).toContain('3 running at once')
    expect(create.description).toContain('Settings (Jarvis > Task plans)')
    const schema = create.inputSchema as { required: string[]; properties: Record<string, { maxItems?: number }> }
    expect(schema.required).toEqual(['goal', 'steps'])
    expect(schema.properties.steps.maxItems).toBe(8)
  })

  it('converts both target kinds strictly and ignores unknown fields', async () => {
    const t = setup()
    const answer = await t.run('plan_create', {
      goal: 'fix the login',
      extra: 'ignored',
      steps: [
        { id: 'read', title: 'Read', prompt: 'read it', session: ' Web ', extra: 'ignored' },
        {
          id: 'fix',
          title: 'Fix',
          prompt: 'use {{read}}',
          depends_on: ['read'],
          new_session: { name: 'Fixer', cwd: 'C:/work', agent: 'opencode', model: 'm', extra: 'ignored' },
          extra: 'ignored'
        }
      ]
    })
    expect(t.plans.created).toEqual([{
      goal: 'fix the login',
      steps: [
        { id: 'read', title: 'Read', target: { kind: 'existing', session: 'Web' }, prompt: 'read it', dependsOn: [] },
        {
          id: 'fix',
          title: 'Fix',
          target: { kind: 'new', name: 'Fixer', cwd: 'C:/work', agent: 'opencode', model: 'm' },
          prompt: 'use {{read}}',
          dependsOn: ['read']
        }
      ]
    }])
    expect(t.log).toHaveBeenCalledWith('plan_create', 'fix the login')
    expect(answer).toContain('Plan p1: running')
  })

  it('clips the goal in the log line to 80 characters', async () => {
    const t = setup()
    await t.run('plan_create', {
      goal: 'g'.repeat(100),
      steps: [{ id: 'a', title: 'A', prompt: 'p', session: 'Web' }]
    })
    expect(t.log).toHaveBeenCalledWith('plan_create', `${'g'.repeat(79)}…`)
  })

  it('refuses a step with no target or both targets, and names a bad field', async () => {
    const t = setup()
    await expect(t.run('plan_create', {
      goal: 'g',
      steps: [{ id: 'a', title: 'A', prompt: 'p' }]
    })).rejects.toThrow('"new_session"')
    await expect(t.run('plan_create', {
      goal: 'g',
      steps: [{ id: 'a', title: 'A', prompt: 'p', session: 'Web', new_session: { name: 'N' } }]
    })).rejects.toThrow('not both')
    await expect(t.run('plan_create', {
      goal: 'g',
      steps: [{ id: 'a', title: 'A', prompt: 'p', session: 4 }]
    })).rejects.toThrow('"session"')
    await expect(t.run('plan_create', {
      goal: 'g',
      steps: [{ title: 'A', prompt: 'p', session: 'Web' }]
    })).rejects.toThrow('"id"')
    await expect(t.run('plan_create', {
      goal: 'g',
      steps: [{ id: 'a', title: 4, prompt: 'p', session: 'Web' }]
    })).rejects.toThrow('"title"')
    await expect(t.run('plan_create', {
      goal: 'g',
      steps: [{ id: 'a', title: 'A', prompt: 'p', session: 'Web', depends_on: ['a', 2] }]
    })).rejects.toThrow('"depends_on"')
    await expect(t.run('plan_create', {
      goal: 'g',
      steps: [{ id: 'a', title: 'A', prompt: 'p', new_session: { name: 'N', agent: 'other' } }]
    })).rejects.toThrow('"agent"')
    await expect(t.run('plan_create', { goal: 'g', steps: 'not a list' })).rejects.toThrow('"steps" must be a list of steps.')
    expect(t.plans.created).toHaveLength(0)
  })

  it('surfaces service errors with their message', async () => {
    const t = setup()
    t.plans.createError = 'Task plans are off. Turn them on in Settings > Agents > Jarvis.'
    await expect(t.run('plan_create', {
      goal: 'g',
      steps: [{ id: 'a', title: 'A', prompt: 'p', session: 'Web' }]
    })).rejects.toThrow('Task plans are off. Turn them on in Settings > Agents > Jarvis.')
    t.plans.getError = 'No plan "nope".'
    await expect(t.run('plan_status', { id: 'nope' })).rejects.toThrow('No plan "nope".')
    t.plans.cancelError = 'Plan "p1" is not running.'
    await expect(t.run('plan_cancel', { id: 'p1' })).rejects.toThrow('Plan "p1" is not running.')
  })

  it('lists every plan in one line, or shows one in detail', async () => {
    const t = setup()
    t.plans.all = [
      plan('p1', {
        goal: 'fix the login',
        status: 'running',
        steps: [
          step('a', { status: 'done', sessionName: 'Web', startedAt: NOW - 5 * MIN, finishedAt: NOW - 3 * MIN, answer: 'all tests pass' }),
          step('b', { status: 'running', sessionName: 'Web', startedAt: NOW - 2 * MIN })
        ]
      }),
      plan('p2', {
        goal: 'ship it',
        status: 'done',
        steps: [step('x', { status: 'done' }), step('y', { status: 'done' })]
      })
    ]

    const list = await t.run('plan_status')
    expect(list.split('\n')).toEqual([
      '- p1: running, 1/2 steps done, goal: "fix the login"',
      '- p2: done, 2/2 steps done, goal: "ship it"'
    ])

    const detail = await t.run('plan_status', { id: 'p1' })
    expect(detail).toContain('Plan p1: running · 1/2 steps done')
    expect(detail).toContain('Goal: fix the login')
    expect(detail).toContain('- a "Step a": done · session "Web" · took 2 min')
    expect(detail).toContain('  answer: all tests pass')
    expect(detail).toContain('- b "Step b": running · session "Web" · running for')
  })

  it('has a message when there are no plans', async () => {
    const t = setup()
    expect(await t.run('plan_status')).toBe('No task plans.')
  })

  it('cancels the plan and says running steps were left alone', async () => {
    const t = setup()
    t.plans.all = [plan('p1')]
    const answer = await t.run('plan_cancel', { id: 'p1' })
    expect(t.plans.cancelled).toEqual(['p1'])
    expect(answer).toBe('Cancelled plan p1. Steps that were already running were left alone in their sessions.')
    await expect(t.run('plan_cancel')).rejects.toThrow('"id" is required.')
  })
})

describe('plan_cancel on a plan that is already over (D80)', () => {
  it('says it was already done instead of claiming a cancel', async () => {
    const t = setup()
    const done = { ...plan('p1'), status: 'done' as const }
    t.plans.all = [done]
    t.plans.cancel = (id: string): Plan => {
      t.plans.cancelled.push(id)
      return done
    }
    expect(await t.run('plan_cancel', { id: 'p1' })).toBe('Plan p1 is already done; nothing to cancel.')
  })
})

describe('formatPlan (pure)', () => {
  it('shows each step with its session, time, problem and the start of a done answer', () => {
    const text = formatPlan(plan('p1', {
      goal: 'fix login',
      steps: [
        step('a', { title: 'Read', status: 'done', sessionName: 'Web', startedAt: NOW - 5 * MIN, finishedAt: NOW - 2 * MIN, answer: 'the answer' }),
        step('b', { title: 'Fix', status: 'failed', sessionName: 'Ops', startedAt: NOW - 2 * MIN, finishedAt: NOW - MIN, problem: 'permission denied' }),
        step('c', { title: 'Test', status: 'pending', target: { kind: 'new', name: 'Fixer' } })
      ]
    }), NOW)
    expect(text.split('\n')[0]).toBe('Plan p1: running · 1/3 steps done')
    expect(text).toContain('Goal: fix login')
    expect(text).toContain('- a "Read": done · session "Web" · took 3 min')
    expect(text).toContain('  answer: the answer')
    expect(text).toContain('- b "Fix": failed · session "Ops" · took 1 min · problem: permission denied')
    expect(text).toContain('- c "Test": pending · new session "Fixer" (not started) · not started')
  })

  it('keeps the first 200 characters of a done answer', () => {
    const text = formatPlan(plan('p1', {
      steps: [step('a', { status: 'done', answer: 'x'.repeat(500) })]
    }), NOW)
    const answer = /  answer: (.*)/.exec(text)?.[1] ?? ''
    expect(answer).toHaveLength(200)
    expect(answer.endsWith('…')).toBe(true)
  })

  it('caps the detail at 3500 characters with a (cut) note', () => {
    const steps = Array.from({ length: 8 }, (_, index) => step(`s${index}`, {
      title: 't'.repeat(80),
      status: 'done',
      sessionName: 'Web',
      startedAt: NOW - MIN,
      finishedAt: NOW,
      answer: 'a'.repeat(4000),
      problem: 'p'.repeat(400)
    }))
    const text = formatPlan(plan('p1', { goal: 'g'.repeat(300), steps }), NOW)
    expect(text.length).toBeLessThanOrEqual(PLAN_TEXT_MAX)
    expect(text.endsWith('(cut)')).toBe(true)
  })
})
