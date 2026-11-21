import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { HookEvent, JarvisSettings, Session, StoreData } from '../../shared/types'
import { IPC } from '../../shared/ipc'
import type { SessionController } from '../app/sessionController'
import type { SessionStore } from '../store'
import { createJarvisWiring, jarvisSwitchPlan, type JarvisWiringDeps } from './jarvisWiring'

// jarvisWiring registers IPC handlers only in registerIpc; no test here calls it, but the import must resolve.
vi.mock('electron', () => ({ ipcMain: { handle: (): void => undefined } }))

const session = (id: string, name: string, extra: Partial<Session> = {}): Session => ({
  id, name, cwd: 'C:/p', groupId: null, statusId: null, order: 0, createdAt: 0, claudeArgs: [], ...extra
})

function wiring(
  sessions: readonly Session[],
  lastAnswer: (session: Session) => Promise<string | null>
): { onHookEvent: (event: HookEvent) => void; broadcast: ReturnType<typeof vi.fn>; onError: ReturnType<typeof vi.fn>; lastAnswer: ReturnType<typeof vi.fn> } {
  const broadcast = vi.fn()
  const onError = vi.fn()
  const answer = vi.fn(lastAnswer)
  // The tool mechanics are not used by onHookEvent (lastAnswer is); the rest only has to exist when tools are built.
  const tools = {
    lastAnswer: answer,
    getData: () => ({ sessions } as unknown as StoreData),
    getRuntime: () => undefined,
    store: {},
    queueChanged: () => undefined,
    screenText: async () => '',
    rawOutput: () => '',
    timeline: () => [],
    search: async () => ({ hits: [], truncated: false, searchedSessions: 0 }),
    usage: () => ({ account: null, sessions: [] }),
    allTurns: () => [],
    lastAway: () => null,
    controller: {},
    app: {},
    ui: {},
    control: {},
    system: {},
    code: { git: {} }
  } as unknown as JarvisWiringDeps['tools']
  const store = {
    get: () => ({ sessions } as unknown as StoreData),
    getSettings: () => ({ jarvis: { agent: 'claude', model: '', opencodeModel: '' } })
  } as unknown as SessionStore
  const jarvis = createJarvisWiring({
    userDataDir: join(tmpdir(), 'sessiondeck-jarvis-wiring-test'),
    store,
    controller: {} as unknown as SessionController,
    tools,
    sendConfirm: () => false,
    sendUi: () => false,
    appVersion: '0',
    broadcast,
    notify: () => undefined,
    onError
  })
  return { onHookEvent: (event) => jarvis.onHookEvent(event), broadcast, onError, lastAnswer: answer }
}

describe('createJarvisWiring onHookEvent (D54/D79)', () => {
  it('sends a finished Claude Jarvis turn to the panel as before', async () => {
    const { onHookEvent, broadcast } = wiring([session('j', 'Jarvis', { role: 'jarvis' })], async () => 'All 42 tests passed.')
    onHookEvent({ event: 'Stop', sessionId: 'j' })
    await vi.waitFor(() => expect(broadcast).toHaveBeenCalledWith(IPC.evJarvisReply, 'All 42 tests passed.'))
  })

  it('sends a finished OpenCode Jarvis turn read from its export (D79)', async () => {
    const { onHookEvent, broadcast, lastAnswer } = wiring(
      [session('j', 'Jarvis', { role: 'jarvis', agent: 'opencode', opencodeSessionId: 'ses_abc123' })],
      async () => 'Deploy finished on port 8080'
    )
    onHookEvent({ event: 'Stop', sessionId: 'j' })
    await vi.waitFor(() => expect(broadcast).toHaveBeenCalledWith(IPC.evJarvisReply, 'Deploy finished on port 8080'))
    expect(lastAnswer).toHaveBeenCalledTimes(1)
  })

  it('does nothing for an OpenCode Jarvis with no conversation id or no readable export (today\'s behaviour)', async () => {
    const noId = wiring([session('j', 'Jarvis', { role: 'jarvis', agent: 'opencode' })], async () => 'should not be read')
    noId.onHookEvent({ event: 'Stop', sessionId: 'j' })
    expect(noId.lastAnswer).not.toHaveBeenCalled()
    expect(noId.broadcast).not.toHaveBeenCalled()

    const empty = wiring(
      [session('j', 'Jarvis', { role: 'jarvis', agent: 'opencode', opencodeSessionId: 'ses_abc123' })],
      async () => null
    )
    empty.onHookEvent({ event: 'Stop', sessionId: 'j' })
    await vi.waitFor(() => expect(empty.lastAnswer).toHaveBeenCalledTimes(1))
    expect(empty.broadcast).not.toHaveBeenCalled()
  })

  it('ignores other events and sessions that are not Jarvis', () => {
    const { onHookEvent, broadcast, lastAnswer } = wiring(
      [session('j', 'Jarvis', { role: 'jarvis' }), session('a', 'API')],
      async () => 'answer'
    )
    onHookEvent({ event: 'Notification', sessionId: 'j' })
    onHookEvent({ event: 'Stop', sessionId: 'a' })
    expect(lastAnswer).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()
  })
})

describe('jarvisSwitchPlan (D54/D79)', () => {
  const settings = (agent: 'claude' | 'opencode', opencodeModel = '', model = 'sonnet'): JarvisSettings => ({ agent, model, opencodeModel })

  it('does nothing without a Jarvis, for the same engine, or for a Claude model change', () => {
    expect(jarvisSwitchPlan(undefined, settings('opencode', 'p/m'))).toEqual({ kind: 'none' })
    expect(jarvisSwitchPlan(session('j', 'Jarvis'), settings('claude'))).toEqual({ kind: 'none' })
    expect(jarvisSwitchPlan(session('j', 'Jarvis', { agent: 'claude' }), settings('claude', '', 'opus'))).toEqual({ kind: 'none' })
    expect(jarvisSwitchPlan(session('j', 'Jarvis', { agent: 'opencode', model: 'p/m' }), settings('opencode', 'p/m'))).toEqual({ kind: 'none' })
  })

  it('keeps an OpenCode conversation on a model change (the controller restarts it with -s)', () => {
    expect(jarvisSwitchPlan(session('j', 'Jarvis', { agent: 'opencode', model: 'p/old' }), settings('opencode', 'p/new'))).toEqual({
      kind: 'model',
      model: 'p/new'
    })
    // Clearing the model (OpenCode's own default) also keeps the conversation.
    expect(jarvisSwitchPlan(session('j', 'Jarvis', { agent: 'opencode', model: 'p/old' }), settings('opencode', ''))).toEqual({
      kind: 'model',
      model: undefined
    })
    // A session created before a model was set gets one now.
    expect(jarvisSwitchPlan(session('j', 'Jarvis', { agent: 'opencode' }), settings('opencode', 'p/new'))).toEqual({
      kind: 'model',
      model: 'p/new'
    })
  })

  it('recreates Jarvis when the engine changes, or when a stored model id has no place on a session', () => {
    expect(jarvisSwitchPlan(session('j', 'Jarvis'), settings('opencode', 'p/m'))).toEqual({ kind: 'recreate' })
    expect(jarvisSwitchPlan(session('j', 'Jarvis', { agent: 'opencode', model: 'p/m' }), settings('claude'))).toEqual({ kind: 'recreate' })
    // The settings rule allows "@"; the per-session rule does not, so such a value still switches (as a new conversation).
    expect(jarvisSwitchPlan(session('j', 'Jarvis', { agent: 'opencode', model: 'p/old' }), settings('opencode', 'p/m@latest'))).toEqual({
      kind: 'recreate'
    })
  })
})
