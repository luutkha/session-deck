// SessionDeck shared contract. Do not edit from worker tasks; report mismatches instead.

export type Id = string

export interface StatusDef {
  readonly id: Id
  readonly name: string
  readonly color: string // CSS hex, e.g. "#4caf50"
}

export interface ChecklistItem {
  readonly id: string // unique within the session, 1..64 chars
  readonly text: string // 1..300 chars
  readonly done: boolean
}

export interface Group {
  readonly id: Id
  readonly name: string
  readonly collapsed: boolean
}

export type SessionRun = 'running' | 'exited'

/** Which coding agent a session runs. Absent on a stored session = 'claude'. */
export type AgentKind = 'claude' | 'opencode'

export interface Session {
  readonly id: Id
  readonly name: string
  readonly cwd: string
  readonly groupId: Id | null // null = ungrouped
  readonly statusId: Id | null // user-assigned; null = none
  readonly order: number // position within its group
  readonly createdAt: number // epoch ms
  readonly claudeArgs: readonly string[] // extra args for `claude`
  /** Claude Code conversation id (UUID). First start uses `--session-id <id>`; later starts use `--resume <id>` so the same conversation comes back. Optional only for sessions saved before this field existed. */
  readonly claudeSessionId?: string
  /** Which agent runs here; absent = 'claude' (sessions saved before OpenCode support). */
  readonly agent?: AgentKind
  /** OpenCode conversation id (ses_...), reported by the injected plugin after the first start; resume uses `opencode -s <id>`. */
  readonly opencodeSessionId?: string
  /** OpenCode only: "provider/model" passed as --model. Absent or empty = OpenCode's own default. */
  readonly model?: string
  /** Present (epoch ms) = the user closed this session: its process is stopped and it lives in the sidebar "Closed" section until reopened. A process that merely exits stays open (not closed). */
  readonly closedAt?: number
  /** True = never auto-sleep this session (the idle timer skips it; a manual Sleep still works). Absent = false. */
  readonly keepAwake?: boolean
  /** Free-text notes for this session (max 20000 chars). Absent = none. */
  readonly notes?: string
  /** Work-in-progress checklist (max 100 items). Absent or empty = none. */
  readonly checklist?: readonly ChecklistItem[]
}

/** Persisted document (JSON on disk). Runtime-only data (run state, attention) is NOT persisted. */
export interface StoreData {
  readonly version: 1
  readonly sessions: readonly Session[]
  readonly groups: readonly Group[]
  readonly statuses: readonly StatusDef[]
  readonly groupOrder: readonly Id[]
  /** App settings (auto status, tray, quota). Absent = all defaults (see DEFAULT_APP_SETTINGS / resolveSettings). */
  readonly settings?: AppSettings
}

/** unread = the user flagged the session themselves (Mark as unread): silent, never a sound or notification. */
export type AttentionReason = 'permission' | 'idle' | 'done' | 'bell' | 'unread'

export interface RuntimeState {
  readonly sessionId: Id
  readonly run: SessionRun
  readonly exitCode: number | null
  readonly attention: AttentionReason | null // cleared on focus or user input
  /** Epoch ms when the current attention was raised; absent while attention is null. */
  readonly attentionAt?: number
  /** What Claude is doing right now (from Claude Code hooks). Absent/null = unknown (no hook seen yet). */
  readonly activity?: SessionActivity | null
  /** Text of the last permission/notification request (hook payload message, max 300 chars) while needs-input. */
  readonly activityMessage?: string | null
  /** Epoch ms of the last activity change. */
  readonly activityAt?: number
  /** True while the session is asleep: its Claude process was stopped to free memory and CPU; opening it resumes the same conversation. */
  readonly sleeping?: boolean
  /** True while the running Claude process has Remote Control active (claude.ai/code or the phone app can drive it). */
  readonly remoteControl?: boolean
}

/** working = a turn is running; needs-input = Claude is asking for permission/input; finished = the turn ended. */
export type SessionActivity = 'working' | 'needs-input' | 'finished'

export interface CreateSessionInput {
  readonly cwd: string
  readonly name?: string
  readonly groupId?: Id | null
  readonly statusId?: Id | null
  readonly claudeArgs?: readonly string[]
  /** Defaults to AppSettings.agents.defaultAgent in the renderer; absent = 'claude'. */
  readonly agent?: AgentKind
  /** OpenCode only: "provider/model". */
  readonly model?: string
}

export interface HookEvent {
  readonly sessionId: Id
  readonly event: 'Notification' | 'Stop' | 'UserPromptSubmit' | 'AgentSession'
  /** Notification text; for 'AgentSession' it is the OpenCode session id the plugin reports. */
  readonly message?: string
}

export const DEFAULT_STATUSES: readonly StatusDef[] = [
  { id: 'todo', name: 'Todo', color: '#9e9e9e' },
  { id: 'working', name: 'Working', color: '#42a5f5' },
  { id: 'waiting', name: 'Waiting', color: '#ffb300' },
  { id: 'review', name: 'Review', color: '#ab47bc' },
  { id: 'done', name: 'Done', color: '#66bb6a' }
]

// ---- Usage (fed by Claude Code's statusLine JSON: rate_limits, cost, context_window, model) ----

/** One plan window (5 hours or 7 days). */
export interface UsageWindow {
  readonly usedPercentage: number // 0..100
  readonly resetsAt: number | null // epoch SECONDS when the window resets
}

/** Account-level plan usage; identical for every session of the same account. */
export interface AccountUsage {
  readonly fiveHour: UsageWindow | null
  readonly sevenDay: UsageWindow | null
  readonly updatedAt: number // epoch ms of the last statusLine update that carried it
}

export interface SessionUsage {
  readonly sessionId: Id
  readonly model: string | null // display name, e.g. "Sonnet 5.5"
  readonly contextPercent: number | null // 0..100, how full the context window is
  readonly costUsd: number | null // cost of this Claude session so far
  readonly effort: string | null // e.g. "medium"
  readonly updatedAt: number
}

export interface UsageState {
  readonly account: AccountUsage | null
  readonly sessions: readonly SessionUsage[]
}

/** Why a manual usage refresh failed (the message never contains credentials or response bodies). */
export type UsageRefreshErrorKind =
  | 'no-credentials' // no Claude login found on this machine (~/.claude/.credentials.json)
  | 'stale-token' // 401/403: the stored login token expired; any Claude session refreshes it
  | 'rate-limited' // 429: try again later (retryAfterMs when the server said when)
  | 'server' // 5xx
  | 'network' // offline, DNS, timeout
  | 'unavailable' // unexpected answer / no usage windows in it

export interface UsageRefreshError {
  readonly kind: UsageRefreshErrorKind
  readonly message: string
  readonly retryAfterMs: number | null
}

export type UsageRefreshResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: UsageRefreshError }

// ---- App settings ----

/** Sounds can also be played for quota warnings, which are not tied to a session. */
export type SoundEvent = Exclude<AttentionReason, 'unread'> | 'quota'

/** Moves a session between statuses by itself when Claude's activity changes. null = leave the status alone. */
export interface AutoStatusSettings {
  readonly enabled: boolean
  readonly working: Id | null
  readonly needsInput: Id | null
  readonly finished: Id | null
}

/** Puts idle sessions to sleep (stops their Claude process, keeps the card and the conversation). */
export interface SleepSettings {
  readonly enabled: boolean
  /** Minutes without input, output or activity before a session may sleep (1 to 1440). */
  readonly afterMinutes: number
}

/** Hub board behaviour. */
export interface HubSettings {
  /** Opening the Hub scrolls the board to the status column with the most sessions. */
  readonly scrollToBusiest: boolean
}

/** Which agent new sessions use by default, and the default OpenCode model (empty = OpenCode's own default). */
export interface AgentSettings {
  readonly defaultAgent: AgentKind
  readonly opencodeModel: string
}

export interface TraySettings {
  /** Closing the window hides it to the tray (sessions keep running) instead of quitting. */
  readonly closeToTray: boolean
  /** Windows desktop notifications when a session needs attention / a quota alert fires. */
  readonly desktopNotifications: boolean
  /** Skip desktop notifications while the SessionDeck window is focused. */
  readonly notifyOnlyWhenUnfocused: boolean
}

export interface QuotaSettings {
  readonly enabled: boolean
  readonly warnAtPercent: number // 1..99, e.g. 80
  readonly criticalAtPercent: number // 2..100, greater than warnAtPercent, e.g. 95
  readonly notifyOnReset: boolean
}

export interface AppSettings {
  readonly autoStatus: AutoStatusSettings
  readonly tray: TraySettings
  readonly quota: QuotaSettings
  readonly sleep: SleepSettings
  readonly agents: AgentSettings
  readonly hub: HubSettings
}

export interface SettingsPatch {
  readonly autoStatus?: Partial<AutoStatusSettings>
  readonly tray?: Partial<TraySettings>
  readonly quota?: Partial<QuotaSettings>
  readonly sleep?: Partial<SleepSettings>
  readonly agents?: Partial<AgentSettings>
  readonly hub?: Partial<HubSettings>
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoStatus: { enabled: true, working: 'working', needsInput: 'waiting', finished: 'review' },
  tray: { closeToTray: true, desktopNotifications: true, notifyOnlyWhenUnfocused: true },
  quota: { enabled: true, warnAtPercent: 80, criticalAtPercent: 95, notifyOnReset: true },
  sleep: { enabled: false, afterMinutes: 30 },
  agents: { defaultAgent: 'claude', opencodeModel: '' },
  hub: { scrollToBusiest: true }
}

export const MIN_SLEEP_MINUTES = 1
export const MAX_SLEEP_MINUTES = 1440

/** Fills every missing field with its default (a stored value that is present always wins). */
export function resolveSettings(stored: Partial<{ [K in keyof AppSettings]: Partial<AppSettings[K]> }> | undefined): AppSettings {
  return {
    autoStatus: { ...DEFAULT_APP_SETTINGS.autoStatus, ...(stored?.autoStatus ?? {}) },
    tray: { ...DEFAULT_APP_SETTINGS.tray, ...(stored?.tray ?? {}) },
    quota: { ...DEFAULT_APP_SETTINGS.quota, ...(stored?.quota ?? {}) },
    sleep: { ...DEFAULT_APP_SETTINGS.sleep, ...(stored?.sleep ?? {}) },
    agents: { ...DEFAULT_APP_SETTINGS.agents, ...(stored?.agents ?? {}) },
    hub: { ...DEFAULT_APP_SETTINGS.hub, ...(stored?.hub ?? {}) }
  }
}

/** A quota alert shown in-app (toast) and as a desktop notification. */
export interface QuotaAlert {
  readonly window: 'fiveHour' | 'sevenDay'
  readonly kind: 'warn' | 'critical' | 'reset'
  readonly percent: number
  readonly resetsAt: number | null // epoch seconds
}

export interface LoginItemState {
  readonly supported: boolean // false when running unpackaged (dev)
  readonly openAtLogin: boolean
}

/** What a piece of terminal text points at. 'file' and 'folder' are absolute paths that existed when resolved. */
export type LinkKind = 'url' | 'file' | 'folder'

export interface ResolvedLink {
  readonly kind: LinkKind
  /** http(s)/mailto URL, or an absolute Windows path. */
  readonly target: string
  /** 1-based position parsed from "path:12:5" style suffixes; informational (files open in the default app). */
  readonly line?: number
  readonly column?: number
}

export interface OpenLinkResult {
  readonly ok: boolean
  readonly kind?: LinkKind
  /** User-readable reason when ok is false. */
  readonly error?: string
}

/** A background OpenCode worker started from inside a Claude session (read-only view; never a Session). */
export type WorkerStatus = 'running' | 'done' | 'failed'

export type WorkerLineKind = 'text' | 'tool' | 'error'

export interface WorkerLine {
  readonly kind: WorkerLineKind
  /** Assistant text, the one-line summary of a tool call, or an error message. */
  readonly text: string
  /** Tool name for kind 'tool' (bash, read, edit, ...). */
  readonly tool?: string
  readonly state?: 'running' | 'done' | 'error'
}

export interface WorkerInfo {
  /** Stable per worker run: OpenCode session id + log file name. A resumed worker is a new run. */
  readonly id: string
  readonly name: string
  readonly model: string
  readonly status: WorkerStatus
  /** The raw status written by the runner (ok, rate-limited, timeout, ...). Shown when status is 'failed'. */
  readonly statusDetail: string
  readonly startedAt: number
  readonly finishedAt: number | null
  readonly costUsd: number
  readonly tokens: number
  /** Folder whose .opencode-runs registry the worker was found in. */
  readonly dir: string
  /** Sessions the worker belongs to (their folder is, or sits just below, `dir`). */
  readonly ownerSessionIds: readonly Id[]
  /** Newest lines of the worker's output (capped). */
  readonly lines: readonly WorkerLine[]
}
