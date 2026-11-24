import { describe, expect, it } from 'vitest'
import {
  PLAN_ACTIVE_MAX,
  PLAN_ANSWER_MAX,
  PLAN_GOAL_MAX,
  PLAN_PROMPT_MAX,
  PLAN_RUNNING_STEPS_MAX,
  PLAN_STEPS_MAX,
  PLAN_STEP_TIMEOUT_MS,
  PLAN_TITLE_MAX,
  type PlanInput,
  type PlanService,
  type PlanStepInput
} from './planTypes'
import { createPlanService, fillPrompt, validatePlanInput } from './planService'

type Phase = 'working' | 'finished' | 'waiting' | 'gone'

interface Session {
  readonly id: string
  readonly name: string
}

const SESSIONS: readonly Session[] = Array.from({ length: 8 }, (_, index) => ({
  id: `s${index + 1}`,
  name: ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'][index]
}))

interface Harness {
  readonly service: PlanService
  readonly prompts: { readonly sessionId: string; readonly text: string }[]
  readonly delivered: string[]
  readonly logs: { readonly tool: string; readonly detail: string }[]
  readonly errors: { readonly where: string; readonly error: unknown }[]
  readonly created: Session[]
  readonly intervals: number[]
  readonly cleared: unknown[]
  setEnabled(value: boolean): void
  advance(ms: number): void
  setPhase(sessionId: string, phase: Phase): void
  setAnswer(sessionId: string, text: string | null): void
  forget(session: string): void
  settle(): Promise<void>
}

function harness(
  options: { readonly enabled?: boolean; readonly send?: (sessionId: string, text: string) => Promise<string>; readonly answerError?: string } = {}
): Harness {
  let enabled = options.enabled ?? true
  let now = 1_000_000
  let ids = 0
  let newSessions = 0
  const byId = new Map<string, Session>()
  const byName = new Map<string, Session>()
  for (const session of SESSIONS) {
    byId.set(session.id, session)
    byName.set(session.name, session)
  }
  const phases = new Map<string, Phase>()
  const answers = new Map<string, string | null>()
  const prompts: { sessionId: string; text: string }[] = []
  const delivered: string[] = []
  const logs: { tool: string; detail: string }[] = []
  const errors: { where: string; error: unknown }[] = []
  const created: Session[] = []
  const intervals: number[] = []
  const cleared: unknown[] = []
  const send = options.send ?? (() => Promise.resolve('queued'))

  const service = createPlanService({
    enabled: () => enabled,
    now: () => now,
    newId: () => {
      ids += 1
      return `p${ids}`
    },
    findSession: (ref) => byId.get(ref) ?? byName.get(ref) ?? null,
    createSession: (target) => {
      newSessions += 1
      const session: Session = { id: `new-${newSessions}`, name: target.name }
      byId.set(session.id, session)
      byName.set(session.name, session)
      phases.set(session.id, 'working')
      created.push(session)
      return session
    },
    sendPrompt: (sessionId, text) => {
      prompts.push({ sessionId, text })
      phases.set(sessionId, 'working')
      return send(sessionId, text)
    },
    sessionPhase: (sessionId) => phases.get(sessionId) ?? 'gone',
    lastAnswer: async (sessionId) => {
      if (options.answerError !== undefined) throw new Error(options.answerError)
      return answers.get(sessionId) ?? null
    },
    deliver: async (text) => {
      delivered.push(text)
    },
    log: (tool, detail) => {
      logs.push({ tool, detail })
    },
    setInterval: () => {
      const handle = 7 as unknown as ReturnType<typeof setInterval>
      intervals.push(5000)
      return handle
    },
    clearInterval: (handle) => {
      cleared.push(handle)
    },
    onError: (where, error) => {
      errors.push({ where, error })
    }
  })

  return {
    service,
    prompts,
    delivered,
    logs,
    errors,
    created,
    intervals,
    cleared,
    setEnabled: (value: boolean) => {
      enabled = value
    },
    advance: (ms: number) => {
      now += ms
    },
    setPhase: (sessionId: string, phase: Phase) => {
      phases.set(sessionId, phase)
    },
    setAnswer: (sessionId: string, text: string | null) => {
      answers.set(sessionId, text)
    },
    forget: (session: string) => {
      const found = byId.get(session) ?? byName.get(session)
      if (found !== undefined) {
        byId.delete(found.id)
        byName.delete(found.name)
        phases.delete(found.id)
      }
    },
    // create() runs one tick without awaiting it; this lets its promise chains settle before the test looks.
    settle: async () => {
      for (let index = 0; index < 10; index += 1) await Promise.resolve()
    }
  }
}

const find = (ref: string): Session | null => SESSIONS.find((session) => session.id === ref || session.name === ref) ?? null

const step = (id: string, extra: Partial<PlanStepInput> = {}): PlanStepInput => ({
  id,
  title: `step ${id}`,
  target: { kind: 'existing', session: 'one' },
  prompt: `do ${id}`,
  dependsOn: [],
  ...extra
})

const planInput = (steps: readonly PlanStepInput[], goal = 'ship the thing'): PlanInput => ({ goal, steps })

describe('validatePlanInput', () => {
  it('accepts a linear plan and a new session', () => {
    const input = planInput([
      step('a'),
      step('b', { dependsOn: ['a'], prompt: 'use {{a}}' }),
      step('c', { target: { kind: 'new', name: 'fresh' }, dependsOn: ['b'] })
    ])
    expect(() => validatePlanInput(input, find)).not.toThrow()
  })

  it('checks the goal', () => {
    expect(() => validatePlanInput(planInput([step('a')], ''), find)).toThrow(/goal/)
    expect(() => validatePlanInput(planInput([step('a')], '   '), find)).toThrow(/goal/)
    expect(() => validatePlanInput(planInput([step('a')], 'x'.repeat(PLAN_GOAL_MAX + 1)), find)).toThrow(/goal/)
  })

  it('checks the number of steps', () => {
    expect(() => validatePlanInput(planInput([]), find)).toThrow(/1 to 8 steps/)
    const many = Array.from({ length: PLAN_STEPS_MAX + 1 }, (_, index) => step(`s${index}`))
    expect(() => validatePlanInput(planInput(many), find)).toThrow(/1 to 8 steps/)
  })

  it('checks step ids', () => {
    expect(() => validatePlanInput(planInput([step('bad id')]), find)).toThrow(/is not valid/)
    expect(() => validatePlanInput(planInput([step('x'.repeat(21))]), find)).toThrow(/is not valid/)
    expect(() => validatePlanInput(planInput([step('a'), step('a')]), find)).toThrow(/more than one step/)
  })

  it('checks titles and prompts', () => {
    expect(() => validatePlanInput(planInput([step('a', { title: ' ' })]), find)).toThrow(/title/)
    expect(() => validatePlanInput(planInput([step('a', { title: 'x'.repeat(PLAN_TITLE_MAX + 1) })]), find)).toThrow(/title/)
    expect(() => validatePlanInput(planInput([step('a', { prompt: ' ' })]), find)).toThrow(/prompt/)
    expect(() => validatePlanInput(planInput([step('a', { prompt: 'x'.repeat(PLAN_PROMPT_MAX + 1) })]), find)).toThrow(
      /prompt/
    )
  })

  it('checks dependencies, cycles and placeholders', () => {
    expect(() => validatePlanInput(planInput([step('a', { dependsOn: ['b'] })]), find)).toThrow(/not a step/)
    expect(() => validatePlanInput(planInput([step('a', { dependsOn: ['a'] })]), find)).toThrow(/itself/)
    expect(() =>
      validatePlanInput(planInput([step('a', { dependsOn: ['b'] }), step('b', { dependsOn: ['a'] })]), find)
    ).toThrow(/cycle/)
    expect(() => validatePlanInput(planInput([step('a', { prompt: 'x {{b}}' }), step('b')]), find)).toThrow(
      /not one of its dependencies/
    )
  })

  it('checks the target', () => {
    expect(() => validatePlanInput(planInput([step('a', { target: { kind: 'existing', session: 'nope' } })]), find)).toThrow(
      /"nope" was not found/
    )
    expect(() => validatePlanInput(planInput([step('a', { target: { kind: 'new', name: ' ' } })]), find)).toThrow(/1 to 60/)
    expect(() =>
      validatePlanInput(planInput([step('a', { target: { kind: 'new', name: 'x'.repeat(61) } })]), find)
    ).toThrow(/1 to 60/)
    expect(() =>
      validatePlanInput(planInput([step('a', { target: { kind: 'new', name: 'cur', agent: 'cursor', model: 'gpt-5' } })]), find)
    ).not.toThrow()
    expect(() =>
      validatePlanInput(planInput([step('a', { target: { kind: 'new', name: 'cur', agent: 'cursor', model: 'not a model!' } })]), find)
    ).toThrow(/not a Cursor model/)
  })
})

describe('createPlanService', () => {
  it('starts one 5 s timer and stops it', () => {
    const h = harness()
    h.service.start()
    h.service.start()
    expect(h.intervals).toEqual([5000])
    h.service.stop()
    expect(h.cleared).toEqual([7])
    h.service.stop()
    expect(h.cleared).toHaveLength(1)
  })

  it('refuses to create while plans are off', () => {
    const h = harness({ enabled: false })
    expect(() => h.service.create(planInput([step('a')]))).toThrow(
      'Task plans are off. Turn them on in Settings > Agents > Jarvis (Task plans), then try again.'
    )
  })

  it('runs a linear plan and pastes an answer into the next prompt', async () => {
    const h = harness()
    const plan = h.service.create(
      planInput([
        step('a', { target: { kind: 'existing', session: 'one' }, prompt: 'gather facts' }),
        step('b', { target: { kind: 'existing', session: 'two' }, dependsOn: ['a'], prompt: 'write using {{a}}' })
      ])
    )
    await h.settle()
    expect(h.prompts).toEqual([{ sessionId: 's1', text: 'gather facts' }])
    expect(h.service.get(plan.id).steps.map((item) => item.status)).toEqual(['running', 'pending'])
    expect(h.service.get(plan.id).steps[0].sessionName).toBe('one')
    expect(h.logs.some((entry) => entry.tool === 'plan create')).toBe(true)
    expect(h.logs.some((entry) => entry.tool === 'plan step prompt' && entry.detail.includes('queued'))).toBe(true)

    h.setPhase('s1', 'working')
    await h.service.tick()

    h.setAnswer('s1', 'the facts')
    h.setPhase('s1', 'finished')
    await h.service.tick()
    expect(h.prompts).toEqual([
      { sessionId: 's1', text: 'gather facts' },
      { sessionId: 's2', text: 'write using the facts' }
    ])
    expect(h.delivered).toEqual([])

    h.setPhase('s2', 'working')
    await h.service.tick()
    h.setAnswer('s2', 'the draft')
    h.setPhase('s2', 'finished')
    await h.service.tick()

    const done = h.service.get(plan.id)
    expect(done.status).toBe('done')
    expect(done.finishedAt).toBeTypeOf('number')
    expect(done.steps.map((item) => item.answer)).toEqual(['the facts', 'the draft'])
    expect(h.delivered).toHaveLength(1)
    expect(h.delivered[0]).toContain('[Plan finished]')
    expect(h.delivered[0]).toContain('ship the thing')
    expect(h.delivered[0]).toContain('the facts')
    expect(h.delivered[0]).toContain('Report to the user in plain words what was done and what failed.')
  })

  it('runs a diamond in parallel and joins both answers', async () => {
    const h = harness()
    const plan = h.service.create(
      planInput([
        step('a', { target: { kind: 'existing', session: 's1' } }),
        step('b', { target: { kind: 'existing', session: 's2' }, dependsOn: ['a'], prompt: 'left {{a}}' }),
        step('c', { target: { kind: 'existing', session: 's3' }, dependsOn: ['a'], prompt: 'right {{a}}' }),
        step('d', { target: { kind: 'existing', session: 's4' }, dependsOn: ['b', 'c'], prompt: 'join {{b}} and {{c}}' })
      ])
    )
    await h.settle()
    h.setAnswer('s1', 'A')
    h.setPhase('s1', 'working')
    await h.service.tick()
    h.setPhase('s1', 'finished')
    await h.service.tick()
    expect(h.prompts).toEqual([
      { sessionId: 's1', text: 'do a' },
      { sessionId: 's2', text: 'left A' },
      { sessionId: 's3', text: 'right A' }
    ])

    h.setPhase('s2', 'working')
    h.setPhase('s3', 'working')
    await h.service.tick()
    h.setAnswer('s2', 'B')
    h.setAnswer('s3', 'C')
    h.setPhase('s2', 'finished')
    h.setPhase('s3', 'finished')
    await h.service.tick()
    expect(h.prompts[3]).toEqual({ sessionId: 's4', text: 'join B and C' })

    h.setPhase('s4', 'working')
    await h.service.tick()
    h.setAnswer('s4', 'D')
    h.setPhase('s4', 'finished')
    await h.service.tick()
    expect(h.service.get(plan.id).status).toBe('done')
    expect(h.service.get(plan.id).steps.map((item) => item.status)).toEqual(['done', 'done', 'done', 'done'])
    expect(h.delivered).toHaveLength(1)
  })

  it('fails the plan when a step fails, skips its dependents and delivers once', async () => {
    const h = harness()
    const plan = h.service.create(
      planInput([
        step('a', { target: { kind: 'existing', session: 's1' } }),
        step('b', { dependsOn: ['a'], prompt: 'after {{a}}' })
      ])
    )
    await h.settle()
    h.setPhase('s1', 'gone')
    await h.service.tick()

    const after = h.service.get(plan.id)
    expect(after.status).toBe('failed')
    expect(after.steps[0]).toMatchObject({ status: 'failed', problem: 'the session was closed, stopped or put to sleep' })
    expect(after.steps[1]).toMatchObject({ status: 'skipped', problem: 'depends on a which failed' })
    expect(h.delivered).toHaveLength(1)

    await h.service.tick()
    expect(h.delivered).toHaveLength(1)
  })

  it('marks a step waiting for the user and clears the problem afterwards', async () => {
    const h = harness()
    const plan = h.service.create(planInput([step('a')]))
    await h.settle()
    h.setPhase('s1', 'waiting')
    await h.service.tick()
    expect(h.service.get(plan.id).steps[0].problem).toBe('waiting for you in that session')
    h.setPhase('s1', 'working')
    await h.service.tick()
    expect(h.service.get(plan.id).steps[0].problem).toBeUndefined()

    h.setPhase('s1', 'waiting')
    await h.service.tick()
    h.setPhase('s1', 'finished')
    h.advance(20_000)
    await h.service.tick()
    expect(h.service.get(plan.id).steps[0].status).toBe('done')
    expect(h.service.get(plan.id).steps[0].problem).toBeUndefined()
  })

  it('runs at most PLAN_RUNNING_STEPS_MAX steps at once across plans', async () => {
    const h = harness()
    const steps = ['s1', 's2', 's3', 's4'].map((session) => step(session, { target: { kind: 'existing', session } }))
    h.service.create(planInput(steps))
    await h.settle()
    expect(h.prompts).toHaveLength(PLAN_RUNNING_STEPS_MAX)
    await h.service.tick()
    expect(h.prompts).toHaveLength(PLAN_RUNNING_STEPS_MAX)

    h.setPhase('s1', 'working')
    await h.service.tick()
    h.setAnswer('s1', 'first')
    h.setPhase('s1', 'finished')
    await h.service.tick()
    expect(h.prompts).toHaveLength(4)
    expect(h.prompts[3].sessionId).toBe('s4')
  })

  it('does not judge finished in the tick that sent the prompt, and accepts it after 20 s', async () => {
    const h = harness()
    const plan = h.service.create(planInput([step('a')]))
    await h.settle()

    h.setAnswer('s1', 'too early')
    h.setPhase('s1', 'finished')
    await h.service.tick()
    expect(h.service.get(plan.id).steps[0].status).toBe('running')

    h.advance(19_000)
    await h.service.tick()
    expect(h.service.get(plan.id).steps[0].status).toBe('running')

    h.advance(1_000)
    await h.service.tick()
    expect(h.service.get(plan.id).steps[0].status).toBe('done')
    expect(h.service.get(plan.id).steps[0].answer).toBe('too early')
  })

  it('accepts finished early once the phase was seen working', async () => {
    const h = harness()
    const plan = h.service.create(planInput([step('a')]))
    await h.settle()
    h.setPhase('s1', 'working')
    await h.service.tick()
    h.setPhase('s1', 'finished')
    await h.service.tick()
    expect(h.service.get(plan.id).steps[0].status).toBe('done')
  })

  it('stores (no answer was found) for an empty reply', async () => {
    const h = harness()
    const plan = h.service.create(planInput([step('a')]))
    await h.settle()
    h.setAnswer('s1', '   ')
    h.setPhase('s1', 'working')
    await h.service.tick()
    h.setPhase('s1', 'finished')
    await h.service.tick()
    expect(h.service.get(plan.id).steps[0].answer).toBe('(no answer was found)')
  })

  it('fails a step that runs longer than PLAN_STEP_TIMEOUT_MS', async () => {
    const h = harness()
    const plan = h.service.create(planInput([step('a')]))
    await h.settle()
    h.advance(PLAN_STEP_TIMEOUT_MS + 1)
    h.setAnswer('s1', 'late')
    h.setPhase('s1', 'finished')
    await h.service.tick()

    const after = h.service.get(plan.id)
    expect(after.steps[0]).toMatchObject({ status: 'failed', problem: 'timed out' })
    expect(after.status).toBe('failed')
    expect(h.delivered).toHaveLength(1)
  })

  it('cancels a plan, skipping pending steps and leaving running ones alone', async () => {
    const h = harness()
    const plan = h.service.create(
      planInput([
        step('a', { target: { kind: 'existing', session: 's1' } }),
        step('b', { target: { kind: 'existing', session: 's2' }, dependsOn: ['a'], prompt: 'use {{a}}' })
      ])
    )
    await h.settle()

    const cancelled = h.service.cancel(plan.id)
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.finishedAt).toBeTypeOf('number')
    expect(cancelled.steps[0].status).toBe('running')
    expect(cancelled.steps[1]).toMatchObject({ status: 'skipped', problem: 'cancelled' })
    expect(h.service.cancel(plan.id)).toBe(cancelled)

    h.setPhase('s1', 'finished')
    h.setAnswer('s1', 'late answer')
    await h.service.tick()
    expect(h.prompts).toHaveLength(1)
    expect(h.service.get(plan.id).steps[0].status).toBe('running')
    expect(h.delivered).toEqual([])

    expect(() => h.service.get('nope')).toThrow('No plan with id nope.')
    expect(() => h.service.cancel('nope')).toThrow('No plan with id nope.')
  })

  it('cancels running plans when plans are turned off and delivers nothing', async () => {
    const h = harness()
    const plan = h.service.create(
      planInput([step('a', { target: { kind: 'existing', session: 's1' } }), step('b', { dependsOn: ['a'] })])
    )
    await h.settle()

    h.setEnabled(false)
    await h.service.tick()
    const after = h.service.get(plan.id)
    expect(after.status).toBe('cancelled')
    expect(after.steps[0].status).toBe('running')
    expect(after.steps[1]).toMatchObject({ status: 'skipped', problem: 'Task plans were turned off' })
    expect(h.delivered).toEqual([])
    expect(() => h.service.create(planInput([step('c')]))).toThrow('Task plans are off')
  })

  it('starts at most PLAN_ACTIVE_MAX plans at once', async () => {
    const h = harness()
    for (let index = 0; index < PLAN_ACTIVE_MAX; index += 1) {
      h.service.create(
        planInput([step(`a${index}`, { target: { kind: 'existing', session: `s${index + 1}` } })])
      )
    }
    await h.settle()
    expect(() =>
      h.service.create(planInput([step('x', { target: { kind: 'existing', session: 's5' } })]))
    ).toThrow(/At most 3 task plans/)
    const oldest = h.service.list()[h.service.list().length - 1]
    h.service.cancel(oldest.id)
    expect(() =>
      h.service.create(planInput([step('y', { target: { kind: 'existing', session: 's5' } })]))
    ).not.toThrow()
  })

  it('lists newest first and keeps at most 20 plans', async () => {
    const h = harness()
    for (let index = 0; index < 21; index += 1) {
      const plan = h.service.create(planInput([step('a')], `goal ${index}`))
      h.service.cancel(plan.id)
    }
    await h.settle()
    const list = h.service.list()
    expect(list).toHaveLength(20)
    expect(list[0].goal).toBe('goal 20')
    expect(list[19].goal).toBe('goal 1')
    expect(() => h.service.get('p1')).toThrow('No plan with id p1.')
    expect(h.service.get('p21').goal).toBe('goal 20')
  })

  it('clips a stored answer to PLAN_ANSWER_MAX and the summary to 600 characters', async () => {
    const h = harness()
    const plan = h.service.create(planInput([step('a')]))
    await h.settle()
    h.setAnswer('s1', 'x'.repeat(PLAN_ANSWER_MAX))
    h.setPhase('s1', 'working')
    await h.service.tick()
    h.setPhase('s1', 'finished')
    await h.service.tick()

    expect(h.service.get(plan.id).steps[0].answer).toHaveLength(PLAN_ANSWER_MAX)
    expect(h.delivered[0]).toContain('x'.repeat(600))
    expect(h.delivered[0]).not.toContain('x'.repeat(601))
  })

  it('creates a session for a new target and fails the step when sending throws', async () => {
    const h = harness({
      send: () => {
        throw new Error('no room for that prompt')
      }
    })
    const plan = h.service.create(planInput([step('a', { target: { kind: 'new', name: 'fresh' } })]))
    await h.settle()
    expect(h.created).toEqual([{ id: 'new-1', name: 'fresh' }])
    const after = h.service.get(plan.id)
    expect(after.steps[0]).toMatchObject({ status: 'failed', problem: 'no room for that prompt' })
    expect(after.status).toBe('failed')
    expect(h.delivered).toHaveLength(1)
  })

  it('fails a step whose sendPrompt rejects later', async () => {
    const h = harness({ send: () => Promise.reject(new Error('the session died')) })
    const plan = h.service.create(planInput([step('a')]))
    await h.settle()
    expect(h.service.get(plan.id).steps[0]).toMatchObject({ status: 'failed', problem: 'the session died' })
    await h.service.tick()
    expect(h.service.get(plan.id).status).toBe('failed')
    expect(h.delivered).toHaveLength(1)
  })

  it('fails a step whose session is gone when it is started', async () => {
    const h = harness()
    h.service.create(
      planInput([
        step('a', { target: { kind: 'existing', session: 's1' } }),
        step('b', { target: { kind: 'existing', session: 's2' }, dependsOn: ['a'] })
      ])
    )
    await h.settle()
    h.forget('s2')
    h.setPhase('s1', 'working')
    await h.service.tick()
    h.setPhase('s1', 'finished')
    await h.service.tick()
    const plan = h.service.list()[0]
    expect(plan.steps[1]).toMatchObject({ status: 'failed', problem: 'Session "s2" was not found; the step was not started.' })
  })
})

describe('fillPrompt (D80)', () => {
  const answers = new Map([['a', 'x'.repeat(3000)], ['b', 'y'.repeat(3000)]])

  it('pastes answers that fit and leaves a prompt without slots alone', () => {
    expect(fillPrompt('use {{a}} now', new Map([['a', 'hello']]))).toBe('use hello now')
    expect(fillPrompt('no slots', answers)).toBe('no slots')
  })

  it('cuts answers so the whole prompt stays within the send limit, and refuses when there is no room', () => {
    const filled = fillPrompt('A: {{a}} B: {{b}}', answers)
    expect(filled.length).toBeLessThanOrEqual(4000)
    expect(filled).toContain('(cut)')
    expect(() => fillPrompt('z'.repeat(3990) + '{{a}}', answers)).toThrow('too long')
  })
})

describe('plan prompts and summaries stay within the send limit (D80 review)', () => {
  it('fails a step cleanly (and starts nothing) when the pasted prompt cannot fit', async () => {
    const h = harness()
    const plan = h.service.create(planInput([step('a'), step('b', { prompt: 'z'.repeat(3990) + '{{a}}', dependsOn: ['a'] })]))
    await h.settle()
    h.setAnswer('s1', 'x'.repeat(500))
    h.setPhase('s1', 'working')
    await h.service.tick()
    h.setPhase('s1', 'finished')
    await h.service.tick()
    await h.service.tick()
    expect(h.service.get(plan.id).steps[1]).toMatchObject({ status: 'failed', problem: expect.stringContaining('too long') })
  })

  it('keeps the [Plan finished] message under the send limit even with 8 long answers', async () => {
    const h = harness()
    const steps = Array.from({ length: 8 }, (_, index) => step(`s${index}`, { title: 'a long title '.repeat(5), target: { kind: 'existing', session: `s${index + 1}` } }))
    const plan = h.service.create(planInput(steps))
    await h.settle()
    for (let i = 0; i < 8; i += 1) h.setAnswer(`s${i + 1}`, 'x'.repeat(4000))
    for (let n = 0; n < 30 && h.service.get(plan.id).status === 'running'; n += 1) {
      for (let i = 0; i < 8; i += 1) h.setPhase(`s${i + 1}`, 'working')
      await h.service.tick()
      for (let i = 0; i < 8; i += 1) h.setPhase(`s${i + 1}`, 'finished')
      await h.service.tick()
    }
    expect(h.service.get(plan.id).status).toBe('done')
    expect(h.delivered).toHaveLength(1)
    expect(h.delivered[0].length).toBeLessThanOrEqual(4000)
  })

  it('does not judge a step while its prompt is still being typed (a slow wake), then waits for a real turn', async () => {
    let release: (value: string) => void = () => undefined
    const h = harness({ send: () => new Promise<string>((resolve) => { release = resolve }) })
    const plan = h.service.create(planInput([step('a')]))
    await h.settle()
    h.setPhase('s1', 'finished')
    h.advance(60_000)
    await h.service.tick()
    await h.service.tick()
    expect(h.service.get(plan.id).steps[0].status).toBe('running')
    release('Sent to it.')
    await h.settle()
    await h.service.tick()
    expect(h.service.get(plan.id).steps[0].status).toBe('running')
    h.setPhase('s1', 'working')
    await h.service.tick()
    h.setPhase('s1', 'finished')
    await h.service.tick()
    expect(h.service.get(plan.id).steps[0].status).toBe('done')
  })

  it('a lastAnswer that rejects gives (no answer was found) instead of stopping the tick', async () => {
    const h = harness({ answerError: 'export failed' })
    const plan = h.service.create(planInput([step('a')]))
    await h.settle()
    h.setPhase('s1', 'working')
    await h.service.tick()
    h.setPhase('s1', 'finished')
    await h.service.tick()
    expect(h.service.get(plan.id).steps[0]).toMatchObject({ status: 'done', answer: '(no answer was found)' })
  })

  it('trims text and drops duplicate dependencies when the plan is stored', async () => {
    const h = harness()
    const plan = h.service.create(planInput([step('a', { title: '  first  ' }), step('b', { dependsOn: ['a', 'a'] })]))
    expect(plan.steps[0].title).toBe('first')
    expect(plan.steps[1].dependsOn).toEqual(['a'])
  })
})
