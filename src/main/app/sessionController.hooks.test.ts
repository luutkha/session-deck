import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Id, RuntimeState, Session, StoreData } from '../../shared/types'
import { SessionStore } from '../store'
import type { PtyManager } from '../pty/PtyManager'
import type { AttentionService } from '../attention/AttentionService'
import { createRuntimeRegistry } from './runtimeRegistry'
import { createSessionController } from './sessionController'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sessiondeck-hooks-'))
  dirs.push(dir)
  return dir
}

function session(overrides: Partial<Session> & { id: Id }): Session {
  return {
    name: overrides.id,
    cwd: '/tmp/x',
    groupId: null,
    statusId: 'todo',
    order: 0,
    createdAt: 1,
    claudeArgs: [],
    ...overrides
  }
}

function data(sessions: Session[]): StoreData {
  return {
    version: 1,
    sessions,
    groups: [],
    statuses: [
      { id: 'todo', name: 'Todo', color: '#9e9e9e' },
      { id: 'working', name: 'Working', color: '#42a5f5' },
      { id: 'waiting', name: 'Waiting', color: '#ffb300' },
      { id: 'review', name: 'Review', color: '#ab47bc' },
      { id: 'done', name: 'Done', color: '#66bb6a' }
    ],
    groupOrder: []
  }
}

/**
 * The hook path only touches the store and the runtime registry. The pty and attention collaborators are inert
 * stubs, cast once here because the controller needs the full interfaces at construction time.
 */
function setup(sessions: Session[]) {
  const store = new SessionStore(data(sessions), { schedule: vi.fn() }, { newId: () => 'x', now: () => 10 })
  const runtime = createRuntimeRegistry()
  let dataHandler: (id: Id, data: string, seq: number) => void = () => {}
  const pty = {
    onData: (handler: typeof dataHandler): void => {
      dataHandler = handler
    },
    onExit: (): void => {},
    isRunning: (): boolean => false
  } as unknown as PtyManager
  const attention = {
    onChange: (): (() => void) => () => {},
    noteOutput: (): void => {},
    noteInput: (): void => {},
    clear: vi.fn(),
    forget: (): void => {}
  } as unknown as AttentionService
  const userDataDir = tempDir()
  const controller = createSessionController({
    store,
    pty,
    attention,
    runtime,
    sendPtyData: vi.fn(),
    userDataDir
  })
  const stateOf = (id: Id): RuntimeState | undefined => runtime.get(id)
  const output = (id: Id, data: string): void => dataHandler(id, data, 1)
  return { controller, store, runtime, stateOf, attention, output }
}

describe('sessionController.handleHookEvent', () => {
  it('UserPromptSubmit sets working and moves the session to the working status', () => {
    const { controller, store, stateOf } = setup([session({ id: 's1' })])

    controller.handleHookEvent({ sessionId: 's1', event: 'UserPromptSubmit' })

    expect(stateOf('s1')?.activity).toBe('working')
    expect(store.get().sessions[0].statusId).toBe('working')
  })

  it('Notification sets needs-input with the message and moves to the waiting status', () => {
    const { controller, store, stateOf } = setup([session({ id: 's1', statusId: 'working' })])

    controller.handleHookEvent({ sessionId: 's1', event: 'Notification', message: 'Allow rm?' })

    expect(stateOf('s1')?.activity).toBe('needs-input')
    expect(stateOf('s1')?.activityMessage).toBe('Allow rm?')
    expect(store.get().sessions[0].statusId).toBe('waiting')
  })

  it('Stop sets finished and moves to the review status', () => {
    const { controller, store, stateOf } = setup([session({ id: 's1', statusId: 'working' })])

    controller.handleHookEvent({ sessionId: 's1', event: 'Stop' })

    expect(stateOf('s1')?.activity).toBe('finished')
    expect(store.get().sessions[0].statusId).toBe('review')
  })

  it('a repeated event with the same activity does not move a session the user re-placed', () => {
    const { controller, store } = setup([session({ id: 's1', statusId: 'working' })])
    controller.handleHookEvent({ sessionId: 's1', event: 'Stop' })
    // The user moves the session back to Working while it is finished.
    store.setSessionStatus('s1', 'working')

    controller.handleHookEvent({ sessionId: 's1', event: 'Stop' })

    expect(store.get().sessions[0].statusId).toBe('working')
  })

  it('a Notification that repeats needs-input keeps the status even with a new message', () => {
    const { controller, store, stateOf } = setup([session({ id: 's1' })])
    controller.handleHookEvent({ sessionId: 's1', event: 'Notification', message: 'one' })
    store.setSessionStatus('s1', 'todo')

    controller.handleHookEvent({ sessionId: 's1', event: 'Notification', message: 'two' })

    expect(stateOf('s1')?.activityMessage).toBe('two')
    expect(store.get().sessions[0].statusId).toBe('todo')
  })

  it('events for an unknown session are ignored', () => {
    const { controller, runtime } = setup([session({ id: 's1' })])
    controller.handleHookEvent({ sessionId: 'ghost', event: 'Stop' })
    expect(runtime.get('ghost')).toBeUndefined()
  })

  it('emits the runtime change to subscribers (the renderer path)', () => {
    const { controller, runtime } = setup([session({ id: 's1' })])
    const emitted: RuntimeState[] = []
    runtime.subscribe((s) => emitted.push(s))

    controller.handleHookEvent({ sessionId: 's1', event: 'UserPromptSubmit' })

    expect(emitted.at(-1)?.activity).toBe('working')
  })

  it('a closed session keeps its activity but is not moved', () => {
    const { controller, store, stateOf } = setup([session({ id: 's1', closedAt: 5 })])

    controller.handleHookEvent({ sessionId: 's1', event: 'UserPromptSubmit' })

    expect(stateOf('s1')?.activity).toBe('working')
    expect(store.get().sessions[0].statusId).toBe('todo')
  })

  it('a prompt (typed here or sent from Remote Control) clears the pending attention', () => {
    const { controller, attention } = setup([session({ id: 's1' })])

    controller.handleHookEvent({ sessionId: 's1', event: 'UserPromptSubmit' })

    expect(attention.clear).toHaveBeenCalledWith('s1')
  })
})

describe('sessionController screen signals', () => {
  it('marks Remote Control when the footer says it is active', () => {
    const { runtime, output } = setup([session({ id: 's1' })])
    runtime.markRunning('s1')

    output('s1', '[2m/rc active[0m')

    expect(runtime.get('s1')?.remoteControl).toBe(true)
  })

  it('pins a Remote Control session awake once, and respects the user clearing it afterwards', () => {
    const { runtime, store, output } = setup([session({ id: 's1' })])
    runtime.markRunning('s1')

    output('s1', '/rc active')
    expect(store.get().sessions[0].keepAwake).toBe(true)

    store.setKeepAwake('s1', false)
    output('s1', '/rc active')
    expect(store.get().sessions[0].keepAwake).toBeUndefined()
  })

  it('a question answered remotely goes back to working when the spinner reappears', () => {
    const { controller, runtime, attention, output } = setup([session({ id: 's1' })])
    runtime.markRunning('s1')
    controller.handleHookEvent({ sessionId: 's1', event: 'Notification', message: 'Which one?' })
    expect(runtime.get('s1')?.activity).toBe('needs-input')

    output('s1', 'Pondering… (4s · ↓ 120 tokens)')

    expect(runtime.get('s1')?.activity).toBe('working')
    expect(attention.clear).toHaveBeenCalledWith('s1')
  })

  it('the spinner alone never overrides a finished turn', () => {
    const { controller, runtime, output } = setup([session({ id: 's1' })])
    runtime.markRunning('s1')
    controller.handleHookEvent({ sessionId: 's1', event: 'Stop' })

    output('s1', 'Pondering… (4s · ↓ 120 tokens)')

    expect(runtime.get('s1')?.activity).toBe('finished')
  })

  it('ignores OpenCode sessions', () => {
    const { runtime, output } = setup([session({ id: 'o1', agent: 'opencode' })])
    runtime.markRunning('o1')

    output('o1', '/rc active')

    expect(runtime.get('o1')?.remoteControl).toBeUndefined()
  })
})
