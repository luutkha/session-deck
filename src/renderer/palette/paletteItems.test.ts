import { describe, expect, it } from 'vitest'
import { buildPaletteItems, folderLabel, type PaletteItem, type PaletteInput } from './paletteItems'
import { DEFAULT_STATUSES, type RuntimeState, type Session } from '../../shared/types'

function session(overrides: Partial<Session> & { id: string }): Session {
  return {
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

function runtimeOf(overrides: Partial<RuntimeState> & { sessionId: string }): RuntimeState {
  return { run: 'running', exitCode: null, attention: null, ...overrides }
}

function input(overrides: Partial<PaletteInput> = {}): PaletteInput {
  return {
    sessions: [],
    statuses: DEFAULT_STATUSES,
    runtime: new Map(),
    activeId: null,
    view: 'terminal',
    mode: 'ops',
    windowRole: 'main',
    codePoppedOut: false,
    ...overrides
  }
}

function byId(items: readonly PaletteItem[], id: string): PaletteItem {
  const found = items.find((item: PaletteItem): boolean => item.id === id)
  if (found === undefined) {
    throw new Error(`no item ${id}`)
  }
  return found
}

function labels(items: readonly PaletteItem[]): string[] {
  return items.map((item: PaletteItem): string => item.label)
}

describe('folderLabel', () => {
  it('returns the last folder of a Windows path', () => {
    expect(folderLabel('C:\\Works\\app')).toBe('app')
  })

  it('ignores trailing separators and accepts forward slashes', () => {
    expect(folderLabel('C:/Works/app/')).toBe('app')
  })

  it('falls back to the full cwd for a drive root', () => {
    expect(folderLabel('C:\\')).toBe('C:\\')
  })

  it('falls back to the full cwd for a POSIX root', () => {
    expect(folderLabel('/')).toBe('/')
  })
})

describe('buildPaletteItems: sessions group', () => {
  it('lists one session item per session with its name as label', () => {
    const items = buildPaletteItems(input({ sessions: [session({ id: 's1', name: 'Alpha' })] }))
    const item = byId(items, 'session:s1')
    expect(item.group).toBe('Sessions')
    expect(item.label).toBe('Alpha')
  })

  it('shows the folder name and the status name as detail', () => {
    const sessions = [session({ id: 's1', name: 'Alpha', cwd: 'C:\\Works\\app', statusId: 'working' })]
    const item = byId(buildPaletteItems(input({ sessions })), 'session:s1')
    expect(item.detail).toBe('app · Working')
  })

  it('shows No status when the session has no status', () => {
    const sessions = [session({ id: 's1', statusId: null })]
    expect(byId(buildPaletteItems(input({ sessions })), 'session:s1').detail).toBe('app · No status')
  })

  it('shows No status when the status id is unknown', () => {
    const sessions = [session({ id: 's1', statusId: 'gone' })]
    expect(byId(buildPaletteItems(input({ sessions })), 'session:s1').detail).toBe('app · No status')
  })

  it('shows Needs you in place of the status when the session has a bell', () => {
    const sessions = [session({ id: 's1', statusId: 'working' })]
    const runtime = new Map([['s1', runtimeOf({ sessionId: 's1', attention: 'done' })]])
    expect(byId(buildPaletteItems(input({ sessions, runtime })), 'session:s1').detail).toBe('app · Needs you')
  })

  it('shows Sleeping in place of the status when the session sleeps', () => {
    const sessions = [session({ id: 's1', statusId: 'working' })]
    const runtime = new Map([['s1', runtimeOf({ sessionId: 's1', sleeping: true })]])
    expect(byId(buildPaletteItems(input({ sessions, runtime })), 'session:s1').detail).toBe('app · Sleeping')
  })

  it('shows Closed for a closed session and makes it reopen', () => {
    const sessions = [session({ id: 's1', closedAt: 5 })]
    const item = byId(buildPaletteItems(input({ sessions })), 'session:s1')
    expect(item.detail).toBe('app · Closed')
    expect(item.run).toEqual({ kind: 'reopen-session', id: 's1' })
  })

  it('makes an open session open it', () => {
    const item = byId(buildPaletteItems(input({ sessions: [session({ id: 's1' })] })), 'session:s1')
    expect(item.run).toEqual({ kind: 'open-session', id: 's1' })
  })

  it('uses the full cwd as folder when the cwd is a drive root', () => {
    const item = byId(
      buildPaletteItems(input({ sessions: [session({ id: 's1', cwd: 'C:\\' })] })),
      'session:s1'
    )
    expect(item.detail).toBe('C:\\ · No status')
  })

  it('falls back to the folder name when the session name is empty', () => {
    const item = byId(
      buildPaletteItems(input({ sessions: [session({ id: 's1', name: '   ', cwd: 'C:\\Works\\app' })] })),
      'session:s1'
    )
    expect(item.label).toBe('app')
  })

  it('keeps duplicate names as separate items with unique ids', () => {
    const sessions = [session({ id: 's1', name: 'Same' }), session({ id: 's2', name: 'Same' })]
    const items = buildPaletteItems(input({ sessions }))
    expect(items.filter((item: PaletteItem): boolean => item.label === 'Same')).toHaveLength(2)
    expect(new Set(items.map((item: PaletteItem): string => item.id)).size).toBe(items.length)
  })

  it('puts sessions with a bell first, then open, then sleeping, then closed, by name inside each', () => {
    const sessions = [
      session({ id: 'closed', name: 'A closed', closedAt: 1 }),
      session({ id: 'sleep', name: 'A sleep' }),
      session({ id: 'open-b', name: 'B open' }),
      session({ id: 'bell', name: 'Z bell' }),
      session({ id: 'open-a', name: 'A open' })
    ]
    const runtime = new Map<string, RuntimeState>([
      ['sleep', runtimeOf({ sessionId: 'sleep', sleeping: true })],
      ['bell', runtimeOf({ sessionId: 'bell', attention: 'permission' })]
    ])
    const sessionLabels = buildPaletteItems(input({ sessions, runtime }))
      .filter((item: PaletteItem): boolean => item.group === 'Sessions')
      .map((item: PaletteItem): string => item.label)
    expect(sessionLabels).toEqual(['Z bell', 'A open', 'B open', 'A sleep', 'A closed'])
  })

  it('still offers the actions when there are no sessions at all', () => {
    expect(labels(buildPaletteItems(input()))).toEqual([
      'New session',
      'Open Hub',
      'Open grid view',
      'Open Jarvis',
      'Jarvis: start a new conversation',
      'Search conversations',
      'Show cost report',
      'Open Settings',
      'Show "While you were away"',
      'Switch to Code mode',
      'Open Code in its own window'
    ])
  })
})

describe('buildPaletteItems: actions group', () => {
  it('offers New session, Open Hub and Open Settings in the terminal view', () => {
    const items = buildPaletteItems(input({ view: 'terminal' })).filter(
      (item: PaletteItem): boolean => item.group === 'Actions'
    )
    expect(items.map((item: PaletteItem): string => item.label)).toEqual([
      'New session',
      'Open Hub',
      'Open grid view',
      'Open Jarvis',
      'Jarvis: start a new conversation',
      'Search conversations',
      'Show cost report',
      'Open Settings',
      'Show "While you were away"',
      'Switch to Code mode',
      'Open Code in its own window'
    ])
    expect(byId(items, 'action:new-session').run).toEqual({ kind: 'new-session' })
    expect(byId(items, 'action:open-settings').run).toEqual({ kind: 'open-settings' })
    expect(byId(items, 'action:open-jarvis').run).toEqual({ kind: 'open-jarvis' })
    expect(byId(items, 'action:reset-jarvis').run).toEqual({ kind: 'reset-jarvis' })
  })

  it('offers the away summary with its detail and search keywords', () => {
    const item = byId(buildPaletteItems(input()), 'action:show-away-summary')
    expect(item.group).toBe('Actions')
    expect(item.detail).toBe('What happened since you left')
    expect(item.keywords).toBe('away summary timeline activity')
    expect(item.run).toEqual({ kind: 'show-away-summary' })
  })

  it('omits Open Hub while the Hub is already the view', () => {
    const items = buildPaletteItems(input({ view: 'hub' }))
    expect(items.some((item: PaletteItem): boolean => item.label === 'Open Hub')).toBe(false)
    expect(items.some((item: PaletteItem): boolean => item.label === 'New session')).toBe(true)
  })

  it('offers Exit grid view only while the grid is the view (D55)', () => {
    const inGrid = buildPaletteItems(input({ view: 'grid' }))
    expect(inGrid.find((item: PaletteItem): boolean => item.id === 'action:exit-grid')?.run).toEqual({ kind: 'exit-grid' })
    expect(inGrid.some((item: PaletteItem): boolean => item.id === 'action:open-grid')).toBe(false)
    const inTerminal = buildPaletteItems(input({ view: 'terminal' }))
    expect(inTerminal.some((item: PaletteItem): boolean => item.id === 'action:exit-grid')).toBe(false)
  })
})

describe('buildPaletteItems: preview file (D74)', () => {
  const open = session({ id: 's1', name: 'Alpha' })
  const hasPreviewFile = (items: readonly PaletteItem[]): boolean =>
    items.some((item: PaletteItem): boolean => item.id === 'action:preview-file')

  it('offers "Preview file..." with a session on screen', () => {
    const items = buildPaletteItems(input({ sessions: [open], activeId: 's1' }))
    const item = byId(items, 'action:preview-file')
    expect(item.group).toBe('Actions')
    expect(item.label).toBe('Preview file...')
    expect(item.run).toEqual({ kind: 'preview-file' })
  })

  it('is absent without a session on screen, in the Hub, or for a closed tab', () => {
    expect(hasPreviewFile(buildPaletteItems(input({ sessions: [open], activeId: null })))).toBe(false)
    expect(hasPreviewFile(buildPaletteItems(input({ sessions: [open], activeId: 's1', view: 'hub' })))).toBe(false)
    const closed = session({ id: 's1', name: 'Alpha', closedAt: 1 })
    expect(hasPreviewFile(buildPaletteItems(input({ sessions: [closed], activeId: 's1' })))).toBe(false)
  })
})

describe('buildPaletteItems: this session group', () => {
  const runningSession = session({ id: 's1', name: 'Alpha', statusId: 'working' })

  it('is absent when no session is active', () => {
    const items = buildPaletteItems(input({ sessions: [runningSession], activeId: null }))
    expect(items.some((item: PaletteItem): boolean => item.group === 'This session')).toBe(false)
  })

  it('is absent when the active id points at a removed session', () => {
    const items = buildPaletteItems(input({ sessions: [runningSession], activeId: 'ghost' }))
    expect(items.some((item: PaletteItem): boolean => item.group === 'This session')).toBe(false)
  })

  it('is absent when the active session is closed', () => {
    const closed = session({ id: 's1', name: 'Alpha', closedAt: 3 })
    const items = buildPaletteItems(input({ sessions: [closed], activeId: 's1' }))
    expect(items.some((item: PaletteItem): boolean => item.group === 'This session')).toBe(false)
  })

  it('offers Sleep only when the session is running and not sleeping', () => {
    const running = buildPaletteItems(
      input({
        sessions: [runningSession],
        runtime: new Map([['s1', runtimeOf({ sessionId: 's1' })]]),
        activeId: 's1'
      })
    )
    const sleeping = buildPaletteItems(
      input({
        sessions: [runningSession],
        runtime: new Map([['s1', runtimeOf({ sessionId: 's1', sleeping: true })]]),
        activeId: 's1'
      })
    )
    const exited = buildPaletteItems(
      input({
        sessions: [runningSession],
        runtime: new Map([['s1', runtimeOf({ sessionId: 's1', run: 'exited' })]]),
        activeId: 's1'
      })
    )
    expect(labels(running)).toContain('Sleep Alpha')
    expect(labels(sleeping)).not.toContain('Sleep Alpha')
    expect(labels(exited)).not.toContain('Sleep Alpha')
    expect(byId(running, 'this:sleep:s1').run).toEqual({ kind: 'sleep', id: 's1' })
  })

  it('offers no Sleep for a session without a runtime entry', () => {
    const items = buildPaletteItems(input({ sessions: [runningSession], activeId: 's1' }))
    expect(labels(items)).not.toContain('Sleep Alpha')
  })

  it('offers Keep awake when the flag is off, and Let sleep when it is on', () => {
    const off = buildPaletteItems(input({ sessions: [runningSession], activeId: 's1' }))
    const on = buildPaletteItems(
      input({ sessions: [{ ...runningSession, keepAwake: true }], activeId: 's1' })
    )
    expect(byId(off, 'this:keep-awake:s1').label).toBe('Keep Alpha awake')
    expect(byId(off, 'this:keep-awake:s1').run).toEqual({ kind: 'set-keep-awake', id: 's1', keepAwake: true })
    expect(byId(on, 'this:keep-awake:s1').label).toBe('Let Alpha sleep')
    expect(byId(on, 'this:keep-awake:s1').run).toEqual({ kind: 'set-keep-awake', id: 's1', keepAwake: false })
  })

  it('offers Mark as read when the session has a bell, else Mark as unread', () => {
    const withBell = buildPaletteItems(
      input({
        sessions: [runningSession],
        runtime: new Map([['s1', runtimeOf({ sessionId: 's1', attention: 'done' })]]),
        activeId: 's1'
      })
    )
    const without = buildPaletteItems(input({ sessions: [runningSession], activeId: 's1' }))
    expect(byId(withBell, 'this:read:s1').label).toBe('Mark Alpha as read')
    expect(byId(withBell, 'this:read:s1').run).toEqual({ kind: 'mark-read', id: 's1' })
    expect(byId(without, 'this:read:s1').label).toBe('Mark Alpha as unread')
    expect(byId(without, 'this:read:s1').run).toEqual({ kind: 'mark-unread', id: 's1' })
  })

  it('offers Set status for every status except the current one', () => {
    const items = buildPaletteItems(input({ sessions: [runningSession], activeId: 's1' }))
    const statusLabels = items
      .filter((item: PaletteItem): boolean => item.id.startsWith('status:s1:'))
      .map((item: PaletteItem): string => item.label)
    expect(statusLabels).toEqual([
      'Set status: Todo',
      'Set status: Waiting',
      'Set status: Review',
      'Set status: Done'
    ])
    expect(byId(items, 'status:s1:done').run).toEqual({ kind: 'set-status', id: 's1', statusId: 'done' })
  })

  it('offers every status when the session has no status', () => {
    const items = buildPaletteItems(input({ sessions: [session({ id: 's1', name: 'Alpha' })], activeId: 's1' }))
    expect(items.filter((item: PaletteItem): boolean => item.id.startsWith('status:s1:'))).toHaveLength(
      DEFAULT_STATUSES.length
    )
  })

  it('places the This session group between Sessions and Actions', () => {
    const items = buildPaletteItems(input({ sessions: [runningSession], activeId: 's1' }))
    const groups = items.map((item: PaletteItem): string => item.group)
    const firstThis = groups.indexOf('This session')
    expect(groups.lastIndexOf('Sessions')).toBeLessThan(firstThis)
    expect(groups.indexOf('Actions')).toBeGreaterThan(firstThis)
  })

  it('gives every item a unique id', () => {
    const items = buildPaletteItems(
      input({
        sessions: [runningSession, session({ id: 's2', name: 'Beta' })],
        runtime: new Map([['s1', runtimeOf({ sessionId: 's1', attention: 'done' })]]),
        activeId: 's1'
      })
    )
    expect(new Set(items.map((item: PaletteItem): string => item.id)).size).toBe(items.length)
  })
})

describe('buildPaletteItems: keyboard triage (D69)', () => {
  it('offers next / previous session that needs you only while a session has a bell', () => {
    const quiet = buildPaletteItems(input({ sessions: [session({ id: 'a' })], runtime: new Map([['a', runtimeOf({ sessionId: 'a' })]]) }))
    expect(quiet.some((item) => item.id === 'action:next-attention')).toBe(false)
    expect(quiet.some((item) => item.id === 'action:previous-attention')).toBe(false)
    const waiting = buildPaletteItems(input({ sessions: [session({ id: 'a' })], runtime: new Map([['a', runtimeOf({ sessionId: 'a', attention: 'done' })]]) }))
    expect(byId(waiting, 'action:next-attention').run).toEqual({ kind: 'step-attention', delta: 1 })
    expect(byId(waiting, 'action:previous-attention').run).toEqual({ kind: 'step-attention', delta: -1 })
  })
})

describe('buildPaletteItems: presets (D49)', () => {
  const preset = { id: 'p1', name: 'Backend', cwd: 'C:/work/api', agent: 'claude' as const, claudeArgs: [], groupId: null, statusId: null }

  it('offers one "New session: <preset>" item per preset in Ops mode', () => {
    const item = byId(buildPaletteItems(input({ mode: 'ops', presets: [preset] })), 'action:preset:p1')
    expect(item.label).toBe('New session: Backend')
    expect(item.detail).toBe('api · Claude')
    expect(item.run).toEqual({ kind: 'new-from-preset', presetId: 'p1' })
  })

  it('offers no preset items in Code mode or without presets', () => {
    expect(buildPaletteItems(input({ mode: 'code', presets: [preset] })).some((i) => i.id.startsWith('action:preset:'))).toBe(false)
    expect(buildPaletteItems(input({ mode: 'ops' })).some((i) => i.id.startsWith('action:preset:'))).toBe(false)
  })
})

describe('buildPaletteItems: mode and window actions', () => {
  const codeSession = session({ id: 'c1', name: 'Feature', worktreeId: 'w1' })

  function actionLabels(overrides: Partial<PaletteInput>): string[] {
    return labels(buildPaletteItems(input(overrides))).filter((label: string): boolean => label.startsWith('Switch') || label.startsWith('Open Code') || label.startsWith('Move Code') || label === 'New worktree')
  }

  it('offers Switch to Code mode in the main window while in Ops', () => {
    const item = byId(buildPaletteItems(input({ mode: 'ops' })), 'action:switch-mode')
    expect(item.label).toBe('Switch to Code mode')
    expect(item.run).toEqual({ kind: 'switch-mode', mode: 'code' })
  })

  it('offers Switch to Ops mode in the main window while in Code', () => {
    const item = byId(buildPaletteItems(input({ mode: 'code' })), 'action:switch-mode')
    expect(item.label).toBe('Switch to Ops mode')
    expect(item.run).toEqual({ kind: 'switch-mode', mode: 'ops' })
  })

  it('hides the switch while Code is popped out', () => {
    expect(actionLabels({ codePoppedOut: true })).not.toContain('Switch to Code mode')
  })

  it('offers Open Code in its own window in the main window, popped out or not', () => {
    expect(actionLabels({})).toContain('Open Code in its own window')
    expect(actionLabels({ codePoppedOut: true })).toContain('Open Code in its own window')
  })

  it('offers Move Code back to the main window only in the Code window', () => {
    const codeWindow = buildPaletteItems(input({ windowRole: 'code', mode: 'code', codePoppedOut: true }))
    expect(byId(codeWindow, 'action:dock-code').run).toEqual({ kind: 'dock-code' })
    expect(actionLabels({ windowRole: 'code', mode: 'code', codePoppedOut: true })).not.toContain('Open Code in its own window')
    expect(actionLabels({ windowRole: 'code', mode: 'code', codePoppedOut: true })).not.toContain('Switch to Ops mode')
  })

  it('offers New worktree only in Code mode', () => {
    const codeItems = buildPaletteItems(input({ mode: 'code', windowRole: 'code', codePoppedOut: true }))
    expect(byId(codeItems, 'action:new-worktree').run).toEqual({ kind: 'new-worktree' })
    expect(actionLabels({ mode: 'ops' })).not.toContain('New worktree')
  })

  it('keeps the away summary in the main window only', () => {
    expect(labels(buildPaletteItems(input({ windowRole: 'main' })))).toContain('Show "While you were away"')
    expect(labels(buildPaletteItems(input({ windowRole: 'code', mode: 'code', codePoppedOut: true })))).not.toContain(
      'Show "While you were away"'
    )
  })

  it('lists only the sessions it is given (the caller filters by mode)', () => {
    const items = buildPaletteItems(input({ mode: 'code', sessions: [codeSession] }))
    expect(items.filter((item: PaletteItem): boolean => item.group === 'Sessions').map((item: PaletteItem): string => item.label)).toEqual([
      'Feature'
    ])
  })

  it('keeps every item id unique across the mode actions', () => {
    const items = buildPaletteItems(input({ mode: 'code', sessions: [codeSession], activeId: 'c1' }))
    expect(new Set(items.map((item: PaletteItem): string => item.id)).size).toBe(items.length)
  })
})
