import { describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import type { AwaySummary, QueuedPrompt, RuntimeState, Session, StoreData, TimelineTurn, UsageState, WorktreeChanges } from '../../shared/types'
import { createJarvisTools, READY_TIMEOUT_MS, type JarvisToolDeps } from './jarvisTools'
import { createScheduleService } from './scheduleService'

const session = (id: string, name: string, extra: Partial<Session> = {}): Session => ({
  id, name, cwd: 'C:/p', groupId: null, statusId: null, order: 0, createdAt: 0, claudeArgs: [], ...extra
})
const running = (id: string, extra: Partial<RuntimeState> = {}): RuntimeState => ({ sessionId: id, run: 'running', exitCode: null, attention: null, ...extra })

const TRUST_MENU = 'Do you trust the files in this folder?\r\n  Yes, I trust this folder\r\n  No, exit\r\n'

function setup(sessions: Session[], runtime: RuntimeState[] = [], options: { confirm?: boolean } = {}) {
  let data: StoreData = {
    sessions,
    groups: [{ id: 'g1', name: 'Backend', collapsed: false }],
    statuses: [{ id: 'st1', name: 'Review', color: '#fff' }],
    repos: [{ id: 'r1', name: 'shop', path: 'C:/src/shop', createdAt: 0, collapsed: false }],
    worktrees: [{ id: 'w1', repoId: 'r1', name: 'checkout', branch: 'checkout', path: 'C:/wt/checkout', baseBranch: 'main', baseCommit: '0'.repeat(40), createdAt: 0, collapsed: false }],
    presets: [{ id: 'p1', name: 'api', cwd: tmpdir(), agent: 'claude', claudeArgs: ['--remote-control'], groupId: 'g1', statusId: null }]
  } as unknown as StoreData
  const states = new Map(runtime.map((r) => [r.sessionId, r]))
  let clock = 100_000
  const writes: Array<[string, string]> = []
  const raw = new Map<string, string>()
  const turns = new Map<string, TimelineTurn[]>()
  const startTimes = new Map<string, number>()
  const answers = new Map<string, string>()
  let usageState: UsageState = { account: null, sessions: [] }
  let away: AwaySummary | null = null
  const scheduleService = createScheduleService({
    readFile: async () => '',
    writeFile: async () => undefined,
    now: () => clock,
    newId: () => 'sch1',
    deliver: async () => undefined,
    onChange: () => undefined,
    setInterval: () => 0 as unknown as ReturnType<typeof setInterval>,
    clearInterval: () => undefined,
    onError: () => undefined
  })
  const setSession = (id: string, patch: Partial<Session>): void => {
    data = { ...data, sessions: data.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s)) }
  }
  const controller = {
    createSession: vi.fn((input) => {
      const created = session('new', input.name ?? 'folder', { cwd: input.cwd, agent: input.agent, groupId: input.groupId ?? null, claudeArgs: input.claudeArgs ?? [] })
      data = { ...data, sessions: [...data.sessions, created] }
      states.set('new', running('new'))
      startTimes.set('new', clock)
      return created
    }),
    forkSession: vi.fn((id: string) => session('fork', `${id} (fork)`)),
    removeSession: vi.fn(),
    removeWorktree: vi.fn(),
    closeSession: vi.fn(),
    reopenSession: vi.fn((id: string) => {
      setSession(id, { closedAt: undefined })
      states.set(id, running(id))
      startTimes.set(id, clock)
    }),
    restartSession: vi.fn(async () => undefined),
    sleepSession: vi.fn(),
    wakeSession: vi.fn((id: string) => {
      states.set(id, running(id))
      startTimes.set(id, clock)
      return true
    }),
    resumeInBackground: vi.fn(() => true),
    writeToPty: vi.fn((id: string, text: string) => {
      writes.push([id, text])
      if (text === '\r') states.set(id, { ...(states.get(id) ?? running(id)), activity: 'working' })
    })
  }
  const store = {
    renameSession: vi.fn(),
    setSessionStatus: vi.fn(),
    moveSession: vi.fn(),
    setSessionNotes: vi.fn(),
    setKeepAwake: vi.fn(),
    createGroup: vi.fn((name: string) => ({ id: 'g2', name })),
    removeGroup: vi.fn(),
    setSessionQueue: vi.fn((id: string, items: readonly QueuedPrompt[]) => setSession(id, { queue: items }))
  }
  const deps: JarvisToolDeps = {
    getData: () => data,
    getRuntime: (id) => states.get(id),
    controller,
    store,
    queueChanged: vi.fn(),
    screenText: async (id) => `screen of ${id}`,
    rawOutput: (id) => raw.get(id) ?? '',
    timeline: (id) => turns.get(id) ?? [],
    search: async () => ({ hits: [], truncated: false, searchedSessions: 0 }),
    lastAnswer: async (s) => answers.get(s.id) ?? null,
    usage: () => usageState,
    allTurns: () => [...turns.values()].flat(),
    lastAway: () => away,
    schedules: scheduleService,
    code: {
      addRepo: vi.fn(async (folder: string) => {
        const repo = { id: 'r2', name: 'added', path: folder, createdAt: 0, collapsed: false }
        data = { ...data, repos: [...(data.repos ?? []), repo] }
        return repo
      }),
      createWorktree: vi.fn(async (input: { repoId: string; name: string; baseBranch: string; agent: string }) => {
        const worktree = { id: 'w2', repoId: input.repoId, name: input.name, branch: 'login-fix', path: 'C:/wt/login-fix', baseBranch: input.baseBranch, baseCommit: '0'.repeat(40), createdAt: 0, collapsed: false }
        const created = session('ws', input.name, { cwd: worktree.path, worktreeId: 'w2', agent: input.agent as Session['agent'] })
        data = { ...data, worktrees: [...(data.worktrees ?? []), worktree], sessions: [...data.sessions, created] }
        states.set('ws', running('ws'))
        startTimes.set('ws', clock)
        return { worktree, session: created }
      }),
      branches: vi.fn(async () => ({ current: 'main', branches: ['dev', 'main'] })),
      changes: vi.fn(async (worktreeId: string): Promise<WorktreeChanges> => ({
        worktreeId,
        files: [
          { path: 'src/a.ts', kind: 'modified', additions: 10, deletions: 2 },
          { path: 'src/new.ts', oldPath: 'src/old.ts', kind: 'renamed', additions: 0, deletions: 0 },
          { path: 'logo.png', kind: 'added', additions: null, deletions: null }
        ],
        truncated: false, additions: 10, deletions: 2, computedAt: 0
      })),
      removeWorktree: vi.fn()
    },
    openSession: vi.fn(),
    confirm: vi.fn(async () => options.confirm ?? false),
    startedAt: (id) => startTimes.get(id) ?? 0,
    lastOutputAt: () => 0,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms
    },
    newId: () => 'q1',
    log: vi.fn()
  }
  const tools = createJarvisTools(deps)
  const call = (name: string, args: Record<string, unknown> = {}): Promise<string> => {
    const tool = tools.find((t) => t.name === name)
    if (tool === undefined) throw new Error(`no tool ${name}`)
    return tool.run(args)
  }
  return {
    call, controller, store, deps, code: deps.code as unknown as Record<string, ReturnType<typeof vi.fn>>, writes, raw, states, turns, startTimes, answers, data: () => data,
    setUsage: (u: UsageState) => { usageState = u },
    setAway: (a: AwaySummary | null) => { away = a }
  }
}

describe('jarvis tools', () => {
  it('lists sessions without Jarvis, with state, group and status', async () => {
    const { call } = setup([
      session('a', 'API', { groupId: 'g1', statusId: 'st1' }),
      session('b', 'Web', { closedAt: 1 }),
      session('j', 'Jarvis', { role: 'jarvis' })
    ], [running('a', { activity: 'working' })])
    const text = await call('list_sessions')
    expect(text).toContain('2 session(s):')
    expect(text).toContain('"API" (id a) · claude · running, working on a turn · group "Backend" · status "Review"')
    expect(text).toContain('"Web" (id b) · claude · closed')
    expect(text).not.toContain('Jarvis')
    expect(text).toContain('Presets: "api"')
    expect(await call('list_sessions', { include_closed: false })).not.toContain('"Web"')
  })

  it('types a prompt into an idle session, then Enter separately, and reports the turn started', async () => {
    const { call, writes } = setup([session('a', 'API')], [running('a', { activity: 'finished' })])
    expect(await call('send_prompt', { session: 'api', text: 'run the tests' })).toBe('Sent to "API"; it started working.')
    expect(writes).toEqual([['a', 'run the tests'], ['a', '\r']])
  })

  it('types into a session that only got Claude\'s idle reminder, and calls it idle (D54)', async () => {
    const { call, writes } = setup([session('a', 'API')], [running('a', { activity: 'needs-input', activityMessage: 'Claude is waiting for your input' })])
    expect(await call('list_sessions')).toContain('"API" (id a) · claude · running, idle ·')
    expect(await call('send_prompt', { session: 'API', text: 'go' })).toBe('Sent to "API"; it started working.')
    expect(writes.map((w) => w[1])).toEqual(['go', '\r'])
  })

  it('queues behind a real question instead of typing into it', async () => {
    const { call, writes } = setup([session('a', 'API')], [running('a', { activity: 'needs-input', activityMessage: 'Claude needs your permission to use Bash' })])
    expect(await call('send_prompt', { session: 'API', text: 'go' })).toContain('it is waiting for an answer right now')
    expect(writes).toEqual([])
  })

  it('queues the prompt while a turn is running', async () => {
    const { call, writes, data, deps } = setup([session('a', 'API')], [running('a', { activity: 'working' })])
    expect(await call('send_prompt', { session: 'API', text: 'next step' })).toContain('Queued for "API" (position 1)')
    expect(writes).toEqual([])
    expect(data().sessions[0].queue).toEqual([{ id: 'q1', text: 'next step', addedAt: expect.any(Number) }])
    expect(deps.queueChanged).toHaveBeenCalledWith('a')
  })

  it('wakes a sleeping session before typing', async () => {
    const { call, controller, writes } = setup([session('a', 'API')], [running('a', { sleeping: true })])
    expect(await call('send_prompt', { session: 'API', text: 'hello' })).toBe('Woke it first. Sent to "API"; it started working.')
    expect(controller.wakeSession).toHaveBeenCalledWith('a')
    expect(writes.map((w) => w[1])).toEqual(['hello', '\r'])
  })

  it('waits for a woken session whose old process is still exiting', async () => {
    const { call, controller, states, startTimes, deps, writes } = setup([session('a', 'API')], [running('a', { sleeping: true })])
    // The wake is accepted, but the session only runs again a little later (the old process had to exit first).
    controller.wakeSession.mockImplementationOnce((id: string) => {
      const at = deps.now() + 2000
      const realSleep = deps.sleep
      Object.assign(deps, {
        sleep: async (ms: number) => {
          await realSleep(ms)
          if (deps.now() >= at && !startTimes.has(id)) {
            states.set(id, running(id))
            startTimes.set(id, deps.now())
          }
        }
      })
      return true
    })
    expect(await call('send_prompt', { session: 'API', text: 'hello' })).toBe('Woke it first. Sent to "API"; it started working.')
    expect(writes.map((w) => w[1])).toEqual(['hello', '\r'])
  })

  it('does not type into a folder-trust question', async () => {
    const { call, raw, writes } = setup([session('a', 'API')], [running('a')])
    raw.set('a', TRUST_MENU)
    expect(await call('send_prompt', { session: 'API', text: 'hello' })).toContain('asking whether to trust its folder')
    expect(writes).toEqual([])
  })

  it('gives up when the screen never settles', async () => {
    const { call, deps } = setup([session('a', 'API')], [running('a')])
    let t = 0
    Object.assign(deps, { lastOutputAt: () => deps.now() - (t++ % 2) })
    await expect(call('send_prompt', { session: 'API', text: 'x' })).rejects.toThrow(`did not settle within ${READY_TIMEOUT_MS / 1000} s`)
  })

  it('sleeps, wakes (stopped -> start, closed -> reopen) and closes', async () => {
    const { call, controller } = setup([session('a', 'A'), session('b', 'B'), session('c', 'C', { closedAt: 5 })], [running('a'), { ...running('b'), run: 'exited' }])
    expect(await call('sleep_session', { session: 'A' })).toBe('"A" is asleep.')
    expect(controller.sleepSession).toHaveBeenCalledWith('a')
    expect(await call('wake_session', { session: 'B' })).toBe('"B" is starting.')
    expect(controller.resumeInBackground).toHaveBeenCalledWith('b')
    expect(await call('wake_session', { session: 'C' })).toBe('"C" was reopened.')
    expect(controller.reopenSession).toHaveBeenCalledWith('c')
    expect(await call('close_session', { session: 'A' })).toBe('"A" is closed.')
  })

  it('asks the user before removing; No changes nothing', async () => {
    const refused = setup([session('a', 'API')])
    expect(await refused.call('remove_session', { session: 'API' })).toContain('did not allow')
    expect(refused.controller.removeSession).not.toHaveBeenCalled()
    expect(refused.deps.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Jarvis: remove session', confirmLabel: 'Remove' }))

    const allowed = setup([session('a', 'API')], [], { confirm: true })
    expect(await allowed.call('remove_session', { session: 'API' })).toBe('"API" was removed.')
    expect(allowed.controller.removeSession).toHaveBeenCalledWith('a')
  })

  it('refuses an ambiguous name instead of guessing', async () => {
    const { call, controller } = setup([session('a', 'api one'), session('b', 'api two')], [], { confirm: true })
    await expect(call('remove_session', { session: 'api' })).rejects.toThrow('Ask the user which one')
    expect(controller.removeSession).not.toHaveBeenCalled()
  })

  it('creates a session from a preset, with group, Remote Control and a first prompt', async () => {
    const { call, controller, writes } = setup([])
    const text = await call('create_session', { preset: 'API', name: 'svc', prompt: 'hi' })
    expect(controller.createSession).toHaveBeenCalledWith(expect.objectContaining({ cwd: tmpdir(), name: 'svc', groupId: 'g1', agent: 'claude', claudeArgs: ['--remote-control'] }))
    expect(text).toContain('Created "svc"')
    expect(text).toContain('it started working')
    expect(writes.map((w) => w[1])).toEqual(['hi', '\r'])
  })

  it('rejects a relative or missing folder', async () => {
    const { call } = setup([])
    await expect(call('create_session', { folder: 'relative/path' })).rejects.toThrow('Use a full folder path')
    await expect(call('create_session', { folder: 'C:/definitely/not/here/xyz' })).rejects.toThrow('Folder not found')
  })

  it('presses named keys one by one', async () => {
    const { call, writes } = setup([session('a', 'API')], [running('a')])
    expect(await call('press_keys', { session: 'API', keys: ['down', 'enter', '1'] })).toBe('Pressed down, enter, 1 in "API".')
    expect(writes.map((w) => w[1])).toEqual(['\x1b[B', '\r', '1'])
    await expect(call('press_keys', { session: 'API', keys: ['f13'] })).rejects.toThrow('Unknown key "f13"')
  })

  it('organizes: status, group, notes, keep awake, rename', async () => {
    const { call, store } = setup([session('a', 'API', { notes: 'old' })])
    await call('set_status', { session: 'API', status: 'review' })
    expect(store.setSessionStatus).toHaveBeenCalledWith('a', 'st1')
    await call('set_status', { session: 'API', status: null })
    expect(store.setSessionStatus).toHaveBeenLastCalledWith('a', null)
    await call('move_to_group', { session: 'API', group: 'backend' })
    expect(store.moveSession).toHaveBeenCalledWith('a', 'g1', 0)
    await call('set_notes', { session: 'API', notes: 'new', append: true })
    expect(store.setSessionNotes).toHaveBeenCalledWith('a', 'old\nnew')
    await call('set_keep_awake', { session: 'API', keep_awake: true })
    expect(store.setKeepAwake).toHaveBeenCalledWith('a', true)
    await call('rename_session', { session: 'API', name: 'Backend API' })
    expect(store.renameSession).toHaveBeenCalledWith('a', 'Backend API')
  })

  it('waits until the turn and the queue are done, then points to the reply', async () => {
    const { call, states, deps } = setup([session('a', 'API')], [running('a', { activity: 'working' })])
    const started = deps.now()
    const realSleep = deps.sleep
    Object.assign(deps, {
      sleep: async (ms: number) => {
        await realSleep(ms)
        if (deps.now() - started >= 5000) states.set('a', running('a', { activity: 'finished' }))
      }
    })
    const text = await call('wait_for_session', { session: 'API' })
    expect(text.startsWith('"API" is running, idle (last turn finished) (waited 5 s). Use get_last_answer')).toBe(true)
  })

  it('stops waiting at the timeout and says to call again; a queued prompt counts as busy', async () => {
    const { call } = setup([session('a', 'API', { queue: [{ id: 'q', text: 'next', addedAt: 0 }] })], [running('a', { activity: 'finished' })])
    expect(await call('wait_for_session', { session: 'API', timeout_seconds: 3 })).toBe('"API" is still working after 3 s. Call wait_for_session again to keep waiting.')
  })

  it('says when the session waits for an answer', async () => {
    const { call } = setup([session('a', 'API')], [running('a', { activity: 'needs-input', activityMessage: 'Allow Bash?' })])
    expect(await call('wait_for_session', { session: 'API' })).toContain('waiting for an answer: use read_screen')
  })

  it('returns the last reply from the saved conversation, keeping the end of a long one', async () => {
    const { call, answers } = setup([session('a', 'API')], [running('a', { activity: 'finished' })])
    answers.set('a', 'All 42 tests passed.')
    expect(await call('get_last_answer', { session: 'API' })).toBe('Last reply of "API":\nAll 42 tests passed.')
    answers.set('a', 'x'.repeat(50) + 'THE END')
    expect(await call('get_last_answer', { session: 'API', max_chars: 7 })).toBe('Last reply of "API":\n…(start cut)\nTHE END')
  })

  it('falls back to the screen without a saved conversation', async () => {
    const { call } = setup([session('a', 'API', { agent: 'shell' })], [running('a')])
    const text = await call('get_last_answer', { session: 'API' })
    expect(text).toContain('No saved conversation to read')
    expect(text).toContain('screen of a')
  })

  it('reports plan usage, cost today and running sessions', async () => {
    const { call, setUsage, turns, deps } = setup([session('a', 'API')], [running('a')])
    const now = deps.now()
    setUsage({
      account: null,
      accounts: [{ provider: 'claude', fiveHour: { usedPercentage: 45.4, resetsAt: Math.round((now + 90 * 60_000) / 1000) }, sevenDay: { usedPercentage: 84, resetsAt: null }, updatedAt: now }],
      sessions: [{ sessionId: 'a', model: 'Sonnet 5.5', contextPercent: 12, costUsd: 0.5, effort: null, updatedAt: now }]
    })
    turns.set('a', [{ id: 't', sessionId: 'a', prompt: 'x', startedAt: now, endedAt: now, end: 'finished', costUsd: 1.25, neededYou: false }])
    const text = await call('get_usage')
    expect(text).toContain('Claude plan: 5-hour 45% used, resets in 1 h 30 min · weekly 84% used')
    expect(text).toContain('Cost of all sessions today: $1.25')
    expect(text).toContain('"API": Sonnet 5.5 · context 12% · $0.50 this session')
  })

  it('reports the away summary, or that there is none yet', async () => {
    const { call, setAway, deps } = setup([])
    expect(await call('get_away_summary')).toContain('No away summary yet')
    const now = deps.now()
    setAway({ since: now - 3_600_000, until: now - 60_000, sessions: [{ sessionId: 'a', name: 'API', finished: 2, needsYou: true, hitLimit: false, slept: false, costUsd: 0.3, lastPrompt: 'deploy', lastAt: now }], totals: { finished: 2, needsYou: 1, slept: 0, hitLimit: 0, costUsd: 0.3 } })
    const text = await call('get_away_summary')
    expect(text).toContain('2 finished, 1 need the user')
    expect(text).toContain('"API": 2 turn(s) finished · NEEDS THE USER · $0.30 · last prompt "deploy"')
  })

  it('lists repos with branches and worktrees', async () => {
    const { call } = setup([session('c', 'cart', { worktreeId: 'w1' })])
    const text = await call('list_repos')
    expect(text).toContain('- repo "shop" (id r1) · C:/src/shop · current branch main · branches: dev, main')
    expect(text).toContain('  - worktree "checkout" (id w1) · branch checkout from main · C:/wt/checkout · sessions: "cart"')
  })

  it('creates a worktree from the checked-out branch with a first prompt', async () => {
    const { call, code, writes } = setup([])
    const text = await call('create_worktree', { repo: 'shop', name: 'login fix', prompt: 'fix the login' })
    expect(code.createWorktree).toHaveBeenCalledWith({ repoId: 'r1', name: 'login fix', baseBranch: 'main', agent: 'claude' })
    expect(text).toContain('Created worktree "login fix" on branch login-fix (from main)')
    expect(text).toContain('it started working')
    expect(writes.map((w) => w[1])).toEqual(['fix the login', '\r'])
  })

  it('refuses an unknown base branch or repo', async () => {
    const { call, code } = setup([])
    await expect(call('create_worktree', { repo: 'shop', name: 'x', base_branch: 'nope' })).rejects.toThrow('No local branch "nope" in "shop". Branches: dev, main')
    await expect(call('create_worktree', { repo: 'other', name: 'x' })).rejects.toThrow('No repository matches "other". Repositories: "shop"')
    expect(code.createWorktree).not.toHaveBeenCalled()
  })

  it('summarizes the changes of a worktree', async () => {
    const { call } = setup([])
    const text = await call('worktree_changes', { worktree: 'checkout' })
    expect(text).toContain('"checkout" (branch checkout vs main): 3 file(s), +10 -2.')
    expect(text).toContain('- modified src/a.ts (+10 -2)')
    expect(text).toContain('- renamed src/old.ts -> src/new.ts (+0 -0)')
    expect(text).toContain('- added logo.png (+? -?)')
  })

  it('removes a worktree through the Code mode path after a Yes', async () => {
    const { call, code } = setup([], [], { confirm: true })
    expect(await call('remove_worktree', { worktree: 'checkout' })).toBe('Worktree "checkout" was removed.')
    expect(code.removeWorktree).toHaveBeenCalledWith('w1')
  })

  it('adds, lists and removes scheduled instructions', async () => {
    const { call } = setup([])
    const added = await call('schedule_add', { instruction: 'wake API and run the tests', time: '09:00', days: 'weekdays', label: 'morning tests' })
    expect(added).toContain('Scheduled (id sch1) 09:00 weekdays: "wake API and run the tests".')
    expect(added).toContain('Next run')
    const listed = await call('schedule_list')
    expect(listed).toContain('(id sch1) "morning tests" 09:00 weekdays · next ')
    await expect(call('schedule_add', { instruction: 'x', time: '9 am' })).rejects.toThrow('is not a time')
    expect(await call('schedule_remove', { schedule: 'Morning Tests' })).toBe('Removed the schedule 09:00 weekdays: "wake API and run the tests".')
    expect(await call('schedule_list')).toBe('No schedules.')
  })

  it('gives the scheduler the same prompt sender as send_prompt', async () => {
    const { deps, writes } = setup([session('a', 'API')], [running('a', { activity: 'finished' })])
    const toolkit = createJarvisTools(deps)
    expect(await toolkit.sendPrompt(deps.getData().sessions[0], 'scheduled hello', 'auto')).toBe('Sent to "API"; it started working.')
    expect(writes.map((w) => w[1])).toEqual(['scheduled hello', '\r'])
  })

  it('undoes the last reversible actions, newest first (D54)', async () => {
    const { call, controller, store } = setup([session('a', 'API', { statusId: null, notes: 'old notes' })], [running('a')])
    expect(await call('undo_last_action')).toBe('Nothing to undo.')
    await call('rename_session', { session: 'API', name: 'Backend' })
    await call('set_status', { session: 'API', status: 'review' })
    await call('sleep_session', { session: 'API' })
    expect(await call('undo_last_action')).toBe('Undone: sleep "API" (wake it). Next undo would be: set the status of "API" (put the old one back).')
    expect(controller.wakeSession).toHaveBeenCalledWith('a')
    await call('undo_last_action')
    expect(store.setSessionStatus).toHaveBeenLastCalledWith('a', null)
    await call('undo_last_action')
    expect(store.renameSession).toHaveBeenLastCalledWith('a', 'API')
    expect(await call('undo_last_action')).toBe('Nothing to undo.')
  })

  it('undoes close (reopen), notes, keep awake and a new group; removals are not on the stack', async () => {
    const { call, controller, store } = setup([session('a', 'API', { notes: 'keep me' }), session('b', 'Web')], [running('a'), running('b')], { confirm: true })
    await call('close_session', { session: 'Web' })
    await call('set_notes', { session: 'API', notes: 'new' })
    await call('set_keep_awake', { session: 'API', keep_awake: true })
    await call('create_group', { name: 'Tmp' })
    await call('remove_session', { session: 'Web' })
    await call('undo_last_action')
    expect(store.removeGroup).toHaveBeenCalledWith('g2')
    await call('undo_last_action')
    expect(store.setKeepAwake).toHaveBeenLastCalledWith('a', false)
    await call('undo_last_action')
    expect(store.setSessionNotes).toHaveBeenLastCalledWith('a', 'keep me')
    await call('undo_last_action')
    expect(controller.reopenSession).toHaveBeenCalledWith('b')
  })

  it('undoes a new schedule and a removed one', async () => {
    const { call } = setup([])
    await call('schedule_add', { instruction: 'run the tests', time: '07:30', days: ['mon', 'fri'] })
    await call('schedule_remove', { schedule: 'sch1' })
    expect(await call('schedule_list')).toBe('No schedules.')
    await call('undo_last_action')
    expect(await call('schedule_list')).toContain('07:30 mon, fri')
  })

  it('shows recent activity with cost today', async () => {
    const { call, turns, deps } = setup([session('a', 'API')])
    const now = deps.now()
    turns.set('a', [{ id: 't1', sessionId: 'a', prompt: 'fix bug', startedAt: now - 60_000, endedAt: now - 30_000, end: 'finished', costUsd: 0.25, neededYou: false }])
    const text = await call('get_activity', { session: 'API' })
    expect(text).toContain('1 turn(s) recorded')
    expect(text).toContain('finished · 30 s · $0.25 · "fix bug"')
  })
})
