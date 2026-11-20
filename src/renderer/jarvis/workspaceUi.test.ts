import { describe, expect, it, vi } from 'vitest'
import type { JarvisUiCommand } from '../../shared/types'
import { describeWorkspace, runWorkspaceAction, type WorkspaceUiContext } from './workspaceUi'
import { registerWorkspaceUi, workspaceUiFor } from './jarvisUiBridge'
import { modeForCommand } from './useJarvisUi'
import { requestFileView } from '../viewer/previewBus'

vi.mock('../viewer/previewBus', () => ({ requestFileView: vi.fn(() => true) }))

function ctx(over: Partial<WorkspaceUiContext> = {}): WorkspaceUiContext {
  return {
    mode: 'ops',
    view: 'terminal',
    setView: vi.fn(),
    exitGrid: vi.fn(),
    names: new Map([['a', 'API'], ['b', 'Web']]),
    activeId: 'a',
    barIds: ['a', 'b'],
    openTab: vi.fn(),
    grid: { layout: { preset: '2x1', cells: ['a', null] }, setPreset: vi.fn(), setCell: vi.fn() },
    split: { paneIds: ['a'], canSplit: true, splitRight: vi.fn(), splitDown: vi.fn(), unsplit: vi.fn(), openToSide: vi.fn() },
    sidebarOpen: true,
    setSidebarOpen: vi.fn(),
    sidebarWidth: { value: 300, set: vi.fn(), reset: vi.fn() },
    sidePanel: { open: false, tab: 'notes', hasChanges: false, setOpen: vi.fn(), setTab: vi.fn() },
    dialogs: {
      settings: null, costs: false, search: false, palette: false,
      openSettings: vi.fn(), setCosts: vi.fn(), setSearch: vi.fn(), setPalette: vi.fn(), showAway: vi.fn(), openNew: vi.fn()
    },
    zoom: { percent: 100, step: vi.fn() },
    workers: { visible: [{ id: 'wk1', name: 'runner' }], selectedId: null, select: vi.fn(), dismiss: vi.fn() },
    sidebarView: () => null,
    search: { active: false, query: '', label: '', open: vi.fn(), close: vi.fn(), setQuery: vi.fn(), step: vi.fn() },
    tabs: { cycle: vi.fn(), close: vi.fn() },
    requestChangesFile: vi.fn(),
    ...over
  }
}

describe('describeWorkspace', () => {
  it('describes the grid, tabs, panels and dialogs', () => {
    const text = describeWorkspace(ctx({ view: 'grid' }))
    expect(text).toContain('View: grid 2x1')
    expect(text).toContain('cell 1: "API"')
    expect(text).toContain('cell 2: (empty)')
    expect(text).toContain('Tab bar: "API", "Web"')
    expect(text).toContain('Worker tabs: "runner"')
    expect(text).toContain('Dialogs open: none')
  })
})

describe('runWorkspaceAction', () => {
  it('leaves the grid through Exit grid, other views through setView', () => {
    const c = ctx({ view: 'grid' })
    runWorkspaceAction({ kind: 'view', view: 'terminal' }, c)
    expect(c.exitGrid).toHaveBeenCalled()
    expect(c.setView).not.toHaveBeenCalled()
    const d = ctx()
    runWorkspaceAction({ kind: 'view', view: 'hub' }, d)
    expect(d.setView).toHaveBeenCalledWith('hub')
    expect(runWorkspaceAction({ kind: 'view', view: 'terminal' }, ctx())).toContain('already')
  })

  it('sets a grid: preset, opens each session tab, fills cells, shows the grid', () => {
    const c = ctx()
    runWorkspaceAction({ kind: 'grid', preset: '2x2', cells: ['b', null, 'a'] }, c)
    expect(c.grid.setPreset).toHaveBeenCalledWith('2x2')
    expect(c.openTab).toHaveBeenCalledWith('b')
    expect(c.grid.setCell).toHaveBeenNthCalledWith(1, 0, 'b')
    expect(c.grid.setCell).toHaveBeenNthCalledWith(2, 1, null)
    expect(c.setView).toHaveBeenCalledWith('grid')
    expect(() => runWorkspaceAction({ kind: 'grid', preset: '9x9' }, ctx())).toThrow('Unknown grid layout')
  })

  it('splits only when it can; open-to-side opens the tab first', () => {
    const c = ctx({ view: 'hub' })
    runWorkspaceAction({ kind: 'split', how: 'right' }, c)
    expect(c.setView).toHaveBeenCalledWith('terminal')
    expect(c.split.splitRight).toHaveBeenCalled()
    expect(() => runWorkspaceAction({ kind: 'split', how: 'down' }, ctx({ split: { ...ctx().split, canSplit: false } }))).toThrow('Cannot split')
    expect(runWorkspaceAction({ kind: 'split', how: 'unsplit' }, ctx())).toContain('not split')
    const d = ctx()
    runWorkspaceAction({ kind: 'openToSide', id: 'b', direction: 'down' }, d)
    expect(d.openTab).toHaveBeenCalledWith('b')
    expect(d.split.openToSide).toHaveBeenCalledWith('b', 'down')
  })

  it('opens the side panel on a tab, but not Changes without a worktree or with no session', () => {
    const c = ctx()
    runWorkspaceAction({ kind: 'sidePanel', open: true, tab: 'queue' }, c)
    expect(c.sidePanel.setTab).toHaveBeenCalledWith('queue')
    expect(c.sidePanel.setOpen).toHaveBeenCalledWith(true)
    expect(() => runWorkspaceAction({ kind: 'sidePanel', open: true, tab: 'changes' }, ctx())).toThrow('no Changes tab')
    expect(() => runWorkspaceAction({ kind: 'sidePanel', open: true }, ctx({ activeId: null }))).toThrow('No session is on screen')
  })

  it('opens and closes dialogs, zooms, and drives worker tabs', () => {
    const c = ctx()
    runWorkspaceAction({ kind: 'dialog', name: 'settings', section: 'quota' }, c)
    expect(c.dialogs.openSettings).toHaveBeenCalledWith('quota')
    expect(() => runWorkspaceAction({ kind: 'dialog', name: 'settings', section: 'bogus' }, c)).toThrow('Unknown settings page')
    runWorkspaceAction({ kind: 'dialog', name: 'none' }, c)
    expect(c.dialogs.setCosts).toHaveBeenCalledWith(false)
    runWorkspaceAction({ kind: 'zoom', action: 'in' }, c)
    expect(c.zoom.step).toHaveBeenCalledWith('in')
    runWorkspaceAction({ kind: 'worker', op: 'show', workerId: 'wk1' }, c)
    expect(c.workers.select).toHaveBeenCalledWith('wk1')
    expect(() => runWorkspaceAction({ kind: 'worker', op: 'dismiss', workerId: 'zz' }, c)).toThrow('no tab')
    runWorkspaceAction({ kind: 'sidebar', open: false }, c)
    expect(c.setSidebarOpen).toHaveBeenCalledWith(false)
  })
})

describe('runWorkspaceAction, D58', () => {
  it('searches the terminal on screen, steps through matches and closes the bar', () => {
    const c = ctx({ view: 'hub' })
    expect(runWorkspaceAction({ kind: 'search', op: 'find', query: 'error' }, c)).toContain('Searching "API" for "error"')
    expect(c.setView).toHaveBeenCalledWith('terminal')
    expect(c.search.open).toHaveBeenCalled()
    expect(c.search.setQuery).toHaveBeenCalledWith('error')
    expect(() => runWorkspaceAction({ kind: 'search', op: 'next' }, ctx())).toThrow('No terminal search is open')
    const open = ctx({ search: { ...ctx().search, active: true, query: 'error', label: '2/5' } })
    runWorkspaceAction({ kind: 'search', op: 'previous' }, open)
    expect(open.search.step).toHaveBeenCalledWith('previous')
    expect(describeWorkspace(open)).toContain('Terminal search: "error" (2/5)')
    runWorkspaceAction({ kind: 'search', op: 'close' }, open)
    expect(open.search.close).toHaveBeenCalled()
    expect(() => runWorkspaceAction({ kind: 'search', op: 'find', query: 'x' }, ctx({ activeId: null }))).toThrow('No session is on screen')
  })

  it('cycles tabs and closes the other tabs (not the one on screen)', () => {
    const c = ctx({ barIds: ['a', 'b', 'c'] })
    runWorkspaceAction({ kind: 'tabs', op: 'previous' }, c)
    expect(c.tabs.cycle).toHaveBeenCalledWith(-1)
    expect(runWorkspaceAction({ kind: 'tabs', op: 'closeOthers' }, c)).toContain('Closed "Web", "c"')
    expect(c.tabs.close).toHaveBeenCalledTimes(2)
    expect(c.tabs.close).not.toHaveBeenCalledWith('a')
    expect(() => runWorkspaceAction({ kind: 'tabs', op: 'next' }, ctx({ barIds: ['a'] }))).toThrow('only one tab')
  })

  it('asks the Changes panel for a file, and changes the sidebar view through its control', () => {
    const c = ctx()
    runWorkspaceAction({ kind: 'changesFile', worktreeId: 'w1', path: 'README.md', view: 'preview' }, c)
    expect(c.requestChangesFile).toHaveBeenCalledWith({ worktreeId: 'w1', path: 'README.md', view: 'preview' })
    expect(() => runWorkspaceAction({ kind: 'sidebarView', search: 'x' }, ctx())).toThrow('still loading')
    const setSearch = vi.fn()
    const hidden = ctx({ sidebarOpen: false, sidebarView: () => ({ state: () => ({ groupBy: null, showWorkspaces: null, search: '', statusFilter: null, closedCollapsed: true }), statusNames: () => new Map(), setSearch, setClosedCollapsed: vi.fn() }) })
    runWorkspaceAction({ kind: 'sidebarView', search: 'api' }, hidden)
    expect(setSearch).toHaveBeenCalledWith('api')
    expect(hidden.setSidebarOpen).toHaveBeenCalledWith(true)
  })

  it('shows a file in the side panel viewer and refuses when no workspace listens (D74)', () => {
    const c = ctx({ view: 'hub' })
    const text = runWorkspaceAction({ kind: 'previewFile', sessionId: 'a', text: 'C:\\p\\README.md' }, c)
    expect(text).toContain('README.md')
    expect(c.setView).toHaveBeenCalledWith('terminal')
    expect(requestFileView).toHaveBeenCalledWith({ sessionId: 'a', text: 'C:\\p\\README.md' })
    vi.mocked(requestFileView).mockReturnValueOnce(false)
    expect(() => runWorkspaceAction({ kind: 'previewFile', sessionId: 'a', text: 'C:\\p\\README.md' }, ctx())).toThrow('No workspace is ready to show the file.')
  })

  it('sets the sort through the sidebar control, and refuses a sidebar that cannot sort (D61)', () => {
    const setSort = vi.fn()
    const base = { state: () => ({ groupBy: null, showWorkspaces: null, search: '', statusFilter: null, closedCollapsed: true, sort: 'manual' as const }), statusNames: () => new Map(), setSearch: vi.fn(), setClosedCollapsed: vi.fn() }
    runWorkspaceAction({ kind: 'sidebarView', sort: 'name' }, ctx({ sidebarView: () => ({ ...base, setSort }) }))
    expect(setSort).toHaveBeenCalledWith('name')
    expect(() => runWorkspaceAction({ kind: 'sidebarView', sort: 'name' }, ctx({ sidebarView: () => base }))).toThrow('cannot sort')
  })
})

describe('runWorkspaceAction: the sidebar width (D70)', () => {
  it('commits the width, says when the limit clamped it, and reports without changing', () => {
    const c = ctx()
    expect(runWorkspaceAction({ kind: 'sidebarWidth', width: 420 }, c)).toBe('The sidebar is now 420px wide.')
    expect(c.sidebarWidth.set).toHaveBeenCalledWith(420)
    const big = ctx()
    expect(runWorkspaceAction({ kind: 'sidebarWidth', width: 900 }, big)).toBe('Asked for 900px; the limit is 640px, so the sidebar is now 640px wide.')
    expect(big.sidebarWidth.set).toHaveBeenCalledWith(640)
    const small = ctx()
    expect(runWorkspaceAction({ kind: 'sidebarWidth', width: 100 }, small)).toBe('Asked for 100px; the limit is 220px, so the sidebar is now 220px wide.')
    expect(small.sidebarWidth.set).toHaveBeenCalledWith(220)
    const report = ctx({ sidebarWidth: { value: 380, set: vi.fn(), reset: vi.fn() } })
    expect(runWorkspaceAction({ kind: 'sidebarWidth', width: null }, report)).toBe('The sidebar is 380px wide (220-640px).')
    expect(report.sidebarWidth.set).not.toHaveBeenCalled()
    expect(() => runWorkspaceAction({ kind: 'sidebarWidth', width: Number.NaN }, ctx())).toThrow('number of pixels')
  })

  it('resets to the usual width, and the state text shows the width next to shown/hidden', () => {
    const c = ctx({ sidebarWidth: { value: 500, set: vi.fn(), reset: vi.fn() } })
    expect(runWorkspaceAction({ kind: 'sidebarWidth', width: 'reset' }, c)).toBe('The sidebar is back to its usual 300px width.')
    expect(c.sidebarWidth.reset).toHaveBeenCalled()
    expect(describeWorkspace(c)).toContain('Sidebar: shown, 500px wide (220-640px)')
    expect(describeWorkspace(ctx({ sidebarOpen: false }))).toContain('Sidebar: hidden, 300px wide (220-640px)')
  })
})

describe('jarvisUiBridge', () => {
  it('waits for the workspace of the wanted mode to mount', async () => {
    const off = registerWorkspaceUi('ops', () => 'ops did it')
    let waited = 0
    const pending = workspaceUiFor('code', 1000, async () => {
      waited += 1
      if (waited === 3) registerWorkspaceUi('code', () => 'code did it')
    })
    expect((await pending)({ kind: 'state' })).toBe('code did it')
    off()
    await expect(workspaceUiFor('ops', 100, async () => undefined)).rejects.toThrow('Ops mode screen did not open')
  })
})

describe('modeForCommand', () => {
  const cmd = (over: Partial<JarvisUiCommand>): JarvisUiCommand => ({ id: '1', action: { kind: 'state' }, ...over })
  const main = { role: 'main' as const, mode: 'ops' as const, codePoppedOut: false, setMode: vi.fn() }
  it('switches modes in the main window, never in the Code window or to a popped-out Code', () => {
    expect(modeForCommand(cmd({}), main)).toBeNull()
    expect(modeForCommand(cmd({ mode: 'code' }), main)).toBe('code')
    expect(modeForCommand(cmd({ action: { kind: 'mode', mode: 'code' } }), main)).toBe('code')
    expect(() => modeForCommand(cmd({ mode: 'code' }), { ...main, codePoppedOut: true })).toThrow('own window')
    expect(() => modeForCommand(cmd({ mode: 'ops' }), { ...main, role: 'code', mode: 'code' })).toThrow('Code mode only')
  })
})
