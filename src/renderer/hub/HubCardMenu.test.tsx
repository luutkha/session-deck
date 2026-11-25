import { type ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import type { RuntimeState, Session, StatusDef } from '../../shared/types'
import { HubCard, type HubCardProps } from './HubCard'
import { hubCardMenuPropsEqual, type HubCardMenuProps } from './HubCardMenu'

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

function statuses(): readonly StatusDef[] {
  return [
    { id: 'todo', name: 'Todo', color: '#ccc' },
    { id: 'done', name: 'Done', color: '#0f0' }
  ]
}

const stableHandlers = {
  onOpen: (): void => undefined,
  onSetStatus: (): void => undefined,
  onSleep: (): void => undefined,
  onToggleKeepAwake: (): void => undefined
}

function cardProps(overrides: Partial<HubCardProps> = {}): HubCardProps {
  return {
    session: session(),
    active: false,
    runtime: runtime(),
    lastChange: 100,
    now: 1000,
    groupName: null,
    draggable: true,
    selected: false,
    onOpen: (): void => undefined,
    onDragStart: (): void => undefined,
    onDragEnd: (): void => undefined,
    ...overrides
  }
}

function card(overrides: Partial<HubCardProps> = {}): ReactElement {
  return <HubCard {...cardProps(overrides)} />
}

function props(overrides: Partial<HubCardMenuProps> = {}): HubCardMenuProps {
  return {
    children: card(),
    statuses: statuses(),
    currentStatusId: 'todo',
    sleeping: false,
    canSleep: true,
    keepAwake: false,
    ...stableHandlers,
    ...overrides
  }
}

describe('hubCardMenuPropsEqual', () => {
  it('treats copied statuses, fresh callbacks and an equivalent card element as equal', () => {
    const before = props()
    const after = props({
      statuses: statuses(),
      children: card({ session: session(), runtime: runtime() }),
      onOpen: (): void => undefined,
      onSetStatus: (): void => undefined,
      onSleep: (): void => undefined,
      onToggleKeepAwake: (): void => undefined
    })
    expect(hubCardMenuPropsEqual(before, after)).toBe(true)
  })

  it('ignores callback identity alone (HubColumn passes stable ref-forwarding wrappers)', () => {
    const base = props()
    expect(hubCardMenuPropsEqual(base, props({ onOpen: (): void => undefined }))).toBe(true)
    expect(hubCardMenuPropsEqual(base, props({ onSetStatus: (): void => undefined }))).toBe(true)
    expect(hubCardMenuPropsEqual(base, props({ onSleep: (): void => undefined }))).toBe(true)
    expect(hubCardMenuPropsEqual(base, props({ onToggleKeepAwake: (): void => undefined }))).toBe(true)
  })

  it('re-renders when the status list the submenu shows changes', () => {
    const base = props()
    expect(hubCardMenuPropsEqual(base, props({ statuses: [] }))).toBe(false)
    expect(
      hubCardMenuPropsEqual(base, props({ statuses: [{ id: 'todo', name: 'Doing', color: '#ccc' }] }))
    ).toBe(false)
    expect(
      hubCardMenuPropsEqual(base, props({ statuses: [{ id: 'todo', name: 'Todo', color: '#ddd' }] }))
    ).toBe(false)
    expect(hubCardMenuPropsEqual(base, props({ statuses: [...statuses(), { id: 'x', name: 'X', color: '#fff' }] }))).toBe(false)
  })

  it('re-renders when a flag the menu reads changes', () => {
    const base = props()
    expect(hubCardMenuPropsEqual(base, props({ currentStatusId: 'done' }))).toBe(false)
    expect(hubCardMenuPropsEqual(base, props({ currentStatusId: null }))).toBe(false)
    expect(hubCardMenuPropsEqual(base, props({ sleeping: true }))).toBe(false)
    expect(hubCardMenuPropsEqual(base, props({ canSleep: false }))).toBe(false)
    expect(hubCardMenuPropsEqual(base, props({ keepAwake: true }))).toBe(false)
  })

  it('re-renders when the child card would show something different', () => {
    const base = props()
    expect(hubCardMenuPropsEqual(base, props({ children: card({ session: session({ name: 'Renamed' }) }) }))).toBe(false)
    expect(hubCardMenuPropsEqual(base, props({ children: card({ runtime: runtime({ attention: 'done' }) }) }))).toBe(false)
    expect(hubCardMenuPropsEqual(base, props({ children: card({ active: true }) }))).toBe(false)
    expect(hubCardMenuPropsEqual(base, props({ children: <span>other</span> }))).toBe(false)
  })

  it('treats absent flags as false', () => {
    const base = props({ sleeping: undefined, canSleep: undefined, keepAwake: undefined })
    expect(hubCardMenuPropsEqual(base, props({ sleeping: false, canSleep: false, keepAwake: false }))).toBe(true)
  })
})
