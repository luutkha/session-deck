// Jarvis tools for the last parts of the app (D58): notification sounds, the sidebar list view and the Code tree,
// a changed file on screen, terminal search, tabs, files and images into a session, links in a terminal, and the app
// itself (window, quit, start on login). Same rules as the other tool files: the paths the UI uses, a confirm before
// anything the user may not want (quit), an undo step where it can be reverted, a log line per action.
import type { Id, JarvisSoundChoice, JarvisUiAction, LoginItemState, OpenLinkResult, Session, SoundEvent } from '../../shared/types'
import type { McpTool } from './mcpProtocol'
import { resolveRepo, resolveSession, resolveStatus, resolveWorktree } from './targets'
import { optionalBool, optionalText, schema, SESSION_PROP, text } from './toolArgs'
import type { JarvisToolDeps } from './jarvisTools'
import type { ToolContext } from './appTools'
import { modeOf } from './uiTools'

const SOUND_EVENTS: readonly SoundEvent[] = ['permission', 'done', 'idle', 'bell', 'quota']
const BUILTIN_SOUNDS = ['chime', 'ping', 'pop', 'bell', 'marimba', 'soft'] as const
const ATTACH_MAX = 20
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|bmp)$/i
const SIDEBAR_SORTS = ['manual', 'attention', 'recent', 'newest', 'name'] as const
type SidebarSort = typeof SIDEBAR_SORTS[number]
function isSidebarSort(value: string): value is SidebarSort {
  return (SIDEBAR_SORTS as readonly string[]).includes(value)
}
const MODE_PROP ={ type: 'string', enum: ['ops', 'code'], description: 'Which mode (default: the one on screen).' }
/** Bracketed paste markers: an agent then takes the text as one paste (Claude turns image paths into attachments). */
const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

/** What the control tools need besides the other deps. Wired in index.ts with the IPC handlers' functions. */
export interface JarvisControlDeps {
  readonly setRepoCollapsed: (id: Id, collapsed: boolean) => void
  readonly setWorktreeCollapsed: (id: Id, collapsed: boolean) => void
  /** The terminal link opener (re-resolves the text against the session's folder; never runs programs). */
  readonly openLink: (sessionId: Id, text: string, reveal: boolean) => Promise<OpenLinkResult>
  /** 'file' / 'folder', or null when the path does not exist. */
  readonly pathKind: (path: string) => Promise<'file' | 'folder' | null>
  /** Puts an image file on the system clipboard; false when it is not a readable image. */
  readonly copyImage: (path: string) => boolean
  readonly loginItem: { get(): LoginItemState; set(openAtLogin: boolean): LoginItemState }
  readonly showWindow: () => void
  readonly hideWindow: () => void
  /** Quits the app like the tray's Quit (sessions running now start again on the next launch when that is on). */
  readonly quit: () => void
}

function optionalMode(args: Readonly<Record<string, unknown>>): 'ops' | 'code' | undefined {
  const mode = optionalText(args, 'mode')
  if (mode === undefined) return undefined
  if (mode !== 'ops' && mode !== 'code') throw new Error('"mode" must be ops or code.')
  return mode
}

function soundChoice(raw: string): JarvisSoundChoice {
  const value = raw.trim()
  if (value.toLowerCase() === 'none') return { kind: 'none' }
  if ((BUILTIN_SOUNDS as readonly string[]).includes(value.toLowerCase())) return { kind: 'builtin', id: value.toLowerCase() }
  if (/^[a-zA-Z]:[\\/]|^\//.test(value)) return { kind: 'file', path: value }
  throw new Error(`"sound" must be one of ${BUILTIN_SOUNDS.join(', ')}, none, or the full path of an audio file.`)
}

/** Paths as the user would drop them on the pane: quoted when needed, space separated, a space after. */
export function formatAttachPaths(paths: readonly string[]): string {
  return `${paths.map((p) => (/[\s"'&()^%!;,=[\]{}$`~#]/.test(p) ? `"${p.replace(/"/g, '')}"` : p)).join(' ')} `
}

/** True when the program in the pty asked for bracketed paste last (ESC[?2004h after any ESC[?2004l). */
export function bracketedPasteOn(raw: string): boolean {
  return raw.lastIndexOf('\x1b[?2004h') > raw.lastIndexOf('\x1b[?2004l')
}

export function createControlTools(deps: JarvisToolDeps, ctx: ToolContext): McpTool[] {
  const control = deps.control
  const ui = deps.ui
  const liveSession = (ref: unknown): Session => {
    const session = resolveSession(deps.getData(), ref)
    if (session.closedAt !== undefined) throw new Error(`"${session.name}" is closed; open it first (open_session).`)
    return session
  }

  return [
    {
      name: 'sound_settings',
      description: `Notification sounds (Settings > Sound): turn them on or off, set the volume (0-100), pick the sound of one event (${SOUND_EVENTS.join(', ')}: permission request, turn finished, waiting for input, terminal bell, quota alert) as ${BUILTIN_SOUNDS.join(', ')}, none, or an audio file path, and play it to test. With no arguments it shows the current sounds.`,
      inputSchema: schema({
        enabled: { type: 'boolean' },
        volume: { type: 'integer', description: '0 to 100.' },
        event: { type: 'string', enum: [...SOUND_EVENTS] },
        sound: { type: 'string', description: 'For "event": a built-in sound, none, or the full path of an audio file.' },
        test: { type: 'boolean', description: 'Play the sound of "event" (default: done) after the change.' }
      }),
      run: async (args) => {
        const event = optionalText(args, 'event') as SoundEvent | undefined
        if (event !== undefined && !SOUND_EVENTS.includes(event)) throw new Error(`"event" must be one of ${SOUND_EVENTS.join(', ')}.`)
        const sound = optionalText(args, 'sound')
        if (sound !== undefined && event === undefined) throw new Error('Say which "event" the sound is for.')
        let events: Partial<Record<SoundEvent, JarvisSoundChoice>> | undefined
        if (sound !== undefined && event !== undefined) {
          const choice = soundChoice(sound)
          if (choice.kind === 'file' && (await control.pathKind(choice.path)) !== 'file') throw new Error(`No audio file at ${choice.path}.`)
          events = { [event]: choice }
        }
        const volume = args.volume
        if (volume !== undefined && (typeof volume !== 'number' || volume < 0 || volume > 100)) throw new Error('"volume" must be 0 to 100.')
        const enabled = optionalBool(args, 'enabled')
        const test = optionalBool(args, 'test') === true ? event ?? 'done' : undefined
        const action: JarvisUiAction = {
          kind: 'sound',
          ...(enabled !== undefined ? { enabled } : {}),
          ...(typeof volume === 'number' ? { volume: volume / 100 } : {}),
          ...(events !== undefined ? { events } : {}),
          ...(test !== undefined ? { test } : {})
        }
        const result = await ui(undefined, action)
        if (Object.keys(action).length > 1) deps.log('sound_settings', JSON.stringify({ enabled, volume, event, sound, test }))
        return result
      }
    },
    {
      name: 'sidebar_view',
      description: 'How the sidebar list looks: group_by (groups or status), show_folders (folder buckets inside groups), search (filter by name or folder; "" clears), status_filter (status names to show, "none" = sessions without a status; [] clears), closed_section (collapsed / expanded), sections (collapse_all / expand_all status sections and folder buckets), sort (how sessions are ordered inside each section, worktree and Hub column: manual = drag order, attention = needs you first then working, finished, idle, sleeping, exited; recent = last active first; newest = newest created first; name = A-Z; each mode keeps its own). Group collapse is group_change; repos and worktrees are code_tree. Ops mode has all options; Code mode has search, closed_section and sort. get_screen_state shows the current view.',
      inputSchema: schema({
        group_by: { type: 'string', enum: ['groups', 'status'] },
        show_folders: { type: 'boolean' },
        search: { type: 'string' },
        status_filter: { type: 'array', items: { type: 'string' } },
        closed_section: { type: 'string', enum: ['collapsed', 'expanded'] },
        sections: { type: 'string', enum: ['collapse_all', 'expand_all'] },
        sort: { type: 'string', enum: [...SIDEBAR_SORTS] },
        mode: MODE_PROP
      }),
      run: async (args) => {
        const groupBy = optionalText(args, 'group_by')
        if (groupBy !== undefined && groupBy !== 'groups' && groupBy !== 'status') throw new Error('"group_by" must be groups or status.')
        const closed = optionalText(args, 'closed_section')
        if (closed !== undefined && closed !== 'collapsed' && closed !== 'expanded') throw new Error('"closed_section" must be collapsed or expanded.')
        const sections = optionalText(args, 'sections')
        if (sections !== undefined && sections !== 'collapse_all' && sections !== 'expand_all') throw new Error('"sections" must be collapse_all or expand_all.')
        const search = args.search
        if (search !== undefined && typeof search !== 'string') throw new Error('"search" must be text.')
        const sort = optionalText(args, 'sort')
        if (sort !== undefined && !isSidebarSort(sort)) throw new Error(`"sort" must be one of ${SIDEBAR_SORTS.join(', ')}.`)
        let statusFilter: (Id | null)[] | undefined
        if (args.status_filter !== undefined) {
          if (!Array.isArray(args.status_filter)) throw new Error('"status_filter" must be a list of status names.')
          const data = deps.getData()
          statusFilter = args.status_filter.map((ref: unknown) => {
            if (typeof ref !== 'string') throw new Error('"status_filter" must be a list of status names.')
            return ref.trim().toLowerCase() === 'none' ? null : resolveStatus(data, ref).id
          })
        }
        const action: JarvisUiAction = {
          kind: 'sidebarView',
          ...(groupBy !== undefined ? { groupBy: groupBy as 'groups' | 'status' } : {}),
          ...(optionalBool(args, 'show_folders') !== undefined ? { showWorkspaces: optionalBool(args, 'show_folders') } : {}),
          ...(typeof search === 'string' ? { search } : {}),
          ...(statusFilter !== undefined ? { statusFilter } : {}),
          ...(closed !== undefined ? { closedSection: closed as 'collapsed' | 'expanded' } : {}),
          ...(sections !== undefined ? { sections: sections === 'collapse_all' ? 'collapseAll' as const : 'expandAll' as const } : {}),
          ...(sort !== undefined && isSidebarSort(sort) ? { sort } : {})
        }
        if (Object.keys(action).length === 1) throw new Error('Say what to change (see the parameters); get_screen_state shows the current view.')
        const result = await ui(optionalMode(args), action)
        deps.log('sidebar_view', JSON.stringify(args))
        return result
      }
    },
    {
      name: 'code_tree',
      description: 'Collapses or expands the Code mode sidebar tree: one repo (its worktrees), one worktree (its sessions), or everything when neither is given.',
      inputSchema: schema({
        action: { type: 'string', enum: ['collapse', 'expand'] },
        repo: { type: 'string', description: 'Repo name or id.' },
        worktree: { type: 'string', description: 'Worktree name, branch or id.' }
      }, ['action']),
      run: async (args) => {
        const action = text(args, 'action')
        if (action !== 'collapse' && action !== 'expand') throw new Error('"action" must be collapse or expand.')
        const collapsed = action === 'collapse'
        const data = deps.getData()
        const repoRef = optionalText(args, 'repo')
        const worktreeRef = optionalText(args, 'worktree')
        if (worktreeRef !== undefined) {
          const worktree = resolveWorktree(data, worktreeRef)
          control.setWorktreeCollapsed(worktree.id, collapsed)
          ctx.pushUndo(`${action} worktree "${worktree.name}"`, () => control.setWorktreeCollapsed(worktree.id, worktree.collapsed))
          deps.log('code_tree', `${action} worktree ${worktree.name}`)
          return `Worktree "${worktree.name}" is ${collapsed ? 'collapsed' : 'expanded'}.`
        }
        if (repoRef !== undefined) {
          const repo = resolveRepo(data, repoRef)
          control.setRepoCollapsed(repo.id, collapsed)
          ctx.pushUndo(`${action} repo "${repo.name}"`, () => control.setRepoCollapsed(repo.id, repo.collapsed))
          deps.log('code_tree', `${action} repo ${repo.name}`)
          return `Repo "${repo.name}" is ${collapsed ? 'collapsed' : 'expanded'}.`
        }
        const repos = data.repos ?? []
        const worktrees = data.worktrees ?? []
        if (repos.length === 0) throw new Error('No repos in Code mode yet.')
        repos.forEach((r) => control.setRepoCollapsed(r.id, collapsed))
        worktrees.forEach((w) => control.setWorktreeCollapsed(w.id, collapsed))
        ctx.pushUndo(`${action} the whole Code tree`, () => {
          repos.forEach((r) => control.setRepoCollapsed(r.id, r.collapsed))
          worktrees.forEach((w) => control.setWorktreeCollapsed(w.id, w.collapsed))
        })
        deps.log('code_tree', `${action} all`)
        return `${collapsed ? 'Collapsed' : 'Expanded'} ${repos.length} repo(s) and ${worktrees.length} worktree(s).`
      }
    },
    {
      name: 'open_file',
      description: 'Shows a changed file of a worktree on screen, in the Changes panel next to its session: view diff (default) or preview (rendered Markdown or the image). Give the session (or the worktree) and the file path as worktree_changes lists it; no path = back to the list of changed files.',
      inputSchema: schema({
        session: SESSION_PROP,
        worktree: { type: 'string', description: 'Worktree name, branch or id (instead of session).' },
        path: { type: 'string', description: 'File path relative to the worktree, as worktree_changes lists it.' },
        view: { type: 'string', enum: ['diff', 'preview'] }
      }),
      run: async (args) => {
        const data = deps.getData()
        const view = optionalText(args, 'view') ?? 'diff'
        if (view !== 'diff' && view !== 'preview') throw new Error('"view" must be diff or preview.')
        const sessionRef = optionalText(args, 'session')
        const worktreeRef = optionalText(args, 'worktree')
        let session: Session | undefined
        let worktreeId: Id
        if (sessionRef !== undefined) {
          session = liveSession(sessionRef)
          if (session.worktreeId === undefined) throw new Error(`"${session.name}" is not in a worktree; only Code mode sessions have changes.`)
          worktreeId = session.worktreeId
        } else if (worktreeRef !== undefined) {
          worktreeId = resolveWorktree(data, worktreeRef).id
          session = data.sessions.find((s) => s.worktreeId === worktreeId && s.closedAt === undefined && s.role !== 'jarvis')
          if (session === undefined) throw new Error('That worktree has no open session to show the Changes panel next to; open or create one first.')
        } else {
          throw new Error('Give "session" or "worktree".')
        }
        const path = optionalText(args, 'path')
        if (path !== undefined) {
          const changes = await deps.code.changes(worktreeId)
          const wanted = path.replace(/\\/g, '/')
          const file = changes.files.find((f) => f.path === wanted) ?? changes.files.find((f) => f.path.toLowerCase().endsWith(wanted.toLowerCase()))
          if (file === undefined) throw new Error(`"${path}" is not among the changed files (${changes.files.length}). Call worktree_changes.`)
          deps.openSession(session.id)
          await deps.sleep(400)
          await ui('code', { kind: 'sidePanel', open: true, tab: 'changes' })
          const result = await ui('code', { kind: 'changesFile', worktreeId, path: file.path, view })
          deps.log('open_file', `${file.path} (${view})`)
          return result
        }
        deps.openSession(session.id)
        await deps.sleep(400)
        await ui('code', { kind: 'sidePanel', open: true, tab: 'changes' })
        const result = await ui('code', { kind: 'changesFile', worktreeId, path: null, view: 'diff' })
        deps.log('open_file', 'list')
        return result
      }
    },
    {
      name: 'terminal_search',
      description: 'The search bar of the terminal on screen (Ctrl+Shift+F): find (highlight "query" in the session on screen; give session to show that one first), next / previous (move between matches), close. get_screen_state shows the match count. To read text yourself use read_screen.',
      inputSchema: schema({ action: { type: 'string', enum: ['find', 'next', 'previous', 'close'] }, query: { type: 'string' }, session: SESSION_PROP }, ['action']),
      run: async (args) => {
        const op = text(args, 'action')
        if (op !== 'find' && op !== 'next' && op !== 'previous' && op !== 'close') throw new Error('"action" must be find, next, previous or close.')
        const query = op === 'find' ? text(args, 'query') : undefined
        let mode: 'ops' | 'code' | undefined
        const ref = optionalText(args, 'session')
        if (ref !== undefined) {
          const session = liveSession(ref)
          deps.openSession(session.id)
          mode = modeOf(session)
          await deps.sleep(400)
        }
        const result = await ui(mode, { kind: 'search', op, ...(query !== undefined ? { query } : {}) })
        deps.log('terminal_search', `${op}${query !== undefined ? ` ${query}` : ''}`)
        return result
      }
    },
    {
      name: 'switch_tab',
      description: 'The tab bar: next / previous tab (like Ctrl+Tab), close_others (close every tab but the one on screen) or close_all. Closing a tab closes its session (it can be reopened). To show a given session use open_session.',
      inputSchema: schema({ op: { type: 'string', enum: ['next', 'previous', 'close_others', 'close_all'] }, mode: MODE_PROP }, ['op']),
      run: async (args) => {
        const raw = text(args, 'op')
        const ops: Readonly<Record<string, 'next' | 'previous' | 'closeOthers' | 'closeAll'>> = { next: 'next', previous: 'previous', close_others: 'closeOthers', close_all: 'closeAll' }
        const op = ops[raw]
        if (op === undefined) throw new Error('"op" must be next, previous, close_others or close_all.')
        const result = await ui(optionalMode(args), { kind: 'tabs', op })
        deps.log('switch_tab', raw)
        return result
      }
    },
    {
      name: 'attach_files',
      description: `Gives files to a session like dropping them on its terminal: their full paths are pasted into the prompt (Claude turns image paths into image attachments) without pressing Enter; send_prompt then adds the words and sends. With image_via_clipboard (one image) the image goes through the clipboard instead, as Ctrl+V / Alt+V would do (OpenCode needs this for images; it replaces what the user had copied). Up to ${ATTACH_MAX} files.`,
      inputSchema: schema({
        session: SESSION_PROP,
        paths: { type: 'array', items: { type: 'string' }, description: 'Full paths of files or folders.' },
        image_via_clipboard: { type: 'boolean' }
      }, ['session', 'paths']),
      run: async (args) => {
        const session = liveSession(args.session)
        const state = deps.getRuntime(session.id)
        if (state?.run !== 'running' || state.sleeping === true) throw new Error(`"${session.name}" is not running; wake it first (wake_session).`)
        if (!Array.isArray(args.paths) || args.paths.length === 0 || !args.paths.every((p) => typeof p === 'string' && p.trim().length > 0)) {
          throw new Error('"paths" must be a list of full paths.')
        }
        const paths = (args.paths as string[]).map((p) => p.trim())
        if (paths.length > ATTACH_MAX) throw new Error(`At most ${ATTACH_MAX} files at once.`)
        for (const p of paths) {
          if (!/^[a-zA-Z]:[\\/]|^\//.test(p)) throw new Error(`"${p}" is not a full path.`)
          if ((await control.pathKind(p)) === null) throw new Error(`Nothing at ${p}.`)
        }
        if (optionalBool(args, 'image_via_clipboard') === true) {
          if (paths.length !== 1 || !IMAGE_EXTENSIONS.test(paths[0])) throw new Error('image_via_clipboard takes exactly one image file (png, jpg, gif, webp, bmp).')
          if (!control.copyImage(paths[0])) throw new Error(`Could not read ${paths[0]} as an image.`)
          deps.controller.writeToPty(session.id, session.agent === 'opencode' ? '\x16' : '\x1bv')
          deps.log('attach_files', `${session.name}: image ${paths[0]}`)
          return `Pasted the image into "${session.name}" (not sent yet).`
        }
        const typed = formatAttachPaths(paths)
        const bracketed = session.agent !== 'shell' && bracketedPasteOn(deps.rawOutput(session.id))
        deps.controller.writeToPty(session.id, bracketed ? `${PASTE_START}${typed}${PASTE_END}` : typed)
        deps.log('attach_files', `${session.name}: ${paths.length} file(s)`)
        return `Attached ${paths.length} file(s) to "${session.name}" (in its prompt, not sent yet).`
      }
    },
    {
      name: 'open_link',
      description: 'Opens a link printed in a session\'s terminal, like clicking it: a web address in the browser, a file in its default app, a folder in Explorer (reveal: show the file selected in its folder instead). Relative paths resolve against the session\'s folder. Programs and scripts are never run.',
      inputSchema: schema({ session: SESSION_PROP, link: { type: 'string', description: 'The URL or path as printed.' }, reveal: { type: 'boolean' } }, ['session', 'link']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        const link = text(args, 'link')
        const result = await control.openLink(session.id, link, optionalBool(args, 'reveal') === true)
        deps.log('open_link', `${session.name}: ${link}`)
        if (!result.ok) throw new Error(result.error ?? 'That link could not be opened.')
        if (result.revealed === true) return `Showed ${link} selected in its folder (programs and scripts are never run).`
        return `Opened ${link}${result.kind !== undefined ? ` (${result.kind})` : ''}.`
      }
    },
    {
      name: 'app_window',
      description: 'The SessionDeck app itself: show (bring the window to the front), hide (to the tray; sessions keep running), start_on_login / no_start_on_login (start SessionDeck when Windows starts; installed app only), login_status, or quit (asks the user first; sessions that are running start again on the next launch when Settings > General "resume" is on).',
      inputSchema: schema({ action: { type: 'string', enum: ['show', 'hide', 'start_on_login', 'no_start_on_login', 'login_status', 'quit'] } }, ['action']),
      run: async (args) => {
        const action = text(args, 'action')
        switch (action) {
          case 'show':
            control.showWindow()
            deps.log('app_window', 'show')
            return 'The window is in front.'
          case 'hide':
            control.hideWindow()
            deps.log('app_window', 'hide')
            return 'The window is hidden in the tray; sessions keep running.'
          case 'login_status': {
            const state = control.loginItem.get()
            return state.supported ? `Start on login is ${state.openAtLogin ? 'on' : 'off'}.` : 'Start on login works in the installed app only.'
          }
          case 'start_on_login':
          case 'no_start_on_login': {
            const before = control.loginItem.get()
            if (!before.supported) throw new Error('Start on login works in the installed app only (this is a development run).')
            const state = control.loginItem.set(action === 'start_on_login')
            ctx.pushUndo(`start on login ${state.openAtLogin ? 'on' : 'off'}`, () => { control.loginItem.set(before.openAtLogin) })
            deps.log('app_window', action)
            return `Start on login is ${state.openAtLogin ? 'on' : 'off'}.`
          }
          case 'quit': {
            const yes = await deps.confirm({ title: 'Quit SessionDeck?', message: 'Jarvis wants to quit SessionDeck. Every session stops (including Jarvis).', confirmLabel: 'Quit' })
            if (!yes) return 'The user said no; SessionDeck keeps running.'
            deps.log('app_window', 'quit')
            // Answer first: quitting stops this server too.
            setTimeout(() => control.quit(), 1500)
            return 'Quitting SessionDeck in a moment.'
          }
          default:
            throw new Error('"action" must be show, hide, start_on_login, no_start_on_login, login_status or quit.')
        }
      }
    }
  ]
}
