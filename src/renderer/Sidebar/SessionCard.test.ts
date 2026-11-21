import { describe, expect, it } from 'vitest'
import type { RuntimeState, Session, StatusDef } from '../../shared/types'
import { sessionCardPropsEqual, type SessionCardProps } from './SessionCard'

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
const runtime: RuntimeState = { sessionId: 's1', run: 'running', exitCode: null, attention: null }

// Stable callback identities, as useSessionCardHandlers provides in a section (a plain props() call must not
// create new callbacks or every comparison would differ).
const stableHandlers = {
  onSelect: (): void => undefined,
  onStartRename: (): void => undefined,
  onCommitRename: (): void => undefined,
  onCancelRename: (): void => undefined,
  onClose: (): void => undefined,
  onDragStart: (): void => undefined,
  onDragOverItem: (): void => undefined,
  onDropItem: (): void => undefined,
  onDragEnd: (): void => undefined
}

function props(overrides: Partial<SessionCardProps> = {}): SessionCardProps {
  return {
    session: session(),
    status,
    active: false,
    runtime,
    relative: 'now',
    renaming: false,
    groupBadge: null,
    showGroupBadge: false,
    attention: null,
    showIndicator: true,
    indicatorAriaLabel: 'Running',
    indicatorClass: 'bg-status-success',
    draggable: true,
    dragOver: null,
    selected: false,
    ...stableHandlers,
    ...overrides
  }
}

describe('sessionCardPropsEqual', () => {
  it('treats a broadcast copy of an unchanged session as equal (new object identities, same values)', () => {
    const before = props()
    const after = props({
      session: session(), // structured-clone copy: new object, same fields
      status: { ...status },
      runtime: { ...runtime }
    })
    expect(sessionCardPropsEqual(before, after)).toBe(true)
  })

  it('ignores props a Radix ContextMenuTrigger Slot injects with a fresh identity (handlers, ref, style)', () => {
    const before = props()
    const after = props({
      onContextMenu: (): void => undefined,
      onPointerDown: (): void => undefined,
      style: { WebkitTouchCallout: 'none' }
    })
    expect(sessionCardPropsEqual(before, after)).toBe(true)
  })

  it('re-renders when the menu opens or closes (data-state)', () => {
    const before = props({ 'data-state': 'closed' } as Partial<SessionCardProps>)
    const after = props({ 'data-state': 'open' } as Partial<SessionCardProps>)
    expect(sessionCardPropsEqual(before, after)).toBe(false)
  })

  it('treats an absent `selected` as false', () => {
    expect(sessionCardPropsEqual(props({ selected: undefined }), props({ selected: false }))).toBe(true)
    expect(sessionCardPropsEqual(props({ selected: false }), props({ selected: true }))).toBe(false)
  })

  describe('session fields the card renders', () => {
    it('re-renders for name, cwd, agent, keepAwake, notes presence, queue length and checklist progress', () => {
      const base = props()
      expect(sessionCardPropsEqual(base, props({ session: session({ name: 'Renamed' }) }))).toBe(false)
      expect(sessionCardPropsEqual(base, props({ session: session({ cwd: 'C:\\Works\\other' }) }))).toBe(false)
      expect(sessionCardPropsEqual(base, props({ session: session({ agent: 'opencode' }) }))).toBe(false)
      expect(sessionCardPropsEqual(base, props({ session: session({ keepAwake: true }) }))).toBe(false)
      expect(sessionCardPropsEqual(base, props({ session: session({ notes: 'hello' }) }))).toBe(false)
      expect(sessionCardPropsEqual(base, props({ session: session({ queue: [{ id: 'q1', text: 'go', addedAt: 1 }] }) }))).toBe(false)
      expect(
        sessionCardPropsEqual(
          base,
          props({ session: session({ checklist: [{ id: 'c1', text: 'step', done: true }] }) })
        )
      ).toBe(false)
    })

    it('does not re-render for a checklist change that keeps done/total (the chip only shows those)', () => {
      const before = props({ session: session({ checklist: [{ id: 'c1', text: 'step', done: true }] }) })
      const after = props({ session: session({ checklist: [{ id: 'c1', text: 'other text', done: true }] }) })
      expect(sessionCardPropsEqual(before, after)).toBe(true)
    })

    it('does not re-render for fields the card never shows (order, statusId is covered by the status prop)', () => {
      const base = props()
      expect(sessionCardPropsEqual(base, props({ session: session({ order: 7 }) }))).toBe(true)
      expect(sessionCardPropsEqual(base, props({ session: session({ lastActiveAt: 99 }) }))).toBe(true)
    })
  })

  it('re-renders when the status name or colour changes, or the status is removed', () => {
    const base = props()
    expect(sessionCardPropsEqual(base, props({ status: { ...status, name: 'Doing' } }))).toBe(false)
    expect(sessionCardPropsEqual(base, props({ status: { ...status, color: '#42a5f5' } }))).toBe(false)
    expect(sessionCardPropsEqual(base, props({ status: null }))).toBe(false)
  })

  it('re-renders for every runtime field the card reads', () => {
    const base = props()
    expect(sessionCardPropsEqual(base, props({ runtime: { ...runtime, run: 'exited' } }))).toBe(false)
    expect(sessionCardPropsEqual(base, props({ runtime: { ...runtime, exitCode: 1 } }))).toBe(false)
    expect(sessionCardPropsEqual(base, props({ runtime: { ...runtime, attention: 'permission' } }))).toBe(false)
    expect(sessionCardPropsEqual(base, props({ runtime: { ...runtime, activity: 'working' } }))).toBe(false)
    expect(sessionCardPropsEqual(base, props({ runtime: { ...runtime, activityMessage: 'approve?' } }))).toBe(false)
    expect(sessionCardPropsEqual(base, props({ runtime: { ...runtime, activityAt: 5 } }))).toBe(false)
    expect(sessionCardPropsEqual(base, props({ runtime: { ...runtime, sleeping: true } }))).toBe(false)
    expect(sessionCardPropsEqual(base, props({ runtime: { ...runtime, remoteControl: true } }))).toBe(false)
    expect(sessionCardPropsEqual(base, props({ runtime: { ...runtime, opencodePlugin: 'missing' } }))).toBe(false)
    expect(sessionCardPropsEqual(base, props({ runtime: undefined }))).toBe(false)
  })

  it('re-renders when the pre-formatted relative label or a visual flag changes', () => {
    const base = props()
    expect(sessionCardPropsEqual(base, props({ relative: '5m' }))).toBe(false)
    expect(sessionCardPropsEqual(base, props({ active: true }))).toBe(false)
    expect(sessionCardPropsEqual(base, props({ renaming: true }))).toBe(false)
    expect(sessionCardPropsEqual(base, props({ groupBadge: 'Group', showGroupBadge: true }))).toBe(false)
    expect(sessionCardPropsEqual(base, props({ attention: 'done' }))).toBe(false)
    expect(sessionCardPropsEqual(base, props({ indicatorAriaLabel: 'Exited' }))).toBe(false)
    expect(sessionCardPropsEqual(base, props({ indicatorClass: 'bg-destructive' }))).toBe(false)
    expect(sessionCardPropsEqual(base, props({ draggable: false }))).toBe(false)
    expect(sessionCardPropsEqual(base, props({ dragOver: 'before' }))).toBe(false)
    expect(sessionCardPropsEqual(base, props({ showIndicator: false }))).toBe(false)
  })

  it('compares callback identity, which useSessionCardHandlers keeps stable', () => {
    const base = props()
    expect(sessionCardPropsEqual(base, props({ onSelect: (): void => undefined }))).toBe(false)
    expect(sessionCardPropsEqual(base, props({ onDropItem: (): void => undefined }))).toBe(false)
  })
})
