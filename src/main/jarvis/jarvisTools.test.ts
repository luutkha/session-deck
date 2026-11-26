import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppSettings, AwaySummary, JarvisUiAction, QueuedPrompt, RuntimeState, Session, StoreData, TimelineTurn, UiMode, UsageState, WorktreeChanges } from '../../shared/types'
import { DEFAULT_APP_SETTINGS } from '../../shared/types'
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
    groupOrder: ['g1'],
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
  let settings: AppSettings = DEFAULT_APP_SETTINGS
  let codePoppedOut = false
  const uiCalls: Array<{ mode: UiMode | undefined; action: JarvisUiAction }> = []
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
    forkSession: vi.fn((id: string): Session | Promise<Session> => session('fork', `${id} (fork)`)),
    moveToOps: vi.fn((id: string, cwd: string, groupId: string | null): Session => {
      setSession(id, { worktreeId: undefined, cwd, groupId })
      return data.sessions.find((x) => x.id === id) as Session
    }),
    moveToWorktree: vi.fn((id: string, worktreeId: string): Session => {
      setSession(id, { worktreeId })
      return data.sessions.find((x) => x.id === id) as Session
    }),
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
    setOpencodeModel: vi.fn((_id: string, _model: string | undefined): 'restarted' | 'next-start' | 'restart-failed' => 'restarted'),
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
    setSessionTags: vi.fn((id: string, tags: readonly string[]) => setSession(id, { tags: tags.length > 0 ? [...tags] : undefined })),
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
          { path: 'src/a.ts', kind: 'modified', additions: 10, deletions: 2, uncommitted: true },
          { path: 'src/new.ts', oldPath: 'src/old.ts', kind: 'renamed', additions: 0, deletions: 0 },
          { path: 'logo.png', kind: 'added', additions: null, deletions: null }
        ],
        truncated: false, additions: 10, deletions: 2, computedAt: 0
      })),
      removeWorktree: vi.fn(),
      git: {
        branchStatus: vi.fn(async (worktreeId: string) => ({ worktreeId, branch: 'checkout', baseBranch: 'main', remote: 'origin', upstream: null, ahead: 2, behind: 0, uncommitted: 1, repoFolder: false, compareUrl: 'https://github.com/acme/shop/compare/main...checkout?expand=1', ghReady: false })),
        commit: vi.fn(async (input: { paths: readonly string[]; message: string }) => ({ sha: 'abcdef1234567890abcdef1234567890abcdef12', subject: input.message.split(/\r?\n/)[0], files: input.paths.length })),
        push: vi.fn(async () => ({ remote: 'origin', branch: 'checkout' })),
        createPr: vi.fn(async () => ({ url: 'https://github.com/acme/shop/compare/main...checkout?expand=1', created: false })),
        merge: vi.fn(async () => ({ merged: true, message: 'Merged checkout into main.' })),
        removalInfo: vi.fn(async (worktreeId: string) => ({ worktreeId, repoFolder: false, branch: 'checkout', baseBranch: 'main', path: 'C:/wt/checkout', uncommitted: 0, branchMerged: false, folderExists: true })),
        remove: vi.fn(async () => ({ folderDeleted: true, branchDeleted: false, note: 'The branch checkout has commits main does not have, so it was kept.' }))
      }
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
    log: vi.fn(),
    app: {
      getSettings: vi.fn(() => settings),
      updateSettings: vi.fn((patch: unknown) => {
        const p = patch as Record<string, Record<string, unknown>>
        const next = { ...settings } as unknown as Record<string, Record<string, unknown>>
        for (const [section, fields] of Object.entries(p)) {
          if (next[section] === undefined) throw new Error(`Invalid settings: unknown section "${section}"`)
          next[section] = { ...next[section], ...fields }
        }
        settings = next as unknown as AppSettings
        return settings
      }),
      setChecklist: vi.fn((id: string, items: unknown) => setSession(id, { checklist: items as Session['checklist'] })),
      sendQueuedNow: vi.fn(),
      renameGroup: vi.fn(),
      setGroupCollapsed: vi.fn(),
      reorderGroups: vi.fn(),
      upsertStatus: vi.fn(),
      removeStatus: vi.fn(),
      reorderStatuses: vi.fn(),
      savePreset: vi.fn(),
      removePreset: vi.fn(),
      clearAttention: vi.fn(),
      markUnread: vi.fn(),
      refreshUsage: vi.fn(async () => ({ ok: true as const })),
      autopilot: {
        state: vi.fn(async () => ({ sleptForQuota: ['a'], stoppedAtLimit: [], resetsAt: null })),
        sleepIdle: vi.fn(async () => ['a']),
        wake: vi.fn(async () => ['a'])
      },
      removeRepo: vi.fn(),
      fileDiff: vi.fn(async (worktreeId: string, path: string) => ({ worktreeId, path, diff: '@@ -1 +1 @@\n-old\n+new\n', binary: false, truncated: false })),
      workers: vi.fn(() => [{ id: 'wk1', name: 'tests runner', model: 'm', status: 'running' as const, statusDetail: '', startedAt: 0, finishedAt: null, costUsd: 0.5, tokens: 1, dir: 'C:/p', ownerSessionIds: ['a'], lines: [] }]),
      windowState: vi.fn(() => ({ codePoppedOut })),
      popOutCode: vi.fn(),
      dockCode: vi.fn()
    },
    control: {
      setRepoCollapsed: vi.fn(),
      setWorktreeCollapsed: vi.fn(),
      openLink: vi.fn(async (_id: string, link: string) => (link.includes('missing') ? { ok: false, error: 'Not found' } : link.endsWith('.bat') ? { ok: true, kind: 'file' as const, revealed: true } : { ok: true, kind: 'url' as const })),
      pathKind: vi.fn(async (p: string) => (p.includes('missing') ? null : p.endsWith('dir') ? 'folder' as const : 'file' as const)),
      copyImage: vi.fn(() => true),
      loginItem: { get: vi.fn(() => ({ supported: true, openAtLogin: false })), set: vi.fn((on: boolean) => ({ supported: true, openAtLogin: on })) },
      showWindow: vi.fn(),
      hideWindow: vi.fn(),
      quit: vi.fn()
    },
    system: {
      systemInfo: vi.fn(() => ({ platform: 'win32', osRelease: '10.0', arch: 'x64', cpuModel: 'Test CPU', cpuCores: 8, totalMemoryMB: 16384, freeMemoryMB: 8192, displays: [{ widthPx: 1920, heightPx: 1080, scaleFactor: 1 }] })),
      getGpu: vi.fn(async () => ({ mode: 'hardware' as const, renderer: 'Test GPU', accelerationDisabled: false, webgl: 'enabled', pref: 'auto' as const })),
      setGpuPref: vi.fn()
    },
    ui: vi.fn(async (mode: UiMode | undefined, action: JarvisUiAction) => {
      uiCalls.push({ mode, action })
      return `ui ${action.kind}`
    })
  }
  const tools = createJarvisTools(deps)
  const call = (name: string, args: Record<string, unknown> = {}): Promise<string> => {
    const tool = tools.find((t) => t.name === name)
    if (tool === undefined) throw new Error(`no tool ${name}`)
    return tool.run(args)
  }
  return {
    call, controller, store, deps, code: deps.code as unknown as Record<string, ReturnType<typeof vi.fn>> & { git: Record<string, ReturnType<typeof vi.fn>> }, writes, raw, states, turns, startTimes, answers, data: () => data,
    setUsage: (u: UsageState) => { usageState = u },
    setAway: (a: AwaySummary | null) => { away = a },
    app: deps.app as unknown as Record<string, ReturnType<typeof vi.fn>> & { autopilot: Record<string, ReturnType<typeof vi.fn>> },
    control: deps.control as unknown as Record<string, ReturnType<typeof vi.fn>> & { loginItem: Record<string, ReturnType<typeof vi.fn>> },
    uiCalls,
    settings: () => settings,
    setCodePoppedOut: (v: boolean) => { codePoppedOut = v }
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

  it('returns an OpenCode session\'s last reply from its exported conversation (D79)', async () => {
    const { call, answers } = setup([session('o', 'OC Agent', { agent: 'opencode', opencodeSessionId: 'ses_abc123' })], [running('o', { activity: 'finished' })])
    answers.set('o', 'Deploy finished on port 8080')
    expect(await call('get_last_answer', { session: 'OC Agent' })).toBe('Last reply of "OC Agent":\nDeploy finished on port 8080')
  })

  it('returns a Cursor session\'s last reply from the hook answer (D81)', async () => {
    const { call, answers } = setup([session('c', 'Cursor Agent', { agent: 'cursor', cursorChatId: 'chat_12345678' })], [running('c', { activity: 'finished' })])
    answers.set('c', 'All 42 tests passed.')
    expect(await call('get_last_answer', { session: 'Cursor Agent' })).toBe('Last reply of "Cursor Agent":\nAll 42 tests passed.')
  })

  it('accepts a Cursor model when creating a session (D81)', async () => {
    const { call, controller } = setup([])
    await call('create_session', { folder: tmpdir(), name: 'cur', agent: 'cursor', model: 'gpt-5' })
    expect(controller.createSession).toHaveBeenCalledWith(expect.objectContaining({ agent: 'cursor', model: 'gpt-5' }))
    await expect(call('create_session', { folder: tmpdir(), name: 'bad', agent: 'cursor', model: 'not a model!' })).rejects.toThrow('not a Cursor model')
  })

  it('falls back to the screen for an OpenCode session without a conversation id (D79)', async () => {
    const { call } = setup([session('o', 'OC Agent', { agent: 'opencode' })], [running('o')])
    const text = await call('get_last_answer', { session: 'OC Agent' })
    expect(text).toContain('No saved conversation to read')
    expect(text).toContain('screen of o')
  })

  it('falls back to the screen when an OpenCode export has no reply (D79)', async () => {
    const { call } = setup([session('o', 'OC Agent', { agent: 'opencode', opencodeSessionId: 'ses_abc123' })], [running('o', { activity: 'working' })])
    const text = await call('get_last_answer', { session: 'OC Agent' })
    expect(text).toContain('No saved conversation to read')
    expect(text).toContain('screen of o')
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

  it('opens an existing branch or the repo folder, and refuses a branch open elsewhere (D57)', async () => {
    const { call, code } = setup([])
    code.branches.mockResolvedValue({ current: 'main', branches: ['dev', 'main'], checkedOut: [{ branch: 'main', path: 'C:/src/shop' }] })
    await call('create_worktree', { repo: 'shop', existing_branch: 'dev' })
    expect(code.createWorktree).toHaveBeenLastCalledWith({ repoId: 'r1', name: 'dev', baseBranch: 'main', agent: 'claude', source: 'existing', branch: 'dev' })
    await call('create_worktree', { repo: 'shop', repo_folder: true })
    expect(code.createWorktree).toHaveBeenLastCalledWith({ repoId: 'r1', name: 'shop', baseBranch: 'main', agent: 'claude', source: 'main' })
    await expect(call('create_worktree', { repo: 'shop', existing_branch: 'main' })).rejects.toThrow('Branch "main" is already open in C:/src/shop')
    await expect(call('create_worktree', { repo: 'shop', existing_branch: 'dev', repo_folder: true })).rejects.toThrow('not both')
    await expect(call('create_worktree', { repo: 'shop' })).rejects.toThrow('"name" is required')
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
    expect(text).toContain('- modified src/a.ts (+10 -2) uncommitted')
    expect(text).toContain('- renamed src/old.ts -> src/new.ts (+0 -0)')
    expect(text).toContain('- added logo.png (+? -?)')
  })

  it('removes a worktree through the Code mode path after a Yes', async () => {
    const { call, code } = setup([], [], { confirm: true })
    expect(await call('remove_worktree', { worktree: 'checkout' })).toBe('Worktree "checkout" was removed.')
    expect(code.removeWorktree).toHaveBeenCalledWith('w1')
  })

  it('D60: branch status, commit (all uncommitted by default), push / PR / merge after a Yes', async () => {
    const { call, code } = setup([], [], { confirm: true })
    expect(await call('branch_status', { worktree: 'checkout' })).toContain('1 uncommitted file(s); never pushed to origin, 2 commit(s) to push; Create PR opens https://github.com/acme/shop/compare/main...checkout?expand=1')
    expect(await call('commit_worktree', { worktree: 'checkout', message: 'fix: checkout' })).toBe('Committed 1 file(s) in "checkout" as abcdef1 "fix: checkout". Not pushed yet.')
    expect(code.git.commit).toHaveBeenCalledWith({ worktreeId: 'w1', message: 'fix: checkout', paths: ['src/a.ts'] })
    await call('commit_worktree', { worktree: 'checkout', message: 'two', files: ['src/a.ts', 'logo.png'] })
    expect(code.git.commit).toHaveBeenLastCalledWith({ worktreeId: 'w1', message: 'two', paths: ['src/a.ts', 'logo.png'] })
    expect(await call('push_worktree', { worktree: 'checkout' })).toBe('Pushed checkout to origin.')
    expect(await call('create_pr', { worktree: 'checkout', title: 'Fix' })).toContain('Opened the pull request page in the browser')
    expect(code.git.createPr).toHaveBeenCalledWith('w1', { title: 'Fix' })
    expect(await call('merge_worktree', { worktree: 'checkout' })).toBe('Merged checkout into main.')
  })

  it('D60: push, PR and merge do nothing on a No', async () => {
    const { call, code } = setup([])
    expect(await call('push_worktree', { worktree: 'checkout' })).toContain('did not allow')
    expect(await call('create_pr', { worktree: 'checkout' })).toContain('did not allow')
    expect(await call('merge_worktree', { worktree: 'checkout' })).toContain('did not allow')
    expect(code.git.push).not.toHaveBeenCalled()
    expect(code.git.createPr).not.toHaveBeenCalled()
    expect(code.git.merge).not.toHaveBeenCalled()
  })

  it('D60: remove_worktree delete_from_disk goes through the git path and reports what stayed', async () => {
    const { call, code } = setup([], [], { confirm: true })
    const result = await call('remove_worktree', { worktree: 'checkout', delete_from_disk: true })
    expect(result).toBe('Worktree "checkout" was removed. Folder deleted, branch kept. The branch checkout has commits main does not have, so it was kept.')
    expect(code.git.remove).toHaveBeenCalledWith('w1', { deleteFromDisk: true, discardChanges: false, deleteUnmergedBranch: false })
    expect(code.removeWorktree).not.toHaveBeenCalled()
    code.git.removalInfo.mockResolvedValueOnce({ worktreeId: 'w1', repoFolder: false, branch: 'checkout', baseBranch: 'main', path: 'C:/wt/checkout', uncommitted: 2, branchMerged: true, folderExists: true })
    await expect(call('remove_worktree', { worktree: 'checkout', delete_from_disk: true })).rejects.toThrow('2 uncommitted file(s)')
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

describe('Jarvis app tools (D55)', () => {
  it('offers every new tool exactly once', () => {
    const t = setup([session('a', 'API')])
    const names = ['get_settings', 'update_settings', 'queue_list', 'queue_change', 'checklist_get', 'checklist_change', 'group_change', 'status_change', 'preset_change', 'bulk_action', 'needs_you', 'set_read', 'refresh_usage', 'quota_autopilot', 'cost_report', 'remove_repo', 'file_diff', 'send_review_comments', 'list_workers', 'code_window', 'get_screen_state', 'switch_mode', 'set_view', 'set_grid', 'split_view', 'show_sidebar', 'side_panel', 'changes_step_file', 'changes_set_layout', 'preview_file', 'open_dialog', 'terminal_zoom', 'worker_tab']
    for (const name of names) expect(t.call(name, {}).catch(() => 'ok')).toBeDefined()
    const all = createJarvisTools(t.deps).map((tool) => tool.name)
    expect(new Set(all).size).toBe(all.length)
    for (const name of names) expect(all).toContain(name)
  })

  it('reads settings and changes them through the validated path, with undo', async () => {
    const t = setup([session('a', 'API')])
    expect(await t.call('get_settings', { section: 'sleep' })).toContain('"')
    await expect(t.call('get_settings', { section: 'nope' })).rejects.toThrow('No settings section')
    const before = t.settings().tray
    const key = Object.keys(before)[0]
    const out = await t.call('update_settings', { changes: { tray: { [key]: 'changed' } } })
    expect(out).toContain('Settings saved')
    expect(t.app.updateSettings).toHaveBeenCalledWith({ tray: { [key]: 'changed' } })
    expect(await t.call('undo_last_action')).toContain('Undone: change settings tray')
    expect(t.app.updateSettings).toHaveBeenLastCalledWith({ tray: { [key]: (before as unknown as Record<string, unknown>)[key] } })
    await expect(t.call('update_settings', { changes: 'x' })).rejects.toThrow('must be an object')
    await expect(t.call('update_settings', { changes: { bogus: {} } })).rejects.toThrow('unknown section')
  })

  it('edits the prompt queue: add at a position, move, remove, clear, send now; undo restores', async () => {
    const t = setup([session('a', 'API', { queue: [{ id: 'x', text: 'first', addedAt: 0 }] })], [running('a')])
    expect(await t.call('queue_change', { session: 'API', action: 'add', text: 'zero', position: 1 })).toContain('number 1')
    expect(t.data().sessions[0].queue?.map((q) => q.text)).toEqual(['zero', 'first'])
    expect(t.deps.queueChanged).toHaveBeenCalledWith('a')
    await t.call('queue_change', { session: 'API', action: 'move', item: 'zero', to: 2 })
    expect(t.data().sessions[0].queue?.map((q) => q.text)).toEqual(['first', 'zero'])
    expect(await t.call('queue_list', { session: 'API' })).toContain('2. zero')
    await t.call('queue_change', { session: 'API', action: 'remove', item: 1 })
    expect(t.data().sessions[0].queue?.map((q) => q.text)).toEqual(['zero'])
    await t.call('undo_last_action')
    expect(t.data().sessions[0].queue?.map((q) => q.text)).toEqual(['first', 'zero'])
    await t.call('queue_change', { session: 'API', action: 'send_now', item: '2' })
    expect(t.app.sendQueuedNow).toHaveBeenCalledWith('a', 'q1')
    expect(await t.call('queue_change', { session: 'API', action: 'clear' })).toContain('Cleared 2')
    await expect(t.call('queue_change', { session: 'API', action: 'remove', item: 3 })).rejects.toThrow('no queued prompt number 3')
  })

  it('edits the checklist and undoes it', async () => {
    const t = setup([session('a', 'API', { checklist: [{ id: 'c1', text: 'write tests', done: false }] })])
    await t.call('checklist_change', { session: 'API', action: 'add', items: ['ship it', ' '] })
    expect(t.data().sessions[0].checklist?.map((c) => c.text)).toEqual(['write tests', 'ship it'])
    await t.call('checklist_change', { session: 'API', action: 'check', item: 'tests' })
    expect(t.data().sessions[0].checklist?.[0].done).toBe(true)
    expect(await t.call('checklist_get', { session: 'API' })).toContain('1/2 done')
    await t.call('undo_last_action')
    expect(t.data().sessions[0].checklist?.[0].done).toBe(false)
    await expect(t.call('checklist_change', { session: 'API', action: 'add', items: [] })).rejects.toThrow('Give "items"')
  })

  it('renames, collapses and reorders groups, with undo', async () => {
    const t = setup([session('a', 'API')])
    await t.call('group_change', { action: 'rename', group: 'Backend', name: 'Server' })
    expect(t.app.renameGroup).toHaveBeenCalledWith('g1', 'Server')
    await t.call('undo_last_action')
    expect(t.app.renameGroup).toHaveBeenLastCalledWith('g1', 'Backend')
    await t.call('group_change', { action: 'collapse', group: 'Backend' })
    expect(t.app.setGroupCollapsed).toHaveBeenCalledWith('g1', true)
    await t.call('group_change', { action: 'reorder', order: ['Backend'] })
    expect(t.app.reorderGroups).toHaveBeenCalledWith(['g1'])
  })

  it('creates, updates and reorders statuses; removing one asks first', async () => {
    const t = setup([session('a', 'API', { statusId: 'st1' })])
    await t.call('status_change', { action: 'create', name: 'Blocked', color: '#ff0000' })
    expect(t.app.upsertStatus).toHaveBeenCalledWith({ id: 'q1', name: 'Blocked', color: '#ff0000' })
    await t.call('undo_last_action')
    expect(t.app.removeStatus).toHaveBeenCalledWith('q1')
    await t.call('status_change', { action: 'update', status: 'Review', color: '#00ff00' })
    expect(t.app.upsertStatus).toHaveBeenLastCalledWith({ id: 'st1', name: 'Review', color: '#00ff00' })
    expect(await t.call('status_change', { action: 'remove', status: 'Review' })).toContain('did not allow')
    expect(t.app.removeStatus).toHaveBeenCalledTimes(1)
    const yes = setup([session('a', 'API')], [], { confirm: true })
    expect(await yes.call('status_change', { action: 'remove', status: 'Review' })).toContain('was deleted')
    expect(yes.app.removeStatus).toHaveBeenCalledWith('st1')
  })

  it('lists, saves and removes presets', async () => {
    const t = setup([session('a', 'API')], [], { confirm: true })
    expect(await t.call('preset_change', { action: 'list' })).toContain('"api"')
    await t.call('preset_change', { action: 'save', name: 'web', folder: 'C:/web', agent: 'opencode', model: 'x/y', group: 'Backend' })
    expect(t.app.savePreset).toHaveBeenCalledWith({ id: 'q1', name: 'web', cwd: 'C:/web', agent: 'opencode', model: 'x/y', claudeArgs: [], groupId: 'g1', statusId: null })
    await t.call('preset_change', { action: 'save', name: 'api', remote_control: false })
    expect(t.app.savePreset).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'p1', claudeArgs: [] }))
    await t.call('undo_last_action')
    expect(t.app.savePreset).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'p1', claudeArgs: ['--remote-control'] }))
    await expect(t.call('preset_change', { action: 'save', name: 'new-one' })).rejects.toThrow('"folder" is required')
    expect(await t.call('preset_change', { action: 'remove', name: 'api' })).toContain('was deleted')
    expect(t.app.removePreset).toHaveBeenCalledWith('p1')
  })

  it('runs a bulk action through the single-session tools and reports each one', async () => {
    const t = setup([session('a', 'API', { groupId: 'g1' }), session('b', 'Web', { groupId: 'g1' }), session('c', 'Docs')], [running('a'), running('b'), running('c', { sleeping: true })])
    const out = await t.call('bulk_action', { action: 'sleep', which: 'running', group: 'Backend' })
    expect(out).toContain('2 session(s)')
    expect(t.controller.sleepSession.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
    await t.call('bulk_action', { action: 'set_status', value: 'Review', sessions: ['Docs'] })
    expect(t.store.setSessionStatus).toHaveBeenCalledWith('c', 'st1')
    await t.call('bulk_action', { action: 'mark_unread', which: 'sleeping' })
    expect(t.app.markUnread).toHaveBeenCalledWith('c')
    expect(await t.call('bulk_action', { action: 'wake', which: 'closed' })).toContain('No sessions match')
    await expect(t.call('bulk_action', { action: 'sleep' })).rejects.toThrow('Say which sessions')
  })

  it('lists who needs the user and marks read or unread', async () => {
    const t = setup([session('a', 'API'), session('b', 'Web')], [running('a', { attention: 'permission', activityMessage: 'Allow Bash?' }), running('b')])
    const out = await t.call('needs_you')
    expect(out).toContain('"API": waiting for permission')
    expect(out).toContain('Allow Bash?')
    expect(out).not.toContain('Web')
    await t.call('set_read', { session: 'API', read: true })
    expect(t.app.clearAttention).toHaveBeenCalledWith('a')
  })

  it('refreshes usage, drives the quota autopilot and reports costs', async () => {
    const t = setup([session('a', 'API')], [running('a')])
    expect(await t.call('refresh_usage')).toContain('Refreshed.')
    t.app.refreshUsage.mockResolvedValueOnce({ ok: false, error: { kind: 'consent', message: 'Allow it first', retryAfterMs: null } })
    await expect(t.call('refresh_usage')).rejects.toThrow('Allow it first')
    expect(await t.call('quota_autopilot', { action: 'status' })).toContain('Held for the quota (asleep): "API"')
    expect(await t.call('quota_autopilot', { action: 'sleep_idle' })).toContain('"API"')
    expect(await t.call('quota_autopilot', { action: 'wake_held' })).toContain('Woke')
    expect(t.app.autopilot.wake).toHaveBeenCalledWith(true)
    const now = t.deps.now()
    t.turns.set('a', [{ id: 't', sessionId: 'a', prompt: 'x', startedAt: now, endedAt: now, end: 'finished', costUsd: 1.25, neededYou: false }] as TimelineTurn[])
    const costs = await t.call('cost_report', { days: 2 })
    expect(costs).toContain('$1.25 in total')
    expect(costs).toContain('"API": $1.25')
  })

  it('Code mode: removes a repo after a Yes, shows a file diff, sends review comments', async () => {
    const t = setup([session('ws1', 'checkout', { worktreeId: 'w1' })], [running('ws1')], { confirm: true })
    expect(await t.call('remove_repo', { repo: 'shop' })).toContain('was removed')
    expect(t.app.removeRepo).toHaveBeenCalledWith('r1')
    expect(await t.call('file_diff', { worktree: 'checkout', path: 'src/a.ts' })).toContain('+new')
    t.startTimes.set('ws1', 0)
    const sent = await t.call('send_review_comments', { worktree: 'checkout', comments: [{ path: 'src/a.ts', line: 3, text: 'rename this' }] })
    expect(sent).toContain('checkout')
    const typed = t.writes.filter(([id]) => id === 'ws1').map(([, text]) => text).join('')
    expect(typed).toContain('Review comments on the current changes')
    expect(typed).toContain('- src/a.ts:3 — rename this')
    await expect(t.call('send_review_comments', { worktree: 'checkout', comments: [] })).rejects.toThrow('Give 1 to')
  })

  it('lists workers and pops out or docks the Code window', async () => {
    const t = setup([session('a', 'API')])
    expect(await t.call('list_workers', { session: 'API' })).toContain('"tests runner"')
    expect(await t.call('code_window', { action: 'dock' })).toContain('not open')
    await t.call('code_window', { action: 'pop_out' })
    expect(t.app.popOutCode).toHaveBeenCalled()
  })
})

describe('Jarvis screen tools (D55)', () => {
  it('sends screen actions to the window with the mode of their sessions', async () => {
    const t = setup([session('a', 'API'), session('b', 'Web'), session('w', 'checkout', { worktreeId: 'w1' })])
    expect(await t.call('get_screen_state')).toContain('Code window: docked')
    await t.call('set_view', { view: 'hub' })
    expect(t.uiCalls.at(-1)).toEqual({ mode: undefined, action: { kind: 'view', view: 'hub' } })
    await t.call('set_grid', { preset: '2x1', cells: ['API', null] })
    expect(t.uiCalls.at(-1)).toEqual({ mode: 'ops', action: { kind: 'grid', preset: '2x1', cells: ['a', null] } })
    await expect(t.call('set_grid', { cells: ['API', 'checkout'] })).rejects.toThrow('different modes')
    await expect(t.call('set_grid', { preset: '1x1', cells: ['API', 'Web'] })).rejects.toThrow('has 1 cell')
    await expect(t.call('set_grid', { cells: ['API', 'API'] })).rejects.toThrow('one cell only')
    await t.call('split_view', { how: 'down', session: 'checkout' })
    expect(t.uiCalls.at(-1)).toEqual({ mode: 'code', action: { kind: 'openToSide', id: 'w', direction: 'down' } })
    await t.call('open_dialog', { name: 'settings', page: 'quota' })
    expect(t.uiCalls.at(-1)?.action).toEqual({ kind: 'dialog', name: 'settings', section: 'quota' })
    await t.call('terminal_zoom', { action: 'in', steps: 3 })
    expect(t.uiCalls.filter((c) => c.action.kind === 'zoom')).toHaveLength(3)
  })

  it('switch_mode brings the popped-out Code window forward instead', async () => {
    const t = setup([session('a', 'API')])
    t.setCodePoppedOut(true)
    expect(await t.call('switch_mode', { mode: 'code' })).toContain('own window')
    expect(t.app.popOutCode).toHaveBeenCalled()
    expect(t.uiCalls).toHaveLength(0)
    await t.call('switch_mode', { mode: 'ops' })
    expect(t.uiCalls.at(-1)?.action).toEqual({ kind: 'mode', mode: 'ops' })
  })

  it('opens the side panel for a session (shows it first) and refuses Changes outside a worktree', async () => {
    const t = setup([session('a', 'API')])
    await t.call('side_panel', { open: true, tab: 'queue', session: 'API' })
    expect(t.deps.openSession).toHaveBeenCalledWith('a')
    expect(t.uiCalls.at(-1)).toEqual({ mode: 'ops', action: { kind: 'sidePanel', open: true, tab: 'queue' } })
    await expect(t.call('side_panel', { open: true, tab: 'changes', session: 'API' })).rejects.toThrow('not in a worktree')
  })

  it('previews a file in the side panel viewer, for a given session or the one on screen (D74)', async () => {
    // The tool checks the file exists, so these are REAL files.
    const dir = mkdtempSync(join(tmpdir(), 'sd-preview-file-'))
    mkdirSync(join(dir, 'docs'))
    mkdirSync(join(dir, 'wt'))
    writeFileSync(join(dir, 'README.md'), '# r')
    writeFileSync(join(dir, 'docs', 'notes.md'), '# n')
    writeFileSync(join(dir, 'wt', 'notes.md'), '# w')
    try {
      const t = setup(
        [
          session('a', 'API', { cwd: dir }),
          session('w', 'checkout', { worktreeId: 'w1', cwd: join(dir, 'wt') })
        ],
        [running('a'), running('w')]
      )
      const readme = join(dir, 'README.md')
      await t.call('preview_file', { path: readme, session: 'API' })
      expect(t.deps.openSession).toHaveBeenCalledWith('a')
      expect(t.uiCalls.at(-1)).toEqual({ mode: 'ops', action: { kind: 'previewFile', sessionId: 'a', text: readme } })
      await t.call('preview_file', { path: 'notes.md', session: 'checkout' })
      expect(t.uiCalls.at(-1)).toEqual({ mode: 'code', action: { kind: 'previewFile', sessionId: 'w', text: 'notes.md' } })
      await expect(t.call('preview_file', { path: 'C:\\p\\app.exe', session: 'API' })).rejects.toThrow('Supported: Markdown')
      await expect(t.call('preview_file', {})).rejects.toThrow('"path" is required')

      // No session given: the one the main window shows (its state text names it).
      vi.mocked(t.deps.ui).mockImplementation(async (mode, action) => {
        if (action.kind === 'state') return 'Mode: Ops' + String.fromCharCode(10) + 'On screen: "API"'
        t.uiCalls.push({ mode, action })
        return `ui ${action.kind}`
      })
      expect(await t.call('preview_file', { path: 'docs/notes.md' })).toBe('ui previewFile')
      expect(t.uiCalls.at(-1)).toEqual({ mode: 'ops', action: { kind: 'previewFile', sessionId: 'a', text: 'docs/notes.md' } })

      // A position suffix is fine: the file is the one before it, and the text is passed on as given.
      expect(await t.call('preview_file', { path: 'docs/notes.md:12:3' })).toBe('ui previewFile')
      expect(t.uiCalls.at(-1)).toEqual({ mode: 'ops', action: { kind: 'previewFile', sessionId: 'a', text: 'docs/notes.md:12:3' } })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('preview_file says so when the file is missing, a folder or a network path, and shows nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sd-preview-missing-'))
    mkdirSync(join(dir, 'folder.md'))
    try {
      const t = setup([session('a', 'API', { cwd: dir })], [running('a')])
      const before = t.uiCalls.length
      await expect(t.call('preview_file', { path: 'missing.md', session: 'API' })).rejects.toThrow('File not found')
      await expect(t.call('preview_file', { path: 'folder.md', session: 'API' })).rejects.toThrow('Not a file')
      await expect(t.call('preview_file', { path: '\\\\server\\share\\x.md', session: 'API' })).rejects.toThrow('Network paths')
      expect(t.uiCalls.length).toBe(before) // nothing was sent to the window
      expect(t.deps.openSession).not.toHaveBeenCalled()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('shows or dismisses a worker tab by name', async () => {
    const t = setup([session('a', 'API')])
    await t.call('worker_tab', { op: 'show', worker: 'tests' })
    expect(t.uiCalls.at(-1)).toEqual({ mode: 'ops', action: { kind: 'worker', op: 'show', workerId: 'wk1' } })
    await expect(t.call('worker_tab', { op: 'dismiss', worker: 'nope' })).rejects.toThrow('No worker matches')
  })
})

describe('jarvis tools: the rest of the app (D58)', () => {
  it('sets notification sounds through the window, checking events, sounds and files', async () => {
    const t = setup([session('a', 'API')])
    await t.call('sound_settings', { enabled: false, volume: 40, event: 'done', sound: 'Marimba', test: true })
    expect(t.uiCalls.at(-1)).toEqual({ mode: undefined, action: { kind: 'sound', enabled: false, volume: 0.4, events: { done: { kind: 'builtin', id: 'marimba' } }, test: 'done' } })
    await t.call('sound_settings', { event: 'bell', sound: 'C:/sounds/ding.wav' })
    expect(t.uiCalls.at(-1)?.action).toEqual({ kind: 'sound', events: { bell: { kind: 'file', path: 'C:/sounds/ding.wav' } } })
    await expect(t.call('sound_settings', { event: 'bell', sound: 'C:/missing.wav' })).rejects.toThrow('No audio file')
    await expect(t.call('sound_settings', { sound: 'pop' })).rejects.toThrow('which "event"')
    await expect(t.call('sound_settings', { event: 'done', sound: 'kazoo' })).rejects.toThrow('"sound" must be one of')
    await expect(t.call('sound_settings', { volume: 150 })).rejects.toThrow('0 to 100')
  })

  it('changes the sidebar view with status names resolved to ids', async () => {
    const t = setup([session('a', 'API')])
    await t.call('sidebar_view', { group_by: 'status', show_folders: false, search: '', status_filter: ['review', 'none'], closed_section: 'expanded', sections: 'collapse_all' })
    expect(t.uiCalls.at(-1)?.action).toEqual({ kind: 'sidebarView', groupBy: 'status', showWorkspaces: false, search: '', statusFilter: ['st1', null], closedSection: 'expanded', sections: 'collapseAll' })
    await expect(t.call('sidebar_view', {})).rejects.toThrow('Say what to change')
    await expect(t.call('sidebar_view', { status_filter: ['nope'] })).rejects.toThrow()
  })

  it('sets the session sort (D61)', async () => {
    const t = setup([session('a', 'API')])
    await t.call('sidebar_view', { sort: 'attention', mode: 'code' })
    expect(t.uiCalls.at(-1)).toEqual({ mode: 'code', action: { kind: 'sidebarView', sort: 'attention' } })
    await expect(t.call('sidebar_view', { sort: 'size' })).rejects.toThrow('"sort" must be one of manual, attention, recent, newest, name')
  })

  it('collapses one worktree, one repo or the whole Code tree, with undo', async () => {
    const t = setup([session('a', 'API')])
    expect(await t.call('code_tree', { action: 'collapse', worktree: 'checkout' })).toBe('Worktree "checkout" is collapsed.')
    expect(t.control.setWorktreeCollapsed).toHaveBeenCalledWith('w1', true)
    await t.call('code_tree', { action: 'expand' })
    expect(t.control.setRepoCollapsed).toHaveBeenCalledWith('r1', false)
    await t.call('undo_last_action')
    expect(t.control.setRepoCollapsed).toHaveBeenLastCalledWith('r1', false)
    expect(t.control.setWorktreeCollapsed).toHaveBeenLastCalledWith('w1', false)
  })

  it('opens a changed file in the Changes panel next to its session', async () => {
    const t = setup([session('w', 'Checkout', { worktreeId: 'w1' })])
    await t.call('open_file', { session: 'checkout', path: 'logo.png', view: 'preview' })
    expect(t.deps.openSession).toHaveBeenCalledWith('w')
    expect(t.uiCalls.slice(-2)).toEqual([
      { mode: 'code', action: { kind: 'sidePanel', open: true, tab: 'changes' } },
      { mode: 'code', action: { kind: 'changesFile', worktreeId: 'w1', path: 'logo.png', view: 'preview' } }
    ])
    await t.call('open_file', { worktree: 'checkout', path: 'a.ts' })
    expect(t.uiCalls.at(-1)?.action).toEqual({ kind: 'changesFile', worktreeId: 'w1', path: 'src/a.ts', view: 'diff' })
    await expect(t.call('open_file', { session: 'checkout', path: 'nope.ts' })).rejects.toThrow('not among the changed files')
    const ops = setup([session('a', 'API')])
    await expect(ops.call('open_file', { session: 'api', path: 'x' })).rejects.toThrow('not in a worktree')
  })

  it('searches the terminal, switches tabs', async () => {
    const t = setup([session('a', 'API')])
    await t.call('terminal_search', { action: 'find', query: 'error', session: 'api' })
    expect(t.deps.openSession).toHaveBeenCalledWith('a')
    expect(t.uiCalls.at(-1)).toEqual({ mode: 'ops', action: { kind: 'search', op: 'find', query: 'error' } })
    await expect(t.call('terminal_search', { action: 'find' })).rejects.toThrow('"query" is required')
    await t.call('switch_tab', { op: 'close_others' })
    expect(t.uiCalls.at(-1)?.action).toEqual({ kind: 'tabs', op: 'closeOthers' })
  })

  it('attaches files as a bracketed paste when the agent asked for it, or an image through the clipboard', async () => {
    const t = setup([session('a', 'API'), session('o', 'Open', { agent: 'opencode' })], [running('a'), running('o')])
    t.raw.set('a', '\x1b[?2004l...\x1b[?2004h>')
    expect(await t.call('attach_files', { session: 'api', paths: ['C:/shots/a b.png', 'C:/src/dir'] })).toContain('Attached 2 file(s)')
    expect(t.writes.at(-1)).toEqual(['a', '\x1b[200~"C:/shots/a b.png" C:/src/dir \x1b[201~'])
    await t.call('attach_files', { session: 'open', paths: ['C:/shots/x.png'], image_via_clipboard: true })
    expect(t.control.copyImage).toHaveBeenCalledWith('C:/shots/x.png')
    expect(t.writes.at(-1)).toEqual(['o', '\x16'])
    await expect(t.call('attach_files', { session: 'api', paths: ['C:/missing.txt'] })).rejects.toThrow('Nothing at')
    await expect(t.call('attach_files', { session: 'api', paths: ['relative.txt'] })).rejects.toThrow('not a full path')
    t.raw.set('a', '')
    await t.call('attach_files', { session: 'api', paths: ['C:/x.txt'] })
    expect(t.writes.at(-1)).toEqual(['a', 'C:/x.txt '])
  })

  it('opens terminal links and runs the app window actions; quit asks first', async () => {
    const t = setup([session('a', 'API')])
    expect(await t.call('open_link', { session: 'api', link: 'https://example.com', reveal: false })).toBe('Opened https://example.com (url).')
    await expect(t.call('open_link', { session: 'api', link: 'missing.txt' })).rejects.toThrow('Not found')
    expect(await t.call('open_link', { session: 'api', link: 'run.bat' })).toContain('selected in its folder (programs and scripts are never run)')
    await t.call('app_window', { action: 'hide' })
    expect(t.control.hideWindow).toHaveBeenCalled()
    expect(await t.call('app_window', { action: 'start_on_login' })).toBe('Start on login is on.')
    expect(t.control.loginItem.set).toHaveBeenCalledWith(true)
    expect(await t.call('app_window', { action: 'quit' })).toContain('said no')
    expect(t.control.quit).not.toHaveBeenCalled()
  })
})

describe('Jarvis set_session_model (D79)', () => {
  const MODEL = 'opencode/deepseek-v4.1-flash-free'

  it('changes the model of a running OpenCode session and undoes it with the old model', async () => {
    const { call, controller } = setup(
      [session('o', 'Open', { agent: 'opencode', model: 'p/old' })],
      [running('o')]
    )
    expect(await call('set_session_model', { session: 'open', model: MODEL })).toBe(
      `"Open" now runs ${MODEL}; its conversation was restarted on it.`
    )
    expect(controller.setOpencodeModel).toHaveBeenCalledWith('o', MODEL)
    expect(await call('undo_last_action')).toContain('Undone: change the model of "Open"')
    expect(controller.setOpencodeModel).toHaveBeenLastCalledWith('o', 'p/old')
  })

  it('says when the new model only applies at the next start (sleeping, stopped, closed or no conversation)', async () => {
    const t = setup([session('o', 'Open', { agent: 'opencode', closedAt: 3 })])
    t.controller.setOpencodeModel.mockReturnValueOnce('next-start')
    expect(await t.call('set_session_model', { session: 'open', model: MODEL })).toContain('it starts on it the next time')
  })

  it('reports a session that was not restarted (model stored, asleep)', async () => {
    const t = setup([session('o', 'Open', { agent: 'opencode' })], [running('o')])
    t.controller.setOpencodeModel.mockReturnValueOnce('restart-failed')
    const text = await t.call('set_session_model', { session: 'open', model: MODEL })
    expect(text).toContain(`now uses ${MODEL}`)
    expect(text).toContain('could not be started again')
    expect(text).toContain('wake_session')
  })

  it('refuses Claude and shell sessions with a clear message and changes nothing', async () => {
    const { call, controller } = setup([session('a', 'API'), session('s', 'Shell', { agent: 'shell' })])
    await expect(call('set_session_model', { session: 'api', model: MODEL })).rejects.toThrow('"API" is a Claude session')
    await expect(call('set_session_model', { session: 'api', model: MODEL })).rejects.toThrow('Only OpenCode and Cursor sessions can change model here.')
    await expect(call('set_session_model', { session: 'shell', model: MODEL })).rejects.toThrow('"Shell" is a shell session')
    expect(controller.setOpencodeModel).not.toHaveBeenCalled()
  })

  it('changes a Cursor session\'s model with a plain name and undoes it with the old one (D81)', async () => {
    const { call, controller } = setup(
      [session('c', 'Cursor', { agent: 'cursor', model: 'gpt-5', cursorChatId: 'chat_12345678' })],
      [running('c')]
    )
    expect(await call('set_session_model', { session: 'cursor', model: 'sonnet-4-thinking' })).toBe(
      '"Cursor" now runs sonnet-4-thinking; its conversation was restarted on it.'
    )
    expect(controller.setOpencodeModel).toHaveBeenCalledWith('c', 'sonnet-4-thinking')
    expect(await call('undo_last_action')).toContain('Undone: change the model of "Cursor"')
    expect(controller.setOpencodeModel).toHaveBeenLastCalledWith('c', 'gpt-5')
  })

  it('an empty model puts a Cursor or OpenCode session back on the agent default (D81)', async () => {
    const { call, controller } = setup(
      [session('c', 'Cursor', { agent: 'cursor', model: 'gpt-5', cursorChatId: 'chat_12345678' }), session('o', 'Open', { agent: 'opencode', model: 'p/old' })],
      [running('c'), running('o')]
    )
    expect(await call('set_session_model', { session: 'cursor', model: '' })).toBe("\"Cursor\" now runs the agent's default model; its conversation was restarted on it.")
    expect(controller.setOpencodeModel).toHaveBeenLastCalledWith('c', undefined)
    await call('set_session_model', { session: 'open', model: '   ' })
    expect(controller.setOpencodeModel).toHaveBeenLastCalledWith('o', undefined)
    expect(await call('undo_last_action')).toContain('Undone: change the model of "Open"')
    expect(controller.setOpencodeModel).toHaveBeenLastCalledWith('o', 'p/old')
  })

  it('reopening a session closed a moment ago waits for its old process to exit (D81)', async () => {
    const { call, controller } = setup([session('c', 'C', { agent: 'cursor', closedAt: 5 })])
    const real = controller.reopenSession.getMockImplementation()
    let attempts = 0
    controller.reopenSession.mockImplementation((id: string) => {
      attempts += 1
      if (attempts < 3) throw new Error(`Session is still stopping: ${id}`)
      real?.(id)
    })
    expect(await call('wake_session', { session: 'C' })).toBe('"C" was reopened.')
    expect(attempts).toBe(3)
  })

  it('refuses a bad Cursor model name before touching the session', async () => {
    const { call, controller } = setup([session('c', 'Cursor', { agent: 'cursor' })])
    await expect(call('set_session_model', { session: 'cursor', model: 'not a model!' })).rejects.toThrow(
      '"not a model!" is not a Cursor model name: use letters, digits and . _ : / @ - only, like gpt-5 or sonnet-4-thinking.'
    )
    expect(controller.setOpencodeModel).not.toHaveBeenCalled()
  })

  it('refuses a flag-looking, malformed or over-long model before touching the session', async () => {
    const { call, controller } = setup([session('o', 'Open', { agent: 'opencode' })])
    await expect(call('set_session_model', { session: 'open', model: '-rf' })).rejects.toThrow('looks like a command flag')
    await expect(call('set_session_model', { session: 'open', model: 'provider model' })).rejects.toThrow('is not a model id')
    await expect(call('set_session_model', { session: 'open', model: `p/${'x'.repeat(120)}` })).rejects.toThrow('too long')
    await expect(call('set_session_model', { session: 'open' })).rejects.toThrow('"model" is required')
    expect(controller.setOpencodeModel).not.toHaveBeenCalled()
  })
})

describe('Jarvis fork_session (D79)', () => {
  it('calls an OpenCode result a copy, not a true fork', async () => {
    const t = setup([session('o', 'Open', { agent: 'opencode', opencodeSessionId: 'ses_abc12345678' })])
    t.controller.forkSession.mockReturnValueOnce(Promise.resolve(session('c', 'Open (fork)', { agent: 'opencode' })))
    expect(await t.call('fork_session', { session: 'open' })).toBe(
      'Copied "Open" into "Open (fork)" (id c). OpenCode has no true fork: this is a copy of its conversation, so the two now move apart.'
    )
  })

  it('still forks a Claude session and reports what the controller refused', async () => {
    const t = setup([session('a', 'API'), session('w', 'Web')])
    expect(await t.call('fork_session', { session: 'api' })).toBe('Forked "API" into "a (fork)" (id fork).')
    t.controller.forkSession.mockRejectedValueOnce(new Error('Nothing to fork yet: this session has no saved conversation.'))
    await expect(t.call('fork_session', { session: 'web' })).rejects.toThrow('Nothing to fork yet')
  })
})

describe('G9: tags and Changes panel tools', () => {
  it('replaces and clears tags, lists them, and undoes back to the old tags', async () => {
    const t = setup([session('a', 'API', { tags: ['old'] })])
    expect(await t.call('set_session_tags', { session: 'api', tags: ['#work', 'Urgent'] })).toContain('Set the tags of "API"')
    expect(t.store.setSessionTags).toHaveBeenCalledWith('a', ['#work', 'Urgent'])
    expect(t.data().sessions[0].tags).toEqual(['#work', 'Urgent'])
    expect(await t.call('list_sessions')).toContain('tags "#work", "Urgent"')
    expect(await t.call('undo_last_action')).toContain('Undone: change the tags of "API"')
    expect(t.store.setSessionTags).toHaveBeenLastCalledWith('a', ['old'])
    expect(t.data().sessions[0].tags).toEqual(['old'])
    await t.call('set_session_tags', { session: 'api', tags: [] })
    expect(t.data().sessions[0].tags).toBeUndefined()
  })

  it('rejects an unknown session and bad tags before writing', async () => {
    const t = setup([session('a', 'API')])
    await expect(t.call('set_session_tags', { session: 'nope', tags: ['x'] })).rejects.toThrow('No session matches "nope"')
    await expect(t.call('set_session_tags', { session: 'api', tags: 'x' })).rejects.toThrow('"tags" must be an array of strings')
    await expect(t.call('set_session_tags', { session: 'api', tags: [1] })).rejects.toThrow('"tags" must be an array of strings')
    await expect(t.call('set_session_tags', { session: 'api', tags: ['x'.repeat(25)] })).rejects.toThrow('longer than 24 characters')
    await expect(t.call('set_session_tags', { session: 'api', tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })).rejects.toThrow('At most 10 tags')
    expect(t.store.setSessionTags).not.toHaveBeenCalled()
  })

  it('steps the Changes panel of a named worktree session, or the one on screen', async () => {
    const t = setup([session('w', 'Checkout', { worktreeId: 'w1' }), session('a', 'API')])
    expect(await t.call('changes_step_file', { session: 'checkout', direction: 'next' })).toBe('ui changesStep')
    expect(t.deps.openSession).toHaveBeenCalledWith('w')
    expect(t.uiCalls.slice(-2)).toEqual([
      { mode: 'code', action: { kind: 'sidePanel', open: true, tab: 'changes' } },
      { mode: 'code', action: { kind: 'changesStep', worktreeId: 'w1', delta: 1 } }
    ])
    vi.mocked(t.deps.ui).mockResolvedValueOnce('Mode: Code\nOn screen: "Checkout"')
    await t.call('changes_step_file', { direction: 'previous' })
    expect(t.uiCalls.at(-1)).toEqual({ mode: 'code', action: { kind: 'changesStep', worktreeId: 'w1', delta: -1 } })
    expect(t.deps.openSession).toHaveBeenCalledTimes(1)
  })

  it('refuses an unknown session, a non-worktree session and bad step arguments', async () => {
    const t = setup([session('w', 'Checkout', { worktreeId: 'w1' }), session('a', 'API')])
    await expect(t.call('changes_step_file', { session: 'nope', direction: 'next' })).rejects.toThrow('No session matches "nope"')
    await expect(t.call('changes_step_file', { session: 'api', direction: 'next' })).rejects.toThrow('not in a worktree')
    await expect(t.call('changes_step_file', { session: 'checkout' })).rejects.toThrow('"direction" is required')
    await expect(t.call('changes_step_file', { session: 'checkout', direction: 'sideways' })).rejects.toThrow('"direction" must be next or previous')
    expect(t.uiCalls).toHaveLength(0)
  })

  it('switches the Changes panel tree and side-by-side layout of a worktree session', async () => {
    const t = setup([session('w', 'Checkout', { worktreeId: 'w1' })])
    await t.call('changes_set_layout', { session: 'checkout', tree: true })
    expect(t.uiCalls.at(-1)).toEqual({ mode: 'code', action: { kind: 'changesLayout', worktreeId: 'w1', tree: true } })
    await t.call('changes_set_layout', { session: 'checkout', sideBySide: false })
    expect(t.uiCalls.at(-1)).toEqual({ mode: 'code', action: { kind: 'changesLayout', worktreeId: 'w1', sideBySide: false } })
    vi.mocked(t.deps.ui).mockResolvedValueOnce('Mode: Code\nOn screen: "Checkout"')
    await t.call('changes_set_layout', { tree: false, side_by_side: true })
    expect(t.uiCalls.at(-1)).toEqual({ mode: 'code', action: { kind: 'changesLayout', worktreeId: 'w1', tree: false, sideBySide: true } })
  })

  it('refuses a layout change without a field, with bad fields or on a non-worktree session', async () => {
    const t = setup([session('w', 'Checkout', { worktreeId: 'w1' }), session('a', 'API')])
    await expect(t.call('changes_set_layout', { session: 'checkout' })).rejects.toThrow('Give tree or sideBySide')
    await expect(t.call('changes_set_layout', { session: 'checkout', tree: 'yes' })).rejects.toThrow('"tree" must be true or false')
    await expect(t.call('changes_set_layout', { session: 'checkout', sideBySide: 1 })).rejects.toThrow('"sideBySide" must be true or false')
    await expect(t.call('changes_set_layout', { session: 'nope', tree: true })).rejects.toThrow('No session matches "nope"')
    await expect(t.call('changes_set_layout', { session: 'api', tree: true })).rejects.toThrow('not in a worktree')
    expect(t.uiCalls).toHaveLength(0)
  })
})

describe('Jarvis move_session_to_code (D88)', () => {
  it('asks first, then moves the Ops session into the named worktree', async () => {
    const t = setup([session('a', 'Docs')], [], { confirm: true })
    expect(await t.call('move_session_to_code', { session: 'docs', worktree: 'checkout' })).toContain('Moved "Docs" into worktree "checkout"')
    expect(t.deps.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Jarvis: move session to Code mode', confirmLabel: 'Move' }))
    expect(t.controller.moveToWorktree).toHaveBeenCalledWith('a', 'w1')
  })

  it('registers an undo that puts the session back in its old folder and group', async () => {
    const t = setup([session('a', 'Docs', { cwd: 'C:/notes', groupId: 'g1' })], [], { confirm: true })
    await t.call('move_session_to_code', { session: 'docs', worktree: 'checkout' })
    expect(await t.call('undo_last_action', {})).toContain('move "Docs" back to Ops')
    expect(t.controller.moveToOps).toHaveBeenCalledWith('a', 'C:/notes', 'g1')
  })

  it('does nothing when the user declines', async () => {
    const t = setup([session('a', 'Docs')], [], { confirm: false })
    expect(await t.call('move_session_to_code', { session: 'docs', worktree: 'checkout' })).toContain('declined')
    expect(t.controller.moveToWorktree).not.toHaveBeenCalled()
  })

  it('refuses a session that is already in a worktree, without asking', async () => {
    const t = setup([session('a', 'Docs', { worktreeId: 'w1' })], [], { confirm: true })
    await expect(t.call('move_session_to_code', { session: 'docs', worktree: 'checkout' })).rejects.toThrow('already a Code session')
    expect(t.deps.confirm).not.toHaveBeenCalled()
  })
})
