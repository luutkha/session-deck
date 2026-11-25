// Pure memo-comparator tests for the Code sidebar rows. There is no DOM test library here, so each comparator is
// exercised directly: equal inputs keep a row's DOM, and every displayed field change must make it re-render.
import { describe, expect, it } from 'vitest'
import type {
  Group,
  Id,
  RuntimeState,
  Session,
  StatusDef,
  StoreData,
  Worktree,
  WorktreeChanges
} from '../../../shared/types'
import type { SessionActions } from '../../state/useSessionStore'
import type { CodeTreeHandlers, CodeCommands, CodeTreeView } from './codeTreeView'
import type { CodeWorktreeNode } from './codeTree'
import {
  codeSessionCardPropsEqual,
  type CodeSessionCardProps
} from './CodeSessionCard'
import { codeSessionRowPropsEqual, type CodeSessionRowProps } from './CodeSessionRow'
import { codeWorktreeRowPropsEqual, type CodeWorktreeRowProps } from './CodeWorktreeRow'

const handler = (): void => undefined

const session: Session = {
  id: 's1',
  name: 'One',
  cwd: 'C:\\Works\\app',
  groupId: null,
  statusId: 'todo',
  order: 0,
  createdAt: 1,
  claudeArgs: [],
  worktreeId: 'w1'
}

const status: StatusDef = { id: 'todo', name: 'Todo', color: '#9e9e9e' }
const otherStatus: StatusDef = { id: 'doing', name: 'Doing', color: '#42a5f5' }
const group: Group = { id: 'g1', name: 'Group', collapsed: false }
const worktree: Worktree = {
  id: 'w1',
  repoId: 'r1',
  name: 'feature',
  branch: 'feature',
  path: 'C:\\Works\\app',
  baseBranch: 'main',
  baseCommit: 'abc',
  createdAt: 1,
  collapsed: false
}

const data: StoreData = {
  version: 1,
  sessions: [session],
  groups: [group],
  statuses: [status],
  groupOrder: [],
  repos: [],
  worktrees: [worktree]
}

const runtime: RuntimeState = { sessionId: 's1', run: 'running', exitCode: null, attention: null }
const runtimeMap = (state: RuntimeState = runtime): ReadonlyMap<Id, RuntimeState> => new Map([[state.sessionId, state]])

const actions = {} as unknown as SessionActions
const commands: CodeCommands = {
  addRepository: (): Promise<void> => Promise.resolve(),
  removeRepo: (): Promise<void> => Promise.resolve(),
  removeWorktree: (): Promise<void> => Promise.resolve(),
  toggleRepo: (): Promise<void> => Promise.resolve(),
  toggleWorktree: (): Promise<void> => Promise.resolve(),
  copyPath: (): Promise<void> => Promise.resolve(),
  openFolder: (): Promise<void> => Promise.resolve(),
  sleepSession: (): Promise<void> => Promise.resolve(),
  setKeepAwake: (): Promise<void> => Promise.resolve()
}
const handlers: CodeTreeHandlers = {
  onSelect: handler,
  onStartRename: handler,
  onCommitRename: handler,
  onCancelRename: handler,
  onCloseSession: handler,
  onRequestRemoveSession: handler,
  onRequestRemoveRepo: handler,
  onRequestRemoveWorktree: handler,
  onNewWorktree: handler,
  onNewSessionInWorktree: handler
}

function view(overrides: Partial<CodeTreeView> = {}): CodeTreeView {
  return {
    data,
    runtime: runtimeMap(),
    lastChange: new Map(),
    now: 1000,
    activeId: null,
    renamingId: null,
    searching: false,
    changeCounts: new Map(),
    actions,
    commands,
    handlers,
    ...overrides
  }
}

function cardProps(overrides: Partial<CodeSessionCardProps> = {}): CodeSessionCardProps {
  return {
    session,
    status,
    active: false,
    runtime,
    lastChange: 5,
    now: 1000,
    renaming: false,
    onSelect: handler,
    onStartRename: handler,
    onCommitRename: handler,
    onCancelRename: handler,
    onClose: handler,
    ...overrides
  }
}

function rowProps(overrides: Partial<CodeSessionRowProps> = {}): CodeSessionRowProps {
  return { session, view: view(), ...overrides }
}

function node(overrides: Partial<CodeWorktreeNode> = {}): CodeWorktreeNode {
  return { worktree, sessions: [session], ...overrides }
}

function worktreeProps(overrides: Partial<CodeWorktreeRowProps> = {}): CodeWorktreeRowProps {
  return { node: node(), view: view(), ...overrides }
}

describe('codeSessionCardPropsEqual', () => {
  it('treats broadcast copies and unchanged displayed fields as equal', (): void => {
    const before = cardProps()
    const after = cardProps({
      session: { ...session },
      status: { ...status },
      runtime: { ...runtime }
    })
    expect(codeSessionCardPropsEqual(before, after)).toBe(true)
  })

  it('re-renders for each session field the card shows', (): void => {
    const base = cardProps()
    for (const changed of [
      { name: 'Renamed' },
      { cwd: 'C:\\other' },
      { agent: 'opencode' as const },
      { keepAwake: true },
      { notes: 'hi' },
      { tags: ['urgent'] },
      { queue: [{ id: 'q1', text: 'go', addedAt: 1 }] },
      { checklist: [{ id: 'c1', text: 'step', done: true }] }
    ] satisfies Partial<Session>[]) {
      expect(codeSessionCardPropsEqual(base, cardProps({ session: { ...session, ...changed } }))).toBe(false)
    }
  })

  it('re-renders for status, runtime, time and flags', (): void => {
    const base = cardProps()
    expect(codeSessionCardPropsEqual(base, cardProps({ status: { ...status, name: 'Doing' } }))).toBe(false)
    expect(codeSessionCardPropsEqual(base, cardProps({ status: null }))).toBe(false)
    for (const changed of [
      { run: 'exited' as const },
      { exitCode: 1 },
      { attention: 'permission' as const },
      { activity: 'working' as const },
      { activityMessage: 'approve?' },
      { activityAt: 5 },
      { sleeping: true },
      { remoteControl: true },
      { opencodePlugin: 'missing' as const }
    ] satisfies Partial<RuntimeState>[]) {
      expect(codeSessionCardPropsEqual(base, cardProps({ runtime: { ...runtime, ...changed } }))).toBe(false)
    }
    expect(codeSessionCardPropsEqual(base, cardProps({ runtime: undefined }))).toBe(false)
    expect(codeSessionCardPropsEqual(base, cardProps({ lastChange: 6 }))).toBe(false)
    expect(codeSessionCardPropsEqual(base, cardProps({ now: 2000 }))).toBe(false)
    expect(codeSessionCardPropsEqual(base, cardProps({ active: true }))).toBe(false)
    expect(codeSessionCardPropsEqual(base, cardProps({ renaming: true }))).toBe(false)
  })

  it('follows the context menu opening through the injected data-state, and ignores other slot props', (): void => {
    const open = { ...cardProps(), 'data-state': 'open' } as unknown as CodeSessionCardProps
    expect(codeSessionCardPropsEqual(cardProps(), open)).toBe(false)
    // onContextMenu is injected fresh by ContextMenuTrigger; it is deliberately not compared.
    const injected = { ...cardProps(), onContextMenu: handler } as CodeSessionCardProps
    expect(codeSessionCardPropsEqual(cardProps(), injected)).toBe(true)
  })
})

describe('codeSessionRowPropsEqual', () => {
  it('ignores a new runtime map when this session did not change', (): void => {
    const before = rowProps()
    const after = rowProps({
      session: { ...session },
      view: view({ runtime: runtimeMap({ ...runtime }) })
    })
    expect(codeSessionRowPropsEqual(before, after)).toBe(true)
  })

  it('follows changed command/handler objects so a memoized row never calls a stale closure', (): void => {
    const base = rowProps()
    expect(codeSessionRowPropsEqual(base, rowProps({ view: view({ handlers: { ...handlers } }) }))).toBe(false)
    expect(codeSessionRowPropsEqual(base, rowProps({ view: view({ commands: { ...commands } }) }))).toBe(false)
  })

  it('re-renders when this session or its runtime changes', (): void => {
    const base = rowProps()
    expect(codeSessionRowPropsEqual(base, rowProps({ session: { ...session, name: 'Renamed' } }))).toBe(false)
    expect(codeSessionRowPropsEqual(base, rowProps({ view: view({ runtime: runtimeMap({ ...runtime, activity: 'working' }) }) }))).toBe(false)
    expect(codeSessionRowPropsEqual(base, rowProps({ view: view({ runtime: new Map() }) }))).toBe(false)
  })

  it('re-renders for selection, rename, time and the status menu list', (): void => {
    const base = rowProps()
    expect(codeSessionRowPropsEqual(base, rowProps({ view: view({ activeId: 's1' }) }))).toBe(false)
    expect(codeSessionRowPropsEqual(base, rowProps({ view: view({ renamingId: 's1' }) }))).toBe(false)
    expect(codeSessionRowPropsEqual(base, rowProps({ view: view({ now: 2000 }) }))).toBe(false)
    expect(codeSessionRowPropsEqual(base, rowProps({ view: view({ lastChange: new Map([['s1', 9]]) }) }))).toBe(false)
    expect(codeSessionRowPropsEqual(base, rowProps({
      view: view({ data: { ...data, statuses: [status, otherStatus] } })
    }))).toBe(false)
    // Not wrapped through a stable ref, and it changes with the open view: a new handler must reach the menu.
    expect(codeSessionRowPropsEqual(base, rowProps({ view: view({ onViewChanges: handler }) }))).toBe(false)
  })
})

describe('codeWorktreeRowPropsEqual', () => {
  it('ignores a new runtime map when the worktree and every child session are unchanged', (): void => {
    const before = worktreeProps()
    // The tree reuses the stored session objects; only the runtime map is new (the broadcast case).
    const after = worktreeProps({
      node: node({ worktree: { ...worktree }, sessions: [session] }),
      view: view({ runtime: runtimeMap({ ...runtime }) })
    })
    expect(codeWorktreeRowPropsEqual(before, after)).toBe(true)
  })

  it('re-renders when a child session or its runtime changes', (): void => {
    const base = worktreeProps()
    expect(codeWorktreeRowPropsEqual(base, worktreeProps({ node: node({ sessions: [{ ...session, name: 'Renamed' }] }) }))).toBe(false)
    expect(codeWorktreeRowPropsEqual(base, worktreeProps({
      view: view({ runtime: runtimeMap({ ...runtime, attention: 'bell' }) })
    }))).toBe(false)
    expect(codeWorktreeRowPropsEqual(base, worktreeProps({ node: node({ sessions: [] }) }))).toBe(false)
  })

  it('re-renders for the worktree header, change counts and list-level state', (): void => {
    const base = worktreeProps()
    expect(codeWorktreeRowPropsEqual(base, worktreeProps({ node: node({ worktree: { ...worktree, name: 'other' } }) }))).toBe(false)
    expect(codeWorktreeRowPropsEqual(base, worktreeProps({ node: node({ worktree: { ...worktree, collapsed: true } }) }))).toBe(false)
    expect(codeWorktreeRowPropsEqual(base, worktreeProps({ node: node({ worktree: { ...worktree, main: true } }) }))).toBe(false)
    const changes: WorktreeChanges = {
      worktreeId: 'w1', additions: 1, deletions: 0, files: [], truncated: false, computedAt: 1
    }
    expect(codeWorktreeRowPropsEqual(base, worktreeProps({
      view: view({ changeCounts: new Map([['w1', changes]]) })
    }))).toBe(false)
    expect(codeWorktreeRowPropsEqual(base, worktreeProps({ view: view({ searching: true }) }))).toBe(false)
    expect(codeWorktreeRowPropsEqual(base, worktreeProps({ view: view({ now: 2000 }) }))).toBe(false)
    expect(codeWorktreeRowPropsEqual(base, worktreeProps({ view: view({ activeId: 's1' }) }))).toBe(false)
    expect(codeWorktreeRowPropsEqual(base, worktreeProps({ view: view({ renamingId: 's1' }) }))).toBe(false)
    expect(codeWorktreeRowPropsEqual(base, worktreeProps({ view: view({ onForkSession: handler }) }))).toBe(false)
  })
})
