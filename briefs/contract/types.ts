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
  /** Present (epoch ms) = the user closed this session: its process is stopped and it lives in the sidebar "Closed" section until reopened. A process that merely exits stays open (not closed). */
  readonly closedAt?: number
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

export type AttentionReason = 'permission' | 'idle' | 'done' | 'bell'

export interface RuntimeState {
  readonly sessionId: Id
  readonly run: SessionRun
  readonly exitCode: number | null
  readonly attention: AttentionReason | null // cleared on focus or user input
  /** What Claude is doing right now (from Claude Code hooks). Absent/null = unknown (no hook seen yet). */
  readonly activity?: SessionActivity | null
  /** Text of the last permission/notification request (hook payload message, max 300 chars) while needs-input. */
  readonly activityMessage?: string | null
  /** Epoch ms of the last activity change. */
  readonly activityAt?: number
}

/** working = a turn is running; needs-input = Claude is asking for permission/input; finished = the turn ended. */
export type SessionActivity = 'working' | 'needs-input' | 'finished'

export interface CreateSessionInput {
  readonly cwd: string
  readonly name?: string
  readonly groupId?: Id | null
  readonly statusId?: Id | null
  readonly claudeArgs?: readonly string[]
}

export interface HookEvent {
  readonly sessionId: Id
  readonly event: 'Notification' | 'Stop' | 'UserPromptSubmit'
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
export type SoundEvent = AttentionReason | 'quota'

/** Moves a session between statuses by itself when Claude's activity changes. null = leave the status alone. */
export interface AutoStatusSettings {
  readonly enabled: boolean
  readonly working: Id | null
  readonly needsInput: Id | null
  readonly finished: Id | null
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
}

export interface SettingsPatch {
  readonly autoStatus?: Partial<AutoStatusSettings>
  readonly tray?: Partial<TraySettings>
  readonly quota?: Partial<QuotaSettings>
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoStatus: { enabled: true, working: 'working', needsInput: 'waiting', finished: 'review' },
  tray: { closeToTray: true, desktopNotifications: true, notifyOnlyWhenUnfocused: true },
  quota: { enabled: true, warnAtPercent: 80, criticalAtPercent: 95, notifyOnReset: true }
}

/** Fills every missing field with its default (a stored value that is present always wins). */
export function resolveSettings(stored: Partial<{ [K in keyof AppSettings]: Partial<AppSettings[K]> }> | undefined): AppSettings {
  return {
    autoStatus: { ...DEFAULT_APP_SETTINGS.autoStatus, ...(stored?.autoStatus ?? {}) },
    tray: { ...DEFAULT_APP_SETTINGS.tray, ...(stored?.tray ?? {}) },
    quota: { ...DEFAULT_APP_SETTINGS.quota, ...(stored?.quota ?? {}) }
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
