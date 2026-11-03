// Jarvis tools that change what is on screen (D55): mode, view, grid, split, sidebar, side panel, dialogs, zoom and
// worker tabs. Main resolves names to ids and picks the mode; the window runs the action with the same hooks its
// buttons use and answers with what it did (jarvisWiring's ui round trip).
import type { Id, JarvisUiAction, Session, UiMode } from '../../shared/types'
import type { McpTool } from './mcpProtocol'
import { resolveSession } from './targets'
import { optionalBool, optionalText, schema, SESSION_PROP, text } from './toolArgs'
import type { JarvisToolDeps } from './jarvisTools'

export const GRID_PRESETS = ['1x1', '2x1', '1x2', '2x2', '2x3', '3x2'] as const
const GRID_CELLS: Readonly<Record<string, number>> = { '1x1': 1, '2x1': 2, '1x2': 2, '2x2': 4, '2x3': 6, '3x2': 6 }
const SETTINGS_PAGES = ['general', 'agents', 'code', 'terminal', 'sound', 'automation', 'quota', 'statuses'] as const
const MODE_PROP = { type: 'string', enum: ['ops', 'code'], description: 'Which mode (default: the one on screen).' }

/** The window side of a UI tool: the window runs the action and answers with text. */
export type JarvisUi = (mode: UiMode | undefined, action: JarvisUiAction) => Promise<string>

export function modeOf(session: Pick<Session, 'worktreeId'>): UiMode {
  return session.worktreeId !== undefined ? 'code' : 'ops'
}

function optionalMode(args: Readonly<Record<string, unknown>>): UiMode | undefined {
  const mode = optionalText(args, 'mode')
  if (mode === undefined) return undefined
  if (mode !== 'ops' && mode !== 'code') throw new Error('"mode" must be ops or code.')
  return mode
}

/** One mode for several sessions (grid cells live in one mode's grid). */
function commonMode(sessions: readonly Session[], given: UiMode | undefined): UiMode | undefined {
  const modes = new Set(sessions.map(modeOf))
  if (given !== undefined) modes.add(given)
  if (modes.size > 1) throw new Error('Those sessions are in different modes (Ops and Code); a grid shows one mode\'s sessions.')
  return [...modes][0]
}

export function createUiTools(deps: JarvisToolDeps): McpTool[] {
  const ui = deps.ui
  const openSession = (args: Readonly<Record<string, unknown>>, key = 'session'): Session | undefined => {
    const ref = optionalText(args, key)
    if (ref === undefined) return undefined
    const session = resolveSession(deps.getData(), ref)
    if (session.closedAt !== undefined) throw new Error(`"${session.name}" is closed; open it first (open_session or wake_session).`)
    return session
  }

  return [
    {
      name: 'get_screen_state',
      description: 'What the SessionDeck window shows right now: mode (Ops/Code), view (terminal, grid, Hub), the grid layout and its cells, split panes, tabs, the session on screen, sidebar, side panel, zoom, worker tabs, open dialogs, and whether the Code window is popped out. Call before changing the screen.',
      inputSchema: schema({}),
      run: async () => {
        const state = await ui(undefined, { kind: 'state' })
        return `${state}\nCode window: ${deps.app.windowState().codePoppedOut ? 'popped out (Code mode is in its own window)' : 'docked (Code mode is in the main window)'}`
      }
    },
    {
      name: 'switch_mode',
      description: 'Switches the main window between Ops mode (sessions in folders and groups) and Code mode (repos, worktrees, changes). When the Code window is popped out, Code mode is brought forward in it instead.',
      inputSchema: schema({ mode: { type: 'string', enum: ['ops', 'code'] } }, ['mode']),
      run: async (args) => {
        const mode = optionalMode(args)
        if (mode === undefined) throw new Error('"mode" is required.')
        if (mode === 'code' && deps.app.windowState().codePoppedOut) {
          deps.app.popOutCode()
          deps.log('switch_mode', 'code (window)')
          return 'Code mode is in its own window; brought it forward.'
        }
        const result = await ui(undefined, { kind: 'mode', mode })
        deps.log('switch_mode', mode)
        return result
      }
    },
    {
      name: 'set_view',
      description: 'Changes the main area: terminal (one session, or the split panes), grid (several sessions at once; set it up with set_grid), or hub (the board of sessions by status).',
      inputSchema: schema({ view: { type: 'string', enum: ['terminal', 'grid', 'hub'] }, mode: MODE_PROP }, ['view']),
      run: async (args) => {
        const view = text(args, 'view')
        if (view !== 'terminal' && view !== 'grid' && view !== 'hub') throw new Error('"view" must be terminal, grid or hub.')
        const result = await ui(optionalMode(args), { kind: 'view', view })
        deps.log('set_view', view)
        return result
      }
    },
    {
      name: 'set_grid',
      description: `Shows the grid view and sets it up: a layout (${GRID_PRESETS.join(', ')}: columns x rows) and/or which session goes in each cell (cells: session names in reading order, null for an empty cell). A session already in another cell moves. Leave the grid with set_view terminal.`,
      inputSchema: schema({
        preset: { type: 'string', enum: [...GRID_PRESETS] },
        cells: { type: 'array', items: { type: ['string', 'null'] }, description: 'Session per cell, left to right, top to bottom; null = empty.' },
        mode: MODE_PROP
      }),
      run: async (args) => {
        const preset = optionalText(args, 'preset')
        if (preset !== undefined && GRID_CELLS[preset] === undefined) throw new Error(`"preset" must be one of ${GRID_PRESETS.join(', ')}.`)
        let cells: (Id | null)[] | undefined
        let sessions: Session[] = []
        if (Array.isArray(args.cells)) {
          const data = deps.getData()
          cells = args.cells.map((ref) => {
            if (ref === null || ref === '') return null
            const session = resolveSession(data, ref)
            if (session.closedAt !== undefined) throw new Error(`"${session.name}" is closed; a grid cell shows an open session (open it first).`)
            sessions = [...sessions, session]
            return session.id
          })
          const ids = cells.filter((id): id is Id => id !== null)
          if (new Set(ids).size !== ids.length) throw new Error('A session can be in one cell only.')
          if (preset !== undefined && cells.length > GRID_CELLS[preset]) throw new Error(`Layout ${preset} has ${GRID_CELLS[preset]} cell(s); you gave ${cells.length}.`)
        }
        const mode = commonMode(sessions, optionalMode(args))
        const result = await ui(mode, { kind: 'grid', ...(preset !== undefined ? { preset } : {}), ...(cells !== undefined ? { cells } : {}) })
        deps.log('set_grid', `${preset ?? ''} ${cells?.length ?? 0} cell(s)`)
        return result
      }
    },
    {
      name: 'split_view',
      description: 'Splits the terminal view: right or down (adds the next open session beside the current one; or give session to put that one beside it), or unsplit (back to one pane). Up to 4 panes.',
      inputSchema: schema({ how: { type: 'string', enum: ['right', 'down', 'unsplit'] }, session: SESSION_PROP, mode: MODE_PROP }, ['how']),
      run: async (args) => {
        const how = text(args, 'how')
        if (how !== 'right' && how !== 'down' && how !== 'unsplit') throw new Error('"how" must be right, down or unsplit.')
        const session = how === 'unsplit' ? undefined : openSession(args)
        const action: JarvisUiAction = session !== undefined
          ? { kind: 'openToSide', id: session.id, direction: how === 'down' ? 'down' : 'right' }
          : { kind: 'split', how }
        const result = await ui(session !== undefined ? modeOf(session) : optionalMode(args), action)
        deps.log('split_view', `${how}${session !== undefined ? ` ${session.name}` : ''}`)
        return result
      }
    },
    {
      name: 'show_sidebar',
      description: 'Shows or hides the left sidebar (the session list).',
      inputSchema: schema({ open: { type: 'boolean' }, mode: MODE_PROP }, ['open']),
      run: async (args) => {
        const open = optionalBool(args, 'open')
        if (open === undefined) throw new Error('"open" is required.')
        const result = await ui(optionalMode(args), { kind: 'sidebar', open })
        deps.log('show_sidebar', String(open))
        return result
      }
    },
    {
      name: 'side_panel',
      description: 'Opens or closes the side panel next to the terminal, on a tab: notes (notes + checklist), activity (turn history), queue (queued prompts) or changes (Code mode worktree changes). Give session to show that session first.',
      inputSchema: schema({ open: { type: 'boolean' }, tab: { type: 'string', enum: ['notes', 'activity', 'queue', 'changes'] }, session: SESSION_PROP }, ['open']),
      run: async (args) => {
        const open = optionalBool(args, 'open')
        if (open === undefined) throw new Error('"open" is required.')
        const tab = optionalText(args, 'tab')
        if (tab !== undefined && !['notes', 'activity', 'queue', 'changes'].includes(tab)) throw new Error('"tab" must be notes, activity, queue or changes.')
        const session = openSession(args)
        if (tab === 'changes' && session !== undefined && session.worktreeId === undefined) throw new Error(`"${session.name}" is not in a worktree; only Code mode sessions have a Changes tab.`)
        if (session !== undefined) {
          deps.openSession(session.id)
          await deps.sleep(400)
        }
        const result = await ui(session !== undefined ? modeOf(session) : undefined, { kind: 'sidePanel', open, ...(tab !== undefined ? { tab: tab as 'notes' | 'activity' | 'queue' | 'changes' } : {}) })
        deps.log('side_panel', `${open} ${tab ?? ''}`)
        return result
      }
    },
    {
      name: 'open_dialog',
      description: `Opens a window of the app for the user: settings (optionally on a page: ${SETTINGS_PAGES.join(', ')}), costs (cost over time), search (search past conversations), away (the last "While you were away" summary), palette (command palette), new_session (the New session form), or none (close them).`,
      inputSchema: schema({ name: { type: 'string', enum: ['settings', 'costs', 'search', 'away', 'palette', 'new_session', 'none'] }, page: { type: 'string', enum: [...SETTINGS_PAGES] }, mode: MODE_PROP }, ['name']),
      run: async (args) => {
        const raw = text(args, 'name')
        const names: Readonly<Record<string, 'settings' | 'costs' | 'search' | 'away' | 'palette' | 'newSession' | 'none'>> = {
          settings: 'settings', costs: 'costs', search: 'search', away: 'away', palette: 'palette', new_session: 'newSession', none: 'none'
        }
        const name = names[raw]
        if (name === undefined) throw new Error('Unknown dialog.')
        const page = optionalText(args, 'page')
        if (page !== undefined && !(SETTINGS_PAGES as readonly string[]).includes(page)) throw new Error(`"page" must be one of ${SETTINGS_PAGES.join(', ')}.`)
        const result = await ui(optionalMode(args), { kind: 'dialog', name, ...(page !== undefined ? { section: page } : {}) })
        deps.log('open_dialog', `${raw}${page !== undefined ? ` ${page}` : ''}`)
        return result
      }
    },
    {
      name: 'terminal_zoom',
      description: 'Makes the terminal text bigger (in), smaller (out) or normal (reset), for every session.',
      inputSchema: schema({ action: { type: 'string', enum: ['in', 'out', 'reset'] }, steps: { type: 'integer', description: 'How many steps (default 1, max 10).' } }, ['action']),
      run: async (args) => {
        const action = text(args, 'action')
        if (action !== 'in' && action !== 'out' && action !== 'reset') throw new Error('"action" must be in, out or reset.')
        const steps = action === 'reset' ? 1 : Math.min(Math.max(typeof args.steps === 'number' ? Math.floor(args.steps) : 1, 1), 10)
        let result = ''
        for (let i = 0; i < steps; i += 1) result = await ui(undefined, { kind: 'zoom', action })
        deps.log('terminal_zoom', `${action} x${steps}`)
        return result
      }
    },
    {
      name: 'worker_tab',
      description: 'OpenCode worker tabs of the session on screen: show (read a worker\'s output in its tab), dismiss (close its tab; the worker keeps running), or leave (back to the session\'s terminal). Workers come from list_workers.',
      inputSchema: schema({ op: { type: 'string', enum: ['show', 'dismiss', 'leave'] }, worker: { type: 'string', description: 'Worker name or id.' } }, ['op']),
      run: async (args) => {
        const op = text(args, 'op')
        if (op !== 'show' && op !== 'dismiss' && op !== 'leave') throw new Error('"op" must be show, dismiss or leave.')
        let workerId: string | undefined
        let mode: UiMode | undefined
        if (op !== 'leave') {
          const ref = text(args, 'worker').trim().toLowerCase()
          const matches = deps.app.workers().filter((w) => w.id.toLowerCase() === ref || w.name.toLowerCase() === ref || w.name.toLowerCase().includes(ref))
          if (matches.length === 0) throw new Error(`No worker matches "${String(args.worker)}". Call list_workers.`)
          if (matches.length > 1) throw new Error(`"${String(args.worker)}" matches ${matches.length} workers: ${matches.slice(0, 5).map((w) => `"${w.name}" (id ${w.id})`).join(', ')}. Pass the id.`)
          workerId = matches[0].id
          // A worker tab belongs to its session: show that session first.
          const owner = deps.getData().sessions.find((s) => matches[0].ownerSessionIds.includes(s.id) && s.closedAt === undefined)
          if (owner !== undefined && op === 'show') {
            deps.openSession(owner.id)
            mode = modeOf(owner)
            await deps.sleep(400)
          }
        }
        const result = await ui(mode, { kind: 'worker', op, ...(workerId !== undefined ? { workerId } : {}) })
        deps.log('worker_tab', `${op} ${workerId ?? ''}`)
        return result
      }
    }
  ]
}
