// D80: shared shapes of a Jarvis task plan (a goal split into steps that run in sessions, some after others). The service
// (planService.ts) runs plans, the tools (planTools.ts) let Jarvis create and read them. Only types and limits live here.

export const PLAN_STEPS_MAX = 8
export const PLAN_ACTIVE_MAX = 3
export const PLAN_RUNNING_STEPS_MAX = 3
export const PLAN_GOAL_MAX = 300
export const PLAN_TITLE_MAX = 80
export const PLAN_PROMPT_MAX = 4000
/** What a finished step's answer keeps (it can be pasted into a later step with {{stepId}}). */
export const PLAN_ANSWER_MAX = 4000
/** A step that has run this long without finishing is marked failed (ms). */
export const PLAN_STEP_TIMEOUT_MS = 30 * 60_000

export type PlanStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'
export type PlanStatus = 'running' | 'done' | 'failed' | 'cancelled'

/** Where a step runs: an existing session (name or id), or a new one the plan creates. */
export type PlanStepTarget =
  | { readonly kind: 'existing'; readonly session: string }
  | { readonly kind: 'new'; readonly name: string; readonly cwd?: string; readonly agent?: 'claude' | 'opencode'; readonly model?: string }

export interface PlanStepInput {
  /** Short id other steps refer to in dependsOn and {{id}} (letters, digits, - and _; max 20). */
  readonly id: string
  readonly title: string
  readonly target: PlanStepTarget
  /** The prompt. {{otherStepId}} is replaced with that step's answer once it is done (a dependency). */
  readonly prompt: string
  readonly dependsOn: readonly string[]
}

export interface PlanInput {
  readonly goal: string
  readonly steps: readonly PlanStepInput[]
}

export interface PlanStep extends PlanStepInput {
  readonly status: PlanStepStatus
  /** The session the step ran in (set when it started). */
  readonly sessionId?: string
  readonly sessionName?: string
  readonly startedAt?: number
  readonly finishedAt?: number
  /** The step's reply (clipped to PLAN_ANSWER_MAX), once done. */
  readonly answer?: string
  /** Why it failed or was skipped. */
  readonly problem?: string
}

export interface Plan {
  readonly id: string
  readonly goal: string
  readonly status: PlanStatus
  readonly createdAt: number
  readonly finishedAt?: number
  readonly steps: readonly PlanStep[]
}

/** What the service needs from the app; everything is injected so unit tests use fakes. */
export interface PlanServiceDeps {
  /** The Settings toggle (jarvis.plansEnabled), read each time. */
  readonly enabled: () => boolean
  readonly now: () => number
  readonly newId: () => string
  /** An existing session by name or id (not Jarvis, not a worker tab); null when there is none or it is ambiguous. */
  readonly findSession: (ref: string) => { readonly id: string; readonly name: string } | null
  /** Creates a session for a 'new' step (same paths as the create_session tool). Throws with a clear message on failure. */
  readonly createSession: (target: Extract<PlanStepTarget, { readonly kind: 'new' }>) => { readonly id: string; readonly name: string }
  /** Sends the prompt like send_prompt (when=auto: starts or wakes the session, waits until it is ready, queues behind a running turn). Returns its result text. */
  readonly sendPrompt: (sessionId: string, text: string) => Promise<string>
  /**
   * Where the session is for plan purposes: 'working' (a turn runs, or a prompt was just sent), 'finished' (the turn is
   * done and the session is idle), 'waiting' (needs the user: permission or question), 'gone' (closed or removed).
   */
  readonly sessionPhase: (sessionId: string) => 'working' | 'finished' | 'waiting' | 'gone'
  /** The reply to the session's last prompt; null when there is none. */
  readonly lastAnswer: (sessionId: string) => Promise<string | null>
  /** Gives Jarvis a message (the same sender the schedules use). */
  readonly deliver: (message: string) => Promise<void>
  readonly log: (tool: string, detail: string) => void
  readonly setInterval: (callback: () => void, ms: number) => ReturnType<typeof setInterval>
  readonly clearInterval: (timer: ReturnType<typeof setInterval>) => void
  readonly onError: (where: string, error: unknown) => void
}

export interface PlanService {
  /** Validates and starts a plan. Throws an Error with a clear message when plans are off, the input is bad (unknown dependency, cycle, too many steps, unknown session) or too many plans are active. */
  create(input: PlanInput): Plan
  list(): readonly Plan[]
  get(id: string): Plan
  /** Cancels a running plan: no new step starts; sessions already working are left alone. Returns the plan. */
  cancel(id: string): Plan
  /** One scheduling pass (the timer calls it): start ready steps, finish running ones, deliver a summary when a plan ends. */
  tick(): Promise<void>
  start(): void
  stop(): void
}
