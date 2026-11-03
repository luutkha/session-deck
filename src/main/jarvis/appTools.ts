// Jarvis tools that reach the rest of the app (D55): settings, prompt queue, checklist, groups and statuses, presets,
// bulk actions, attention, usage and the quota autopilot, the cost report, Code mode (repos, diffs, review comments),
// worker tabs and the Code window. Same rules as jarvisTools.ts: every tool calls the path the UI calls, removals ask
// the user first, reversible actions record an undo step, every action is logged.
import type {
  AppSettings,
  ChecklistItem,
  FileDiff,
  Id,
  QueuedPrompt,
  QuotaAutopilotState,
  Session,
  SessionPreset,
  StatusDef,
  UsageRefreshResult,
  WindowState,
  WorkerInfo
} from '../../shared/types'
import { QUEUE_MAX_ITEMS, QUEUE_TEXT_MAX } from '../../shared/types'
import { formatReviewMessage, type ReviewComment } from '../../shared/reviewComments'
import type { McpTool } from './mcpProtocol'
import { resolveGroup, resolveRepo, resolveSession, resolveStatus, resolveWorktree, targetSessions } from './targets'
import { clip, optionalBool, optionalInt, optionalText, schema, SESSION_PROP, text } from './toolArgs'
import type { JarvisToolDeps } from './jarvisTools'

const DIFF_DEFAULT_CHARS = 20_000
const DIFF_MAX_CHARS = 100_000
const BULK_MAX = 100
const COST_DAYS_DEFAULT = 7
const COST_DAYS_MAX = 90
const COMMENTS_MAX = 50
const SETTINGS_SECTIONS = ['autoStatus', 'tray', 'quota', 'sleep', 'agents', 'hub', 'launch', 'away', 'reminder', 'code', 'jarvis'] as const

/** What the app tools need besides JarvisToolDeps. Wired in index.ts with the same functions the IPC handlers use. */
export interface JarvisAppDeps {
  readonly getSettings: () => AppSettings
  /** Validates the patch exactly like the Settings dialog's IPC, then saves it. */
  readonly updateSettings: (rawPatch: unknown) => AppSettings
  /** Validates and saves a checklist (like the notes panel's IPC). */
  readonly setChecklist: (id: Id, rawItems: unknown) => void
  readonly sendQueuedNow: (id: Id, promptId: string) => void
  readonly renameGroup: (id: Id, name: string) => void
  readonly setGroupCollapsed: (id: Id, collapsed: boolean) => void
  readonly reorderGroups: (order: readonly Id[]) => void
  /** Validates (name, colour) and adds or replaces a status. */
  readonly upsertStatus: (raw: unknown) => void
  readonly removeStatus: (id: Id) => void
  readonly reorderStatuses: (order: readonly Id[]) => void
  /** Validates and saves a preset (same checks as the New Session dialog's IPC). */
  readonly savePreset: (raw: unknown) => void
  readonly removePreset: (id: Id) => void
  readonly clearAttention: (id: Id) => void
  readonly markUnread: (id: Id) => void
  readonly refreshUsage: () => Promise<UsageRefreshResult>
  readonly autopilot: {
    state(): Promise<QuotaAutopilotState>
    sleepIdle(): Promise<readonly Id[]>
    wake(sendContinue: boolean): Promise<readonly Id[]>
  }
  readonly removeRepo: (id: Id) => void
  readonly fileDiff: (worktreeId: Id, path: string) => Promise<FileDiff>
  readonly workers: () => readonly WorkerInfo[]
  readonly windowState: () => WindowState
  readonly popOutCode: () => void
  readonly dockCode: () => void
}

/** What createJarvisTools shares with the extra tool files. */
export interface ToolContext {
  readonly pushUndo: (label: string, run: () => void | Promise<void>) => void
  readonly sendPrompt: (session: Session, prompt: string, when: 'auto' | 'now' | 'queue') => Promise<string>
  /** Another tool by name (bulk actions reuse the single-session tools). */
  readonly tool: (name: string) => McpTool
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function nameOf(sessions: readonly Session[], id: Id): string {
  return sessions.find((s) => s.id === id)?.name ?? id
}

/** Local calendar day "YYYY-MM-DD" of an epoch ms. */
function dayOf(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "1", "2"... (position, 1-based) or text that matches one item. */
function pickIndex<T>(items: readonly T[], ref: unknown, label: (item: T) => string, kind: string): number {
  if (typeof ref === 'number' && Number.isInteger(ref)) {
    if (ref < 1 || ref > items.length) throw new Error(`There is no ${kind} number ${ref} (there are ${items.length}).`)
    return ref - 1
  }
  if (typeof ref !== 'string' || ref.trim().length === 0) throw new Error(`Say which ${kind} (its number or text).`)
  if (/^\d+$/.test(ref.trim())) return pickIndex(items, Number(ref.trim()), label, kind)
  const want = ref.trim().toLowerCase()
  const exact = items.map((item, i) => [item, i] as const).filter(([item]) => label(item).toLowerCase() === want)
  if (exact.length === 1) return exact[0][1]
  const partial = items.map((item, i) => [item, i] as const).filter(([item]) => label(item).toLowerCase().includes(want))
  if (partial.length === 1) return partial[0][1]
  if (partial.length === 0) throw new Error(`No ${kind} matches "${ref}".`)
  throw new Error(`"${ref}" matches ${partial.length} ${kind}s; use its number.`)
}

/** The previous values of exactly the fields a patch touches (to undo a settings change). */
export function settingsUndoPatch(before: AppSettings, patch: Readonly<Record<string, unknown>>): Record<string, Record<string, unknown>> {
  const undo: Record<string, Record<string, unknown>> = {}
  for (const [section, fields] of Object.entries(patch)) {
    if (typeof fields !== 'object' || fields === null) continue
    const old = (before as unknown as Record<string, Record<string, unknown>>)[section]
    if (old === undefined) continue
    undo[section] = {}
    for (const key of Object.keys(fields)) undo[section][key] = old[key]
  }
  return undo
}

export function createAppTools(deps: JarvisToolDeps, ctx: ToolContext): McpTool[] {
  const app = deps.app
  const { pushUndo } = ctx

  function setQueue(session: Session, items: readonly QueuedPrompt[]): void {
    deps.store.setSessionQueue(session.id, items)
    deps.queueChanged(session.id)
  }

  /** The sessions a bulk action or selection means. */
  function selectSessions(args: Readonly<Record<string, unknown>>): readonly Session[] {
    const data = deps.getData()
    let picked: readonly Session[]
    if (Array.isArray(args.sessions) && args.sessions.length > 0) {
      picked = args.sessions.map((ref) => resolveSession(data, ref))
    } else {
      const which = optionalText(args, 'which') ?? (args.group !== undefined || args.status !== undefined ? 'open' : undefined)
      if (which === undefined) throw new Error('Say which sessions: "sessions" (names), "group", "status" or "which".')
      picked = targetSessions(data).filter((s) => {
        const state = deps.getRuntime(s.id)
        const closed = s.closedAt !== undefined
        switch (which) {
          case 'all': case 'open': return !closed
          case 'closed': return closed
          case 'running': return !closed && state?.run === 'running' && state.sleeping !== true
          case 'sleeping': return !closed && state?.sleeping === true
          case 'stopped': return !closed && state?.sleeping !== true && state?.run !== 'running'
          case 'needs_you': return !closed && (state?.attention ?? null) !== null
          default: throw new Error('"which" must be all, open, running, sleeping, stopped, needs_you or closed.')
        }
      })
    }
    const groupRef = optionalText(args, 'group')
    if (groupRef !== undefined) {
      const group = resolveGroup(data, groupRef)
      picked = picked.filter((s) => s.groupId === group.id)
    }
    const statusRef = optionalText(args, 'status')
    if (statusRef !== undefined) {
      const status = resolveStatus(data, statusRef)
      picked = picked.filter((s) => s.statusId === status.id)
    }
    return picked
  }

  const SELECT_PROPS = {
    sessions: { type: 'array', items: { type: 'string' }, description: 'Session names or ids. Or use which/group/status.' },
    which: { type: 'string', enum: ['all', 'open', 'running', 'sleeping', 'stopped', 'needs_you', 'closed'], description: 'all/open = every session not closed.' },
    group: { type: 'string', description: 'Only sessions in this group.' },
    status: { type: 'string', description: 'Only sessions with this status.' }
  }

  return [
    // ---------- settings
    {
      name: 'get_settings',
      description: `Reads SessionDeck's settings (everything in the Settings dialog) as JSON. Sections: ${SETTINGS_SECTIONS.join(', ')}. Read before update_settings to see field names and current values.`,
      inputSchema: schema({ section: { type: 'string', enum: [...SETTINGS_SECTIONS] } }),
      run: async (args) => {
        const settings = app.getSettings()
        const section = optionalText(args, 'section')
        if (section === undefined) return json(settings)
        const value = (settings as unknown as Record<string, unknown>)[section]
        if (value === undefined) throw new Error(`No settings section "${section}". Sections: ${SETTINGS_SECTIONS.join(', ')}.`)
        return json(value)
      }
    },
    {
      name: 'update_settings',
      description: 'Changes settings, exactly like the Settings dialog (same checks). Give only what changes, by section, e.g. {"sleep": {"idleMinutes": 30}} or {"tray": {"closeToTray": false}}. Call get_settings first for the field names. Changing jarvis.agent or jarvis.opencodeModel starts a NEW Jarvis conversation (you lose this one): ask the user first.',
      inputSchema: schema({ changes: { type: 'object', description: 'Section -> fields to change.' } }, ['changes']),
      run: async (args) => {
        const changes = args.changes
        if (typeof changes !== 'object' || changes === null || Array.isArray(changes)) throw new Error('"changes" must be an object of sections, like {"sleep": {"idleMinutes": 30}}.')
        const before = app.getSettings()
        const after = app.updateSettings(changes)
        const undo = settingsUndoPatch(before, changes as Record<string, unknown>)
        pushUndo(`change settings ${Object.keys(undo).join(', ')} (put the old values back)`, () => {
          app.updateSettings(undo)
        })
        deps.log('update_settings', clip(JSON.stringify(changes), 200))
        const shown: Record<string, unknown> = {}
        for (const section of Object.keys(changes)) shown[section] = (after as unknown as Record<string, unknown>)[section]
        return `Settings saved. Now:\n${json(shown)}`
      }
    },

    // ---------- prompt queue (D47)
    {
      name: 'queue_list',
      description: "Lists a session's queued prompts (typed one by one when its turn finishes), numbered from 1.",
      inputSchema: schema({ session: SESSION_PROP }, ['session']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        const queue = session.queue ?? []
        if (queue.length === 0) return `"${session.name}" has no queued prompts.`
        return `"${session.name}" queue:\n${queue.map((q, i) => `${i + 1}. ${clip(q.text, 200)}`).join('\n')}`
      }
    },
    {
      name: 'queue_change',
      description: "Changes a session's prompt queue: add (text, optional position), remove (item), move (item, to), clear, or send_now (types that item now, if the session is idle). Items are numbers from queue_list or part of their text.",
      inputSchema: schema({
        session: SESSION_PROP,
        action: { type: 'string', enum: ['add', 'remove', 'move', 'clear', 'send_now'] },
        text: { type: 'string' },
        item: { type: ['string', 'integer'] },
        position: { type: 'integer', description: 'add: where (1 = first). Default last.' },
        to: { type: 'integer', description: 'move: new position (1 = first).' }
      }, ['session', 'action']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        const queue = [...(session.queue ?? [])]
        const label = (q: QueuedPrompt): string => q.text
        const action = text(args, 'action')
        const restore = (): void => {
          const now = deps.getData().sessions.find((s) => s.id === session.id)
          if (now !== undefined) setQueue(now, session.queue ?? [])
        }
        let result: string
        switch (action) {
          case 'add': {
            const prompt = text(args, 'text').trim()
            if (prompt.length > QUEUE_TEXT_MAX) throw new Error(`A queued prompt is at most ${QUEUE_TEXT_MAX} characters.`)
            if (queue.length >= QUEUE_MAX_ITEMS) throw new Error(`The queue is full (${QUEUE_MAX_ITEMS} prompts).`)
            const at = Math.min(Math.max(optionalInt(args, 'position', queue.length + 1, QUEUE_MAX_ITEMS) - 1, 0), queue.length)
            queue.splice(at, 0, { id: deps.newId(), text: prompt, addedAt: deps.now() })
            setQueue(session, queue)
            result = `Queued as number ${at + 1} for "${session.name}".`
            break
          }
          case 'remove': {
            const i = pickIndex(queue, args.item, label, 'queued prompt')
            const [gone] = queue.splice(i, 1)
            setQueue(session, queue)
            result = `Removed "${clip(gone.text, 60)}" from the queue of "${session.name}".`
            break
          }
          case 'move': {
            const i = pickIndex(queue, args.item, label, 'queued prompt')
            const to = Math.min(optionalInt(args, 'to', 1, QUEUE_MAX_ITEMS), queue.length) - 1
            const [item] = queue.splice(i, 1)
            queue.splice(to, 0, item)
            setQueue(session, queue)
            result = `Moved "${clip(item.text, 60)}" to number ${to + 1}.`
            break
          }
          case 'clear':
            if (queue.length === 0) return `"${session.name}" has no queued prompts.`
            setQueue(session, [])
            result = `Cleared ${queue.length} queued prompt(s) of "${session.name}".`
            break
          case 'send_now': {
            const i = pickIndex(queue, args.item ?? 1, label, 'queued prompt')
            app.sendQueuedNow(session.id, queue[i].id)
            deps.log('queue_change', `${session.name}: send_now`)
            return `Typed "${clip(queue[i].text, 60)}" into "${session.name}" now.`
          }
          default:
            throw new Error('"action" must be add, remove, move, clear or send_now.')
        }
        pushUndo(`change the queue of "${session.name}" (restore it)`, restore)
        deps.log('queue_change', `${session.name}: ${action}`)
        return result
      }
    },

    // ---------- checklist (NTS-2)
    {
      name: 'checklist_get',
      description: "Shows a session's checklist (the steps in its Notes panel), numbered, with [x] for done.",
      inputSchema: schema({ session: SESSION_PROP }, ['session']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        const items = session.checklist ?? []
        if (items.length === 0) return `"${session.name}" has no checklist.`
        const done = items.filter((i) => i.done).length
        return `"${session.name}" checklist (${done}/${items.length} done):\n${items.map((c, i) => `${i + 1}. [${c.done ? 'x' : ' '}] ${c.text}`).join('\n')}`
      }
    },
    {
      name: 'checklist_change',
      description: "Changes a session's checklist: add (items: list of texts), check / uncheck / remove (item: number or text), or clear.",
      inputSchema: schema({
        session: SESSION_PROP,
        action: { type: 'string', enum: ['add', 'check', 'uncheck', 'remove', 'clear'] },
        items: { type: 'array', items: { type: 'string' } },
        item: { type: ['string', 'integer'] }
      }, ['session', 'action']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        const before = session.checklist ?? []
        let next: ChecklistItem[] = [...before]
        const action = text(args, 'action')
        let result: string
        switch (action) {
          case 'add': {
            const texts = (Array.isArray(args.items) ? args.items : []).map((t) => (typeof t === 'string' ? t.trim() : '')).filter((t) => t.length > 0)
            if (texts.length === 0) throw new Error('Give "items": the steps to add.')
            const base = deps.newId().replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)
            next = [...next, ...texts.map((t, i) => ({ id: `j${base}${i}`, text: t, done: false }))]
            result = `Added ${texts.length} step(s) to "${session.name}".`
            break
          }
          case 'check': case 'uncheck': {
            const i = pickIndex(next, args.item, (c) => c.text, 'checklist item')
            next[i] = { ...next[i], done: action === 'check' }
            result = `${action === 'check' ? 'Checked' : 'Unchecked'} "${clip(next[i].text, 60)}".`
            break
          }
          case 'remove': {
            const i = pickIndex(next, args.item, (c) => c.text, 'checklist item')
            const [gone] = next.splice(i, 1)
            result = `Removed "${clip(gone.text, 60)}".`
            break
          }
          case 'clear':
            next = []
            result = `Cleared the checklist of "${session.name}".`
            break
          default:
            throw new Error('"action" must be add, check, uncheck, remove or clear.')
        }
        app.setChecklist(session.id, next)
        pushUndo(`change the checklist of "${session.name}" (restore it)`, () => app.setChecklist(session.id, before))
        deps.log('checklist_change', `${session.name}: ${action}`)
        return result
      }
    },

    // ---------- groups (SES-4)
    {
      name: 'group_change',
      description: 'Changes sidebar groups: rename (group, name), collapse / expand (group), or reorder (order: group names top to bottom; groups left out keep their order after them).',
      inputSchema: schema({
        action: { type: 'string', enum: ['rename', 'collapse', 'expand', 'reorder'] },
        group: { type: 'string' },
        name: { type: 'string' },
        order: { type: 'array', items: { type: 'string' } }
      }, ['action']),
      run: async (args) => {
        const data = deps.getData()
        const action = text(args, 'action')
        if (action === 'reorder') {
          const named = (Array.isArray(args.order) ? args.order : []).map((ref) => resolveGroup(data, String(ref)).id)
          if (named.length === 0) throw new Error('Give "order": group names, top to bottom.')
          const before = [...data.groupOrder]
          const order = [...new Set(named), ...before.filter((id) => !named.includes(id))]
          app.reorderGroups(order)
          pushUndo('reorder groups (put the old order back)', () => app.reorderGroups(before))
          deps.log('group_change', 'reorder')
          return `Groups are now: ${order.map((id) => data.groups.find((g) => g.id === id)?.name ?? id).join(', ')}.`
        }
        const group = resolveGroup(data, text(args, 'group'))
        if (action === 'rename') {
          const name = text(args, 'name').trim()
          app.renameGroup(group.id, name)
          pushUndo(`rename group "${group.name}" to "${name}" (name it back)`, () => app.renameGroup(group.id, group.name))
          deps.log('group_change', `rename ${group.name} -> ${name}`)
          return `Group "${group.name}" is now "${name}".`
        }
        if (action === 'collapse' || action === 'expand') {
          const collapsed = action === 'collapse'
          app.setGroupCollapsed(group.id, collapsed)
          pushUndo(`${action} group "${group.name}" (switch it back)`, () => app.setGroupCollapsed(group.id, group.collapsed))
          deps.log('group_change', `${action} ${group.name}`)
          return `Group "${group.name}" is ${collapsed ? 'collapsed' : 'expanded'}.`
        }
        throw new Error('"action" must be rename, collapse, expand or reorder.')
      }
    },

    // ---------- statuses (Settings > Statuses)
    {
      name: 'status_change',
      description: 'Changes the statuses sessions can have (the Hub columns): create (name, color), update (status, name and/or color), reorder (order: status names), or remove (status; the user is asked; its sessions get no status). Colors are hex like "#4caf50".',
      inputSchema: schema({
        action: { type: 'string', enum: ['create', 'update', 'reorder', 'remove'] },
        status: { type: 'string' },
        name: { type: 'string' },
        color: { type: 'string' },
        order: { type: 'array', items: { type: 'string' } }
      }, ['action']),
      run: async (args) => {
        const data = deps.getData()
        const action = text(args, 'action')
        switch (action) {
          case 'create': {
            const def: StatusDef = { id: deps.newId(), name: text(args, 'name').trim(), color: optionalText(args, 'color')?.trim() ?? '#64748b' }
            app.upsertStatus(def)
            pushUndo(`create status "${def.name}" (delete it)`, () => app.removeStatus(def.id))
            deps.log('status_change', `create ${def.name}`)
            return `Created status "${def.name}" (${def.color}).`
          }
          case 'update': {
            const old = resolveStatus(data, text(args, 'status'))
            const def: StatusDef = { id: old.id, name: optionalText(args, 'name')?.trim() ?? old.name, color: optionalText(args, 'color')?.trim() ?? old.color }
            app.upsertStatus(def)
            pushUndo(`change status "${old.name}" (put it back)`, () => app.upsertStatus(old))
            deps.log('status_change', `update ${old.name}`)
            return `Status "${old.name}" is now "${def.name}" (${def.color}).`
          }
          case 'reorder': {
            const named = (Array.isArray(args.order) ? args.order : []).map((ref) => resolveStatus(data, String(ref)).id)
            if (named.length === 0) throw new Error('Give "order": status names, first to last.')
            const before = data.statuses.map((s) => s.id)
            const order = [...new Set(named), ...before.filter((id) => !named.includes(id))]
            app.reorderStatuses(order)
            pushUndo('reorder statuses (put the old order back)', () => app.reorderStatuses(before))
            deps.log('status_change', 'reorder')
            return `Statuses are now: ${order.map((id) => data.statuses.find((s) => s.id === id)?.name ?? id).join(', ')}.`
          }
          case 'remove': {
            const status = resolveStatus(data, text(args, 'status'))
            const count = data.sessions.filter((s) => s.statusId === status.id).length
            const yes = await deps.confirm({ title: 'Jarvis: delete status', message: `Jarvis wants to delete status “${status.name}”. ${count} session(s) will have no status.`, confirmLabel: 'Delete' })
            if (!yes) return `The user did not allow deleting status "${status.name}". Nothing was changed.`
            app.removeStatus(status.id)
            deps.log('status_change', `remove ${status.name}`)
            return `Status "${status.name}" was deleted.`
          }
          default:
            throw new Error('"action" must be create, update, reorder or remove.')
        }
      }
    },

    // ---------- presets (D49)
    {
      name: 'preset_change',
      description: 'Saved New Session forms ("presets"): list, save (name, folder, agent, optional model for OpenCode, remote_control for Claude, group, status; a preset with the same name is replaced), or remove (name; the user is asked). Start one with create_session preset=<name>.',
      inputSchema: schema({
        action: { type: 'string', enum: ['list', 'save', 'remove'] },
        name: { type: 'string' },
        folder: { type: 'string' },
        agent: { type: 'string', enum: ['claude', 'opencode', 'shell'] },
        model: { type: 'string' },
        remote_control: { type: 'boolean' },
        group: { type: 'string' },
        status: { type: 'string' }
      }, ['action']),
      run: async (args) => {
        const data = deps.getData()
        const presets = data.presets ?? []
        const action = text(args, 'action')
        const findPreset = (name: string): SessionPreset | undefined => presets.find((p) => p.name.toLowerCase() === name.trim().toLowerCase() || p.id === name.trim())
        if (action === 'list') {
          if (presets.length === 0) return 'No presets saved.'
          return presets.map((p) => {
            const group = data.groups.find((g) => g.id === p.groupId)?.name
            const status = data.statuses.find((s) => s.id === p.statusId)?.name
            return `- "${p.name}": ${p.agent}${p.model ? ` ${p.model}` : ''} in ${p.cwd}${p.claudeArgs.includes('--remote-control') ? ', remote control' : ''}${group ? `, group ${group}` : ''}${status ? `, status ${status}` : ''}`
          }).join('\n')
        }
        const name = text(args, 'name').trim()
        const existing = findPreset(name)
        if (action === 'remove') {
          if (existing === undefined) throw new Error(`No preset named "${name}".`)
          const yes = await deps.confirm({ title: 'Jarvis: delete preset', message: `Jarvis wants to delete the preset “${existing.name}”.`, confirmLabel: 'Delete' })
          if (!yes) return `The user did not allow deleting preset "${existing.name}". Nothing was changed.`
          app.removePreset(existing.id)
          deps.log('preset_change', `remove ${existing.name}`)
          return `Preset "${existing.name}" was deleted.`
        }
        if (action !== 'save') throw new Error('"action" must be list, save or remove.')
        const agent = optionalText(args, 'agent') ?? existing?.agent ?? 'claude'
        const groupRef = optionalText(args, 'group')
        const statusRef = optionalText(args, 'status')
        const remote = optionalBool(args, 'remote_control') ?? existing?.claudeArgs.includes('--remote-control') ?? false
        const model = optionalText(args, 'model') ?? (agent === existing?.agent ? existing?.model : undefined)
        const raw = {
          id: existing?.id ?? deps.newId(),
          name,
          cwd: optionalText(args, 'folder')?.trim() ?? existing?.cwd ?? (() => { throw new Error('"folder" is required for a new preset.') })(),
          agent,
          ...(agent === 'opencode' && model !== undefined ? { model } : {}),
          claudeArgs: agent === 'claude' && remote ? ['--remote-control'] : [],
          groupId: groupRef !== undefined ? resolveGroup(data, groupRef).id : existing?.groupId ?? null,
          statusId: statusRef !== undefined ? resolveStatus(data, statusRef).id : existing?.statusId ?? null
        }
        app.savePreset(raw)
        if (existing === undefined) pushUndo(`save preset "${name}" (delete it)`, () => app.removePreset(raw.id))
        else pushUndo(`change preset "${name}" (put it back)`, () => app.savePreset(existing))
        deps.log('preset_change', `save ${name}`)
        return `${existing === undefined ? 'Saved' : 'Updated'} preset "${name}" (${agent} in ${raw.cwd}).`
      }
    },

    // ---------- bulk (NAV-11)
    {
      name: 'bulk_action',
      description: 'Does one action on many sessions at once: sleep, wake, close, set_status (value = status name or null), move_to_group (value = group name or null), keep_awake (value true/false), mark_read, mark_unread. Choose the sessions by names, or by which (all/running/sleeping/stopped/needs_you/closed), optionally narrowed by group and status. Each session is reported.',
      inputSchema: schema({
        action: { type: 'string', enum: ['sleep', 'wake', 'close', 'set_status', 'move_to_group', 'keep_awake', 'mark_read', 'mark_unread'] },
        value: { type: ['string', 'boolean', 'null'] },
        ...SELECT_PROPS
      }, ['action']),
      run: async (args) => {
        const action = text(args, 'action')
        const plan: Readonly<Record<string, readonly [string, (id: Id) => Record<string, unknown>]>> = {
          sleep: ['sleep_session', (id) => ({ session: id })],
          wake: ['wake_session', (id) => ({ session: id })],
          close: ['close_session', (id) => ({ session: id })],
          set_status: ['set_status', (id) => ({ session: id, status: args.value ?? null })],
          move_to_group: ['move_to_group', (id) => ({ session: id, group: args.value ?? null })],
          keep_awake: ['set_keep_awake', (id) => ({ session: id, keep_awake: args.value === true || args.value === 'true' })],
          mark_read: ['set_read', (id) => ({ session: id, read: true })],
          mark_unread: ['set_read', (id) => ({ session: id, read: false })]
        }
        const step = plan[action]
        if (step === undefined) throw new Error('Unknown "action".')
        const targets = selectSessions(args)
        if (targets.length === 0) return 'No sessions match; nothing was done.'
        if (targets.length > BULK_MAX) throw new Error(`That is ${targets.length} sessions; at most ${BULK_MAX} at once.`)
        const tool = ctx.tool(step[0])
        const lines: string[] = []
        for (const s of targets) {
          try {
            lines.push(`- ${await tool.run(step[1](s.id))}`)
          } catch (error) {
            lines.push(`- "${s.name}": FAILED: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        deps.log('bulk_action', `${action} on ${targets.length} session(s)`)
        return `${action} on ${targets.length} session(s):\n${lines.join('\n')}`
      }
    },

    // ---------- attention (ATT-2/4)
    {
      name: 'needs_you',
      description: 'Lists the sessions that need the user right now (the bell / "Needs you" list): waiting for permission or an answer, finished, bell, or marked unread, with the question when there is one.',
      inputSchema: schema({}),
      run: async () => {
        const data = deps.getData()
        const lines = targetSessions(data).flatMap((s) => {
          const state = deps.getRuntime(s.id)
          if (state?.attention === null || state?.attention === undefined) return []
          const reason = { permission: 'waiting for permission or an answer', idle: 'idle, waiting for input', done: 'finished its turn', bell: 'rang the bell', unread: 'marked unread' }[state.attention]
          return [`- "${s.name}": ${reason}${state.activityMessage ? ` ("${clip(state.activityMessage, 160)}")` : ''}`]
        })
        return lines.length === 0 ? 'Nothing needs the user right now.' : lines.join('\n')
      }
    },
    {
      name: 'set_read',
      description: 'Marks a session read (clears its bell, like opening it) or unread (flags it for the user, silently).',
      inputSchema: schema({ session: SESSION_PROP, read: { type: 'boolean' } }, ['session', 'read']),
      run: async (args) => {
        const session = resolveSession(deps.getData(), args.session)
        const read = optionalBool(args, 'read')
        if (read === undefined) throw new Error('"read" is required.')
        if (read) app.clearAttention(session.id)
        else app.markUnread(session.id)
        deps.log('set_read', `${session.name}: ${read}`)
        return `"${session.name}" is marked ${read ? 'read' : 'unread'}.`
      }
    },

    // ---------- usage and quota (USE-4, USE-7/8)
    {
      name: 'refresh_usage',
      description: "Refreshes the plan usage now (like the refresh button on the usage bar), then shows it. Works only after the user allowed manual refresh once in the usage bar.",
      inputSchema: schema({}),
      run: async () => {
        const result = await app.refreshUsage()
        deps.log('refresh_usage', result.ok ? 'ok' : result.error.kind)
        if (!result.ok) throw new Error(`Usage could not be refreshed: ${result.error.message}`)
        return `Refreshed.\n${await ctx.tool('get_usage').run({})}`
      }
    },
    {
      name: 'quota_autopilot',
      description: 'The quota autopilot (plan limit): status (sessions put to sleep for the quota, sessions cut off by the limit, when the 5-hour window resets), sleep_idle (put idle sessions to sleep now to save quota), wake_held (wake the sessions held for the quota; send_continue types "continue" into the one the limit cut off).',
      inputSchema: schema({ action: { type: 'string', enum: ['status', 'sleep_idle', 'wake_held'] }, send_continue: { type: 'boolean' } }, ['action']),
      run: async (args) => {
        const sessions = deps.getData().sessions
        const names = (ids: readonly Id[]): string => ids.map((id) => `"${nameOf(sessions, id)}"`).join(', ') || '(none)'
        const action = text(args, 'action')
        if (action === 'status') {
          const state = await app.autopilot.state()
          const reset = state.resetsAt === null ? 'unknown' : new Date(state.resetsAt * 1000).toLocaleString()
          return `Held for the quota (asleep): ${names(state.sleptForQuota)}\nCut off by the limit: ${names(state.stoppedAtLimit)}\n5-hour window resets: ${reset}`
        }
        if (action === 'sleep_idle') {
          const slept = await app.autopilot.sleepIdle()
          if (slept.length > 0) pushUndo(`sleep ${slept.length} idle session(s) for the quota (wake them)`, async () => { await app.autopilot.wake(false) })
          deps.log('quota_autopilot', `sleep_idle: ${slept.length}`)
          return slept.length === 0 ? 'No idle session to put to sleep.' : `Put to sleep: ${names(slept)}.`
        }
        if (action === 'wake_held') {
          const woke = await app.autopilot.wake(optionalBool(args, 'send_continue') ?? true)
          deps.log('quota_autopilot', `wake_held: ${woke.length}`)
          return woke.length === 0 ? 'No session was held for the quota.' : `Woke: ${names(woke)}.`
        }
        throw new Error('"action" must be status, sleep_idle or wake_held.')
      }
    },
    {
      name: 'cost_report',
      description: 'Cost over time (like the Costs dialog): spending per day for the last N days (default 7) and the sessions that cost the most in that time. Only turns with a known cost count.',
      inputSchema: schema({ days: { type: 'integer', description: `Default ${COST_DAYS_DEFAULT}, max ${COST_DAYS_MAX}.` } }),
      run: async (args) => {
        const days = optionalInt(args, 'days', COST_DAYS_DEFAULT, COST_DAYS_MAX)
        const now = deps.now()
        const start = new Date(now)
        start.setHours(0, 0, 0, 0)
        const since = start.getTime() - (days - 1) * 86_400_000
        const byDay = new Map<string, number>()
        const bySession = new Map<Id, number>()
        let total = 0
        for (const turn of deps.allTurns()) {
          const at = turn.endedAt ?? turn.startedAt
          if (turn.costUsd === null || at < since) continue
          byDay.set(dayOf(at), (byDay.get(dayOf(at)) ?? 0) + turn.costUsd)
          bySession.set(turn.sessionId, (bySession.get(turn.sessionId) ?? 0) + turn.costUsd)
          total += turn.costUsd
        }
        const sessions = deps.getData().sessions
        const dayLines: string[] = []
        for (let i = days - 1; i >= 0; i -= 1) {
          const key = dayOf(start.getTime() - i * 86_400_000)
          dayLines.push(`${key}: $${(byDay.get(key) ?? 0).toFixed(2)}`)
        }
        const top = [...bySession.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
          .map(([id, cost]) => `- "${nameOf(sessions, id)}": $${cost.toFixed(2)}`)
        return `Last ${days} day(s): $${total.toFixed(2)} in total.\n${dayLines.join('\n')}\nMost expensive sessions:\n${top.join('\n') || '(no known costs)'}`
      }
    },

    // ---------- Code mode extras (COD-3, COD-8, D34)
    {
      name: 'remove_repo',
      description: 'Code mode: removes a repository from SessionDeck with all its worktrees and their sessions (folders on disk are kept). The user is asked to confirm.',
      inputSchema: schema({ repo: { type: 'string', description: 'Repository name, path or id.' } }, ['repo']),
      run: async (args) => {
        const data = deps.getData()
        const repo = resolveRepo(data, text(args, 'repo'))
        const worktrees = (data.worktrees ?? []).filter((w) => w.repoId === repo.id)
        const sessions = data.sessions.filter((s) => worktrees.some((w) => w.id === s.worktreeId)).length
        const yes = await deps.confirm({ title: 'Jarvis: remove repository', message: `Jarvis wants to remove repository “${repo.name}” with ${worktrees.length} worktree(s) and ${sessions} session(s) from SessionDeck. Folders on disk are kept.`, confirmLabel: 'Remove' })
        if (!yes) return `The user did not allow removing repository "${repo.name}". Nothing was changed.`
        app.removeRepo(repo.id)
        deps.log('remove_repo', repo.name)
        return `Repository "${repo.name}" was removed.`
      }
    },
    {
      name: 'file_diff',
      description: 'Code mode: the diff of one changed file in a worktree (unified diff vs the base branch). Get file paths from worktree_changes.',
      inputSchema: schema({
        worktree: { type: 'string', description: 'Worktree name, branch or id.' },
        path: { type: 'string', description: 'File path as worktree_changes lists it.' },
        max_chars: { type: 'integer', description: `Default ${DIFF_DEFAULT_CHARS}.` }
      }, ['worktree', 'path']),
      run: async (args) => {
        const worktree = resolveWorktree(deps.getData(), text(args, 'worktree'))
        const diff = await app.fileDiff(worktree.id, text(args, 'path').trim())
        if (diff.binary) return `${diff.path} is a binary file (no text diff).`
        const max = optionalInt(args, 'max_chars', DIFF_DEFAULT_CHARS, DIFF_MAX_CHARS)
        const body = diff.diff.length > max ? `${diff.diff.slice(0, max)}\n… (cut at ${max} characters)` : diff.diff
        return body.trim().length === 0 ? `${diff.path}: no changes.` : `${body}${diff.truncated ? '\n(the diff was too large and is cut)' : ''}`
      }
    },
    {
      name: 'send_review_comments',
      description: 'Code mode: sends review comments on a worktree\'s changes to its session as one prompt (exactly like the Changes panel\'s Send button): each comment is file + line + text, and the session is asked to apply them.',
      inputSchema: schema({
        worktree: { type: 'string', description: 'Worktree name, branch or id.' },
        comments: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, line: { type: ['integer', 'null'] }, text: { type: 'string' } }, required: ['path', 'text'] } },
        session: { type: 'string', description: 'Which session of the worktree (default: its first open one).' }
      }, ['worktree', 'comments']),
      run: async (args) => {
        const data = deps.getData()
        const worktree = resolveWorktree(data, text(args, 'worktree'))
        const raw = Array.isArray(args.comments) ? args.comments : []
        if (raw.length === 0 || raw.length > COMMENTS_MAX) throw new Error(`Give 1 to ${COMMENTS_MAX} comments.`)
        const comments: ReviewComment[] = raw.map((c) => {
          const item = (typeof c === 'object' && c !== null ? c : {}) as Record<string, unknown>
          if (typeof item.path !== 'string' || typeof item.text !== 'string' || item.text.trim().length === 0) throw new Error('Each comment needs a "path" and a "text".')
          const line = typeof item.line === 'number' && Number.isInteger(item.line) && item.line > 0 ? item.line : null
          return { path: item.path.trim(), line, text: clip(item.text, 500) }
        })
        const sessionRef = optionalText(args, 'session')
        const session = sessionRef !== undefined
          ? resolveSession(data, sessionRef)
          : targetSessions(data).find((s) => s.worktreeId === worktree.id && s.closedAt === undefined && (s.agent ?? 'claude') !== 'shell')
        if (session === undefined || session.worktreeId !== worktree.id) throw new Error(`Worktree "${worktree.name}" has no open Claude or OpenCode session to send to.`)
        const message = formatReviewMessage(comments)
        if (message === null) throw new Error('No comments to send.')
        deps.log('send_review_comments', `${worktree.name}: ${comments.length} comment(s)`)
        return ctx.sendPrompt(session, message, 'auto')
      }
    },

    // ---------- workers and windows (WRK, COD-10)
    {
      name: 'list_workers',
      description: 'Lists the OpenCode worker processes started from sessions (shown as read-only tabs): name, model, status, cost, and which session started them. Optionally only those of one session.',
      inputSchema: schema({ session: { type: 'string', description: 'Only this session\'s workers.' } }),
      run: async (args) => {
        const data = deps.getData()
        const ref = optionalText(args, 'session')
        const only = ref === undefined ? undefined : resolveSession(data, ref)
        const list = app.workers().filter((w) => only === undefined || w.ownerSessionIds.includes(only.id))
        if (list.length === 0) return 'No workers.'
        return list.map((w) => `- "${w.name}" (id ${w.id}): ${w.status}${w.status === 'failed' && w.statusDetail ? ` (${w.statusDetail})` : ''}, ${w.model}, $${w.costUsd.toFixed(2)}, from ${w.ownerSessionIds.map((id) => `"${nameOf(data.sessions, id)}"`).join(', ') || '?'}`).join('\n')
      }
    },
    {
      name: 'code_window',
      description: 'Code mode in its own window: pop_out opens (or brings forward) the separate Code window; dock closes it so Code mode is back in the main window.',
      inputSchema: schema({ action: { type: 'string', enum: ['pop_out', 'dock'] } }, ['action']),
      run: async (args) => {
        const action = text(args, 'action')
        const poppedOut = app.windowState().codePoppedOut
        if (action === 'pop_out') {
          app.popOutCode()
          deps.log('code_window', 'pop_out')
          return poppedOut ? 'The Code window is already open; brought it forward.' : 'Code mode now has its own window.'
        }
        if (action === 'dock') {
          if (!poppedOut) return 'The Code window is not open; Code mode is in the main window.'
          app.dockCode()
          deps.log('code_window', 'dock')
          return 'Docked: Code mode is back in the main window.'
        }
        throw new Error('"action" must be pop_out or dock.')
      }
    }
  ]
}
