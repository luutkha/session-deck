import { describe, expect, it } from 'vitest'
import type { Group, RuntimeState, Session, StatusDef } from '../../shared/types'
import type { SessionCardHandlers } from './SessionCard'
import { sidebarSessionRowPropsEqual, type SidebarSessionRowProps } from './GroupSection'

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

const status: StatusDef = { id: 'todo', name: 'Todo', color: '#9e9e9e' }
const group: Group = { id: 'g1', name: 'Group', collapsed: false }
const runtime: RuntimeState = { sessionId: 's1', run: 'running', exitCode: null, attention: null }

const handler = (): void => undefined
const handlers: SessionCardHandlers = {
  onSelect: handler,
  onStartRename: handler,
  onCommitRename: handler,
  onCancelRename: handler,
  onClose: handler,
  onDragStart: handler,
  onDragOverItem: handler,
  onDropItem: handler,
  onDragEnd: handler
}

function props(overrides: Partial<SidebarSessionRowProps> = {}): SidebarSessionRowProps {
  return {
    session: session(),
    status,
    runtime,
    relative: 'now',
    active: false,
    renaming: false,
    groupBadge: 'Group',
    showGroupBadge: true,
    attention: null,
    dragOver: null,
    selected: false,
    draggable: true,
    statuses: [status],
    groups: [group],
    handlers,
    onSelect: handler,
    onStartRenameSession: handler,
    onCloseSession: handler,
    onSetSessionStatus: handler,
    onMoveSession: handler,
    onCreateGroupAndMove: handler,
    onRequestRemoveSession: handler,
    ...overrides
  }
}

describe('sidebarSessionRowPropsEqual', () => {
  it('treats broadcast copies and new callback identities as equal', (): void => {
    const before = props()
    const after = props({
      session: session(),
      status: { ...status },
      runtime: { ...runtime },
      statuses: [status],
      groups: [group],
      handlers: { ...handlers },
      onSelect: (): void => undefined,
      onRequestRemoveSession: (): void => undefined
    })
    expect(sidebarSessionRowPropsEqual(before, after)).toBe(true)
  })

  it('re-renders for each session field the card and menu show', (): void => {
    const base = props()
    expect(sidebarSessionRowPropsEqual(base, props({ session: session({ name: 'Renamed' }) }))).toBe(false)
    expect(sidebarSessionRowPropsEqual(base, props({ session: session({ cwd: 'C:\\other' }) }))).toBe(false)
    expect(sidebarSessionRowPropsEqual(base, props({ session: session({ agent: 'opencode' }) }))).toBe(false)
    expect(sidebarSessionRowPropsEqual(base, props({ session: session({ keepAwake: true }) }))).toBe(false)
    expect(sidebarSessionRowPropsEqual(base, props({ session: session({ tags: ['urgent'] }) }))).toBe(false)
    expect(sidebarSessionRowPropsEqual(base, props({ session: session({ notes: 'hi' }) }))).toBe(false)
    expect(sidebarSessionRowPropsEqual(base, props({ session: session({ queue: [{ id: 'q1', text: 'go', addedAt: 1 }] }) }))).toBe(false)
    expect(sidebarSessionRowPropsEqual(
      base,
      props({ session: session({ checklist: [{ id: 'c1', text: 'step', done: true }] }) })
    )).toBe(false)
  })

  it('re-renders for status, runtime, time and visual flags', (): void => {
    const base = props()
    expect(sidebarSessionRowPropsEqual(base, props({ status: { ...status, name: 'Doing' } }))).toBe(false)
    expect(sidebarSessionRowPropsEqual(base, props({ status: { ...status, color: '#42a5f5' } }))).toBe(false)
    expect(sidebarSessionRowPropsEqual(base, props({ status: null }))).toBe(false)
    for (const changed of [
      { run: 'exited' }, { exitCode: 1 }, { attention: 'permission' }, { activity: 'working' },
      { activityMessage: 'approve?' }, { activityAt: 5 }, { sleeping: true },
      { remoteControl: true }, { opencodePlugin: 'missing' }
    ] as const) {
      expect(sidebarSessionRowPropsEqual(base, props({ runtime: { ...runtime, ...changed } }))).toBe(false)
    }
    expect(sidebarSessionRowPropsEqual(base, props({ runtime: undefined }))).toBe(false)
    expect(sidebarSessionRowPropsEqual(base, props({ relative: '5m' }))).toBe(false)
    expect(sidebarSessionRowPropsEqual(base, props({ active: true }))).toBe(false)
    expect(sidebarSessionRowPropsEqual(base, props({ renaming: true }))).toBe(false)
    expect(sidebarSessionRowPropsEqual(base, props({ groupBadge: 'Other' }))).toBe(false)
    expect(sidebarSessionRowPropsEqual(base, props({ showGroupBadge: false }))).toBe(false)
    expect(sidebarSessionRowPropsEqual(base, props({ attention: 'bell' }))).toBe(false)
    expect(sidebarSessionRowPropsEqual(base, props({ dragOver: 'before' }))).toBe(false)
    expect(sidebarSessionRowPropsEqual(base, props({ selected: true }))).toBe(false)
    expect(sidebarSessionRowPropsEqual(base, props({ draggable: false }))).toBe(false)
  })

  it('re-renders when the menu content or the fork item changes', (): void => {
    const base = props()
    expect(sidebarSessionRowPropsEqual(base, props({ statuses: [] }))).toBe(false)
    expect(sidebarSessionRowPropsEqual(base, props({ groups: [] }))).toBe(false)
    expect(sidebarSessionRowPropsEqual(base, props({ onForkSession: handler }))).toBe(false)
  })
})
