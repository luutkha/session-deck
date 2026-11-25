import { describe, expect, it } from 'vitest'
import type { RuntimeState, Session, SessionUsage } from '../../shared/types'
import { hubCardPropsEqual, type HubCardProps } from './HubCard'

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    name: 'Session',
    cwd: 'C:\\Works\\app',
    groupId: null,
    statusId: null,
    order: 0,
    createdAt: 1,
    claudeArgs: [],
    ...overrides
  }
}

function runtime(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return { sessionId: 's1', run: 'running', exitCode: null, attention: null, ...overrides }
}

function usage(overrides: Partial<SessionUsage> = {}): SessionUsage {
  return {
    sessionId: 's1',
    model: 'Sonnet',
    contextPercent: 12,
    costUsd: 0.08,
    effort: null,
    updatedAt: 5,
    ...overrides
  }
}

// Stable callback identities: the wrappers are created once in HubColumn and read latest props through a ref.
const stableHandlers = {
  onOpen: (): void => undefined,
  onDragStart: (): void => undefined,
  onDragEnd: (): void => undefined
}

function props(overrides: Partial<HubCardProps> = {}): HubCardProps {
  return {
    session: session(),
    active: false,
    runtime: runtime(),
    lastChange: 100,
    now: 1000,
    groupName: null,
    usage: usage(),
    draggable: true,
    selected: false,
    ...stableHandlers,
    ...overrides
  }
}

describe('hubCardPropsEqual', () => {
  it('treats a store broadcast copy with unchanged displayed values as equal', () => {
    const before = props()
    const after = props({ session: session(), runtime: runtime(), usage: usage() })
    expect(hubCardPropsEqual(before, after)).toBe(true)
  })

  it('ignores callback identity and injected Slot props, except for data-state', () => {
    const before = props()
    const after = props({
      onOpen: (): void => undefined,
      onDragStart: (): void => undefined,
      onDragEnd: (): void => undefined,
      onContextMenu: (): void => undefined,
      onPointerDown: (): void => undefined,
      style: { WebkitTouchCallout: 'none' }
    })
    expect(hubCardPropsEqual(before, after)).toBe(true)
    expect(
      hubCardPropsEqual(
        props({ 'data-state': 'closed' } as Partial<HubCardProps>),
        props({ 'data-state': 'open' } as Partial<HubCardProps>)
      )
    ).toBe(false)
  })

  it('treats an absent selected as false', () => {
    expect(hubCardPropsEqual(props({ selected: undefined }), props({ selected: false }))).toBe(true)
    expect(hubCardPropsEqual(props({ selected: false }), props({ selected: true }))).toBe(false)
  })

  it('re-renders when a displayed session field changes', () => {
    const base = props()
    expect(hubCardPropsEqual(base, props({ session: session({ id: 's2' }) }))).toBe(false)
    expect(hubCardPropsEqual(base, props({ session: session({ name: 'Renamed' }) }))).toBe(false)
    expect(hubCardPropsEqual(base, props({ session: session({ cwd: 'C:\\Works\\other' }) }))).toBe(false)
    expect(hubCardPropsEqual(base, props({ session: session({ agent: 'opencode' }) }))).toBe(false)
    expect(hubCardPropsEqual(base, props({ session: session({ keepAwake: true }) }))).toBe(false)
    expect(hubCardPropsEqual(base, props({ session: session({ notes: 'hello' }) }))).toBe(false)
    expect(hubCardPropsEqual(base, props({ session: session({ queue: [{ id: 'q1', text: 'go', addedAt: 1 }] }) }))).toBe(false)
    expect(
      hubCardPropsEqual(
        base,
        props({ session: session({ checklist: [{ id: 'c1', text: 'step', done: true }] }) })
      )
    ).toBe(false)
  })

  it('ignores session fields the card never shows', () => {
    const base = props()
    expect(hubCardPropsEqual(base, props({ session: session({ order: 7 }) }))).toBe(true)
    expect(hubCardPropsEqual(base, props({ session: session({ statusId: 'done' }) }))).toBe(true)
    expect(hubCardPropsEqual(base, props({ session: session({ notes: '   ' }) }))).toBe(true)
  })

  it('re-renders for every runtime field the card reads', () => {
    const base = props()
    expect(hubCardPropsEqual(base, props({ runtime: runtime({ run: 'exited' }) }))).toBe(false)
    expect(hubCardPropsEqual(base, props({ runtime: runtime({ exitCode: 42 }) }))).toBe(false)
    expect(hubCardPropsEqual(base, props({ runtime: runtime({ attention: 'done' }) }))).toBe(false)
    expect(hubCardPropsEqual(base, props({ runtime: runtime({ attentionAt: 9 }) }))).toBe(false)
    expect(hubCardPropsEqual(base, props({ runtime: runtime({ activity: 'working' }) }))).toBe(false)
    expect(hubCardPropsEqual(base, props({ runtime: runtime({ activityMessage: 'approve?' }) }))).toBe(false)
    expect(hubCardPropsEqual(base, props({ runtime: runtime({ activityAt: 7 }) }))).toBe(false)
    expect(hubCardPropsEqual(base, props({ runtime: runtime({ sleeping: true }) }))).toBe(false)
    expect(hubCardPropsEqual(base, props({ runtime: runtime({ remoteControl: true }) }))).toBe(false)
    expect(hubCardPropsEqual(base, props({ runtime: runtime({ opencodePlugin: 'missing' }) }))).toBe(false)
    expect(hubCardPropsEqual(base, props({ runtime: undefined }))).toBe(false)
  })

  it('re-renders when the usage chip would change or disappear', () => {
    const base = props()
    expect(hubCardPropsEqual(base, props({ usage: usage({ costUsd: 1.5 }) }))).toBe(false)
    expect(hubCardPropsEqual(base, props({ usage: usage({ contextPercent: 88 }) }))).toBe(false)
    expect(hubCardPropsEqual(base, props({ usage: usage({ model: 'Opus' }) }))).toBe(false)
    expect(hubCardPropsEqual(base, props({ usage: usage({ effort: 'high' }) }))).toBe(false)
    expect(hubCardPropsEqual(base, props({ usage: undefined }))).toBe(false)
  })

  it('re-renders for the flags, group badge and clock-derived text', () => {
    const base = props()
    expect(hubCardPropsEqual(base, props({ active: true }))).toBe(false)
    expect(hubCardPropsEqual(base, props({ selected: true }))).toBe(false)
    expect(hubCardPropsEqual(base, props({ draggable: false }))).toBe(false)
    expect(hubCardPropsEqual(base, props({ groupName: 'Backend' }))).toBe(false)
    expect(hubCardPropsEqual(base, props({ lastChange: 200 }))).toBe(false)
    expect(hubCardPropsEqual(base, props({ now: 2000 }))).toBe(false)
  })
})
