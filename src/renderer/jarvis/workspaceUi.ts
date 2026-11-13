// What a window does when Jarvis changes the screen (D55). The workspace hands over its own hooks (the same ones its
// buttons call) as a context; this module only decides which of them to call and says what happened. No React here,
// so it is unit-tested with fakes.
import type { Id, JarvisUiAction, UiMode } from '../../shared/types'
import type { MainView } from '../mode/viewPref'
import type { GridLayout, GridPreset } from '../grid/gridLogic'
import { GRID_PRESETS } from '../grid/gridLogic'
import type { SettingsSection } from '../settings/SettingsDialog'
import type { SidePanelTab } from '../timeline/sidePanelTab'
import { applySidebarView, describeSidebarView, type SidebarViewControl } from './sidebarView'
import type { ChangesFileRequest } from '../code/changes/changesRequest'
import {
  clampSidebarWidth,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN
} from '../shell/sidebarWidth'

export interface WorkspaceUiContext {
  readonly mode: UiMode
  readonly view: MainView
  readonly setView: (view: MainView) => void
  /** Leaves the grid keeping the focused cell's session on screen (the Exit grid button). */
  readonly exitGrid: () => void
  readonly names: ReadonlyMap<Id, string>
  /** The session on screen; null = none. */
  readonly activeId: Id | null
  /** Tabs shown in the tab bar. */
  readonly barIds: readonly Id[]
  readonly openTab: (id: Id) => void
  readonly grid: {
    readonly layout: GridLayout
    readonly setPreset: (preset: GridPreset) => void
    readonly setCell: (index: number, id: Id | null) => void
  }
  readonly split: {
    readonly paneIds: readonly Id[]
    readonly canSplit: boolean
    readonly splitRight: () => void
    readonly splitDown: () => void
    readonly unsplit: () => void
    readonly openToSide: (id: Id, direction: 'right' | 'down') => void
  }
  readonly sidebarOpen: boolean
  readonly setSidebarOpen: (open: boolean) => void
  /** D70: the sessions sidebar's width, changed through the drag handle's own commit path. */
  readonly sidebarWidth: {
    readonly value: number
    /** The drag handle's "let go" path: the screen and the saved value. */
    readonly set: (px: number) => void
    readonly reset: () => void
  }
  readonly sidePanel: {
    readonly open: boolean
    readonly tab: SidePanelTab
    /** Changes is offered only for a worktree session. */
    readonly hasChanges: boolean
    readonly setOpen: (open: boolean) => void
    readonly setTab: (tab: SidePanelTab) => void
  }
  readonly dialogs: {
    readonly settings: SettingsSection | null
    readonly costs: boolean
    readonly search: boolean
    readonly palette: boolean
    readonly openSettings: (section: SettingsSection | null) => void
    readonly setCosts: (open: boolean) => void
    readonly setSearch: (open: boolean) => void
    readonly setPalette: (open: boolean) => void
    readonly showAway: () => void
    readonly openNew: () => void
  }
  readonly zoom: { readonly percent: number; readonly step: (action: 'in' | 'out' | 'reset') => void }
  readonly workers: {
    readonly visible: readonly { readonly id: string; readonly name: string }[]
    readonly selectedId: string | null
    readonly select: (id: string | null) => void
    readonly dismiss: (id: string) => void
  }
  /** D58: the mounted sidebar's list view (null while it is not mounted). */
  readonly sidebarView: () => SidebarViewControl | null
  /** D58: the terminal search bar (Ctrl+Shift+F). */
  readonly search: {
    readonly active: boolean
    readonly query: string
    readonly label: string
    readonly open: () => void
    readonly close: () => void
    readonly setQuery: (query: string) => void
    readonly step: (direction: 'next' | 'previous') => void
  }
  /** D58: the tab bar (cycle like Ctrl+Tab; closing tabs closes their sessions, like the tab menu). */
  readonly tabs: {
    readonly cycle: (delta: 1 | -1) => void
    readonly close: (id: Id) => void
  }
  /** D58: shows one changed file in the Changes panel. */
  readonly requestChangesFile: (request: ChangesFileRequest) => void
}

const SETTINGS_SECTIONS: readonly SettingsSection[] = ['general', 'agents', 'code', 'terminal', 'sound', 'automation', 'quota', 'statuses']

function nameOf(ctx: WorkspaceUiContext, id: Id | null): string {
  return id === null ? '(empty)' : `"${ctx.names.get(id) ?? id}"`
}

function modeLabel(mode: UiMode): string {
  return mode === 'code' ? 'Code' : 'Ops'
}

/** A readable picture of the window for Jarvis (get_screen_state). */
export function describeWorkspace(ctx: WorkspaceUiContext): string {
  const lines = [`Mode: ${modeLabel(ctx.mode)}`]
  if (ctx.view === 'grid') {
    lines.push(`View: grid ${ctx.grid.layout.preset}`)
    lines.push(...ctx.grid.layout.cells.map((id, i) => `  cell ${i + 1}: ${nameOf(ctx, id)}`))
  } else if (ctx.view === 'hub') {
    lines.push('View: Hub (board of sessions by status)')
  } else if (ctx.split.paneIds.length > 1) {
    lines.push(`View: terminal, split in ${ctx.split.paneIds.length} panes: ${ctx.split.paneIds.map((id) => nameOf(ctx, id)).join(', ')}`)
  } else {
    lines.push('View: terminal')
  }
  lines.push(`On screen: ${ctx.activeId === null ? 'no session' : nameOf(ctx, ctx.activeId)}`)
  lines.push(`Tab bar: ${ctx.barIds.map((id) => nameOf(ctx, id)).join(', ') || '(no tabs)'}`)
  lines.push(`Sidebar: ${ctx.sidebarOpen ? 'shown' : 'hidden'}, ${ctx.sidebarWidth.value}px wide (${SIDEBAR_WIDTH_MIN}-${SIDEBAR_WIDTH_MAX}px)`)
  lines.push(`Side panel: ${ctx.sidePanel.open && ctx.view === 'terminal' && ctx.activeId !== null ? `open on ${ctx.sidePanel.tab}` : 'closed'}`)
  lines.push(`Terminal zoom: ${ctx.zoom.percent}%`)
  if (ctx.search.active) lines.push(`Terminal search: "${ctx.search.query}"${ctx.search.label.length > 0 ? ` (${ctx.search.label})` : ''}`)
  const sidebarView = ctx.sidebarView()
  if (sidebarView !== null) lines.push(describeSidebarView(sidebarView))
  if (ctx.workers.visible.length > 0) {
    lines.push(`Worker tabs: ${ctx.workers.visible.map((w) => `"${w.name}"${w.id === ctx.workers.selectedId ? ' (shown)' : ''}`).join(', ')}`)
  }
  const open = [
    ctx.dialogs.settings !== null ? `Settings (${ctx.dialogs.settings})` : null,
    ctx.dialogs.costs ? 'Costs' : null,
    ctx.dialogs.search ? 'Search conversations' : null,
    ctx.dialogs.palette ? 'Command palette' : null
  ].filter((d): d is string => d !== null)
  lines.push(`Dialogs open: ${open.join(', ') || 'none'}`)
  return lines.join('\n')
}

/** Runs one action and returns what it did; throws an Error with a plain message when it cannot. */
export function runWorkspaceAction(action: JarvisUiAction, ctx: WorkspaceUiContext): string {
  switch (action.kind) {
    case 'state':
      return describeWorkspace(ctx)
    case 'mode':
      return `Showing ${modeLabel(ctx.mode)} mode.`
    case 'view': {
      if (action.view === ctx.view) return `The ${action.view} view is already on screen.`
      if (action.view === 'terminal' && ctx.view === 'grid') ctx.exitGrid()
      else ctx.setView(action.view)
      return `Showing the ${action.view === 'hub' ? 'Hub' : action.view} view.`
    }
    case 'grid': {
      const preset = action.preset
      if (preset !== undefined && !(GRID_PRESETS as readonly string[]).includes(preset)) throw new Error(`Unknown grid layout "${preset}".`)
      if (preset !== undefined) ctx.grid.setPreset(preset as GridPreset)
      const cells = action.cells ?? []
      cells.forEach((id, index) => {
        if (id !== null) ctx.openTab(id)
        ctx.grid.setCell(index, id)
      })
      if (ctx.view !== 'grid') ctx.setView('grid')
      const shown = preset ?? ctx.grid.layout.preset
      const described = cells.length > 0 ? `: ${cells.map((id, i) => `cell ${i + 1} ${nameOf(ctx, id)}`).join(', ')}` : ''
      return `Showing the grid ${shown}${described}.`
    }
    case 'split': {
      if (ctx.view !== 'terminal') ctx.setView('terminal')
      if (action.how === 'unsplit') {
        if (ctx.split.paneIds.length <= 1) return 'The terminal is not split.'
        ctx.split.unsplit()
        return 'Back to one pane.'
      }
      if (!ctx.split.canSplit) throw new Error('Cannot split: there is no other open session to show, or there are already 4 panes.')
      if (action.how === 'right') ctx.split.splitRight()
      else ctx.split.splitDown()
      return `Split ${action.how}.`
    }
    case 'openToSide': {
      if (ctx.view !== 'terminal') ctx.setView('terminal')
      ctx.openTab(action.id)
      ctx.split.openToSide(action.id, action.direction)
      return `Showing ${nameOf(ctx, action.id)} beside the current session (${action.direction}).`
    }
    case 'sidebar':
      ctx.setSidebarOpen(action.open)
      return `The sidebar is ${action.open ? 'shown' : 'hidden'}.`
    case 'sidebarWidth': {
      if (action.width === null) return `The sidebar is ${ctx.sidebarWidth.value}px wide (${SIDEBAR_WIDTH_MIN}-${SIDEBAR_WIDTH_MAX}px).`
      if (action.width === 'reset') {
        ctx.sidebarWidth.reset()
        return `The sidebar is back to its usual ${SIDEBAR_WIDTH_DEFAULT}px width.`
      }
      if (!Number.isFinite(action.width)) throw new Error('The sidebar width must be a number of pixels.')
      const width = clampSidebarWidth(action.width)
      ctx.sidebarWidth.set(width)
      if (action.width < SIDEBAR_WIDTH_MIN) return `Asked for ${Math.round(action.width)}px; the limit is ${SIDEBAR_WIDTH_MIN}px, so the sidebar is now ${width}px wide.`
      if (action.width > SIDEBAR_WIDTH_MAX) return `Asked for ${Math.round(action.width)}px; the limit is ${SIDEBAR_WIDTH_MAX}px, so the sidebar is now ${width}px wide.`
      return `The sidebar is now ${width}px wide.`
    }
    case 'sidePanel': {
      if (!action.open) {
        ctx.sidePanel.setOpen(false)
        return 'The side panel is closed.'
      }
      if (ctx.activeId === null) throw new Error('No session is on screen; open one first (open_session).')
      if (action.tab === 'changes' && !ctx.sidePanel.hasChanges) throw new Error('The session on screen is not in a worktree, so it has no Changes tab.')
      if (ctx.view !== 'terminal') ctx.setView('terminal')
      if (action.tab !== undefined) ctx.sidePanel.setTab(action.tab)
      ctx.sidePanel.setOpen(true)
      return `The side panel is open on ${action.tab ?? ctx.sidePanel.tab} for ${nameOf(ctx, ctx.activeId)}.`
    }
    case 'dialog': {
      const d = ctx.dialogs
      switch (action.name) {
        case 'settings': {
          const section = (action.section ?? 'general') as SettingsSection
          if (!SETTINGS_SECTIONS.includes(section)) throw new Error(`Unknown settings page "${action.section ?? ''}".`)
          d.openSettings(section)
          return `Settings are open on ${section}.`
        }
        case 'costs': d.setCosts(true); return 'The cost report is open.'
        case 'search': d.setSearch(true); return 'Search conversations is open.'
        case 'away': d.showAway(); return 'Showing the last "While you were away" summary (if there is one).'
        case 'palette': d.setPalette(true); return 'The command palette is open.'
        case 'newSession': d.openNew(); return 'The New session form is open.'
        case 'none':
          d.openSettings(null)
          d.setCosts(false)
          d.setSearch(false)
          d.setPalette(false)
          return 'Closed the dialogs.'
        default:
          throw new Error('Unknown dialog.')
      }
    }
    case 'zoom':
      ctx.zoom.step(action.action)
      return action.action === 'reset' ? 'Terminal zoom is back to 100%.' : `Zoomed ${action.action} (was ${ctx.zoom.percent}%).`
    case 'worker': {
      if (action.op === 'leave') {
        ctx.workers.select(null)
        return 'Back to the session terminal.'
      }
      const worker = ctx.workers.visible.find((w) => w.id === action.workerId)
      if (worker === undefined) throw new Error('That worker has no tab right now (worker tabs belong to the session on screen).')
      if (action.op === 'dismiss') {
        ctx.workers.dismiss(worker.id)
        return `Closed the tab of worker "${worker.name}" (it keeps running).`
      }
      if (ctx.view !== 'terminal') ctx.setView('terminal')
      ctx.workers.select(worker.id)
      return `Showing worker "${worker.name}".`
    }
    case 'sidebarView': {
      const control = ctx.sidebarView()
      if (control === null) throw new Error('The sidebar is still loading.')
      const { kind: _kind, ...view } = action
      const result = applySidebarView(view, control)
      if (!ctx.sidebarOpen) ctx.setSidebarOpen(true)
      return result
    }
    case 'search': {
      if (action.op === 'close') {
        if (!ctx.search.active) return 'The terminal search is not open.'
        ctx.search.close()
        return 'Closed the terminal search.'
      }
      if (action.op === 'next' || action.op === 'previous') {
        if (!ctx.search.active || ctx.search.query.length === 0) throw new Error('No terminal search is open; start one with a query first.')
        ctx.search.step(action.op)
        return `Moved to the ${action.op} match of "${ctx.search.query}".`
      }
      const query = action.query ?? ''
      if (query.length === 0) throw new Error('Give the text to search for.')
      if (ctx.activeId === null) throw new Error('No session is on screen; open one first (open_session).')
      if (ctx.view === 'hub') ctx.setView('terminal')
      if (!ctx.search.active) ctx.search.open()
      ctx.search.setQuery(query)
      return `Searching ${nameOf(ctx, ctx.activeId)} for "${query}"; the matches are highlighted (get_screen_state shows the count).`
    }
    case 'tabs': {
      if (action.op === 'next' || action.op === 'previous') {
        if (ctx.barIds.length < 2) throw new Error('There is only one tab in the tab bar.')
        if (ctx.view !== 'terminal') ctx.setView('terminal')
        ctx.tabs.cycle(action.op === 'next' ? 1 : -1)
        return `Switched to the ${action.op} tab.`
      }
      const targets = action.op === 'closeAll' ? ctx.barIds : ctx.barIds.filter((id) => id !== ctx.activeId)
      if (targets.length === 0) return 'There are no other tabs to close.'
      targets.forEach(ctx.tabs.close)
      return `Closed ${targets.map((id) => nameOf(ctx, id)).join(', ')} (their sessions close and can be reopened).`
    }
    case 'changesFile': {
      ctx.requestChangesFile({ worktreeId: action.worktreeId, path: action.path, view: action.view })
      return action.path === null ? 'The Changes panel shows the list of changed files.' : `Showing ${action.path} (${action.view}) in the Changes panel.`
    }
    case 'sound':
      throw new Error('Sounds are set by the window, not the workspace.')
    default:
      throw new Error('Unknown screen action.')
  }
}
