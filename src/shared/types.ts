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
export type AgentKind = 'claude' | 'opencode' | 'shell'

/** Which UI a session belongs to (D31). 'code' = it lives in a git worktree (Session.worktreeId present). */
export type UiMode = 'ops' | 'code'

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
  /** OpenCode only: "provider/model", injected via the config content `model` key (the TUI CLI has no --model flag). Absent or empty = OpenCode's own default. */
  readonly model?: string
  /** Present (epoch ms) = the user closed this session: its process is stopped and it lives in the sidebar "Closed" section until reopened. A process that merely exits stays open (not closed). */
  readonly closedAt?: number
  /** True = never auto-sleep this session (the idle timer skips it; a manual Sleep still works). Absent = false. */
  readonly keepAwake?: boolean
  /** Free-text notes for this session (max 20000 chars). Absent = none. */
  readonly notes?: string
  /** Work-in-progress checklist (max 100 items). Absent or empty = none. */
  readonly checklist?: readonly ChecklistItem[]
  /** Code mode (D31): the worktree this session runs in (its cwd is the worktree path). Absent = an Ops session. */
  readonly worktreeId?: Id
}

/** Code mode (D31): a git repository the user added. Worktrees are created from it. */
export interface Repo {
  readonly id: Id
  /** Display name: the folder name of `path`. */
  readonly name: string
  /** Absolute path of the repository's main working tree (git top-level), Windows separators. Unique. */
  readonly path: string
  readonly createdAt: number // epoch ms
  readonly collapsed: boolean
}

/** Code mode (D31): a linked git worktree on its own branch, created by SessionDeck from a Repo. */
export interface Worktree {
  readonly id: Id
  readonly repoId: Id
  /** Display name the user typed (1..WORKTREE_NAME_MAX chars). */
  readonly name: string
  /** Branch created for it (`git worktree add -b <branch>`). */
  readonly branch: string
  /** Absolute path of the worktree folder, Windows separators. Unique. */
  readonly path: string
  /** Local branch it was created from; changes are shown against merge-base(baseBranch, HEAD). */
  readonly baseBranch: string
  /** Commit of baseBranch at creation (fallback base when baseBranch no longer exists). 40-char hex sha. */
  readonly baseCommit: string
  readonly createdAt: number // epoch ms
  readonly collapsed: boolean
}

export const WORKTREE_NAME_MAX = 60

/** Persisted document (JSON on disk). Runtime-only data (run state, attention) is NOT persisted. */
export interface StoreData {
  readonly version: 1
  readonly sessions: readonly Session[]
  readonly groups: readonly Group[]
  readonly statuses: readonly StatusDef[]
  readonly groupOrder: readonly Id[]
  /** App settings (auto status, tray, quota). Absent = all defaults (see DEFAULT_APP_SETTINGS / resolveSettings). */
  readonly settings?: AppSettings
  /** Code mode repos (D31). Absent = none. Array order = sidebar order. */
  readonly repos?: readonly Repo[]
  /** Code mode worktrees (D31). Absent = none. Array order within a repo = sidebar order. */
  readonly worktrees?: readonly Worktree[]
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
  /** Code mode: start the session inside this worktree. Main then uses the worktree path as cwd (input.cwd is ignored). */
  readonly worktreeId?: Id
}

/** Code mode: create a branch + worktree from a repo and start the first session in it. */
export interface CreateWorktreeInput {
  readonly repoId: Id
  /** 1..WORKTREE_NAME_MAX chars; the branch and folder name are derived from it (see branchNameFor). */
  readonly name: string
  /** An existing local branch of the repo. */
  readonly baseBranch: string
  /** Agent of the first session started in the new worktree. */
  readonly agent: AgentKind
  /** OpenCode only: "provider/model". */
  readonly model?: string
}

export interface CreateWorktreeResult {
  readonly worktree: Worktree
  readonly session: Session
}

/** Local branches of a repo, for the New worktree dialog. */
export interface RepoBranches {
  /** Branch checked out in the repo's main working tree; null = detached HEAD. */
  readonly current: string | null
  /** Local branch names (refs/heads), sorted. */
  readonly branches: readonly string[]
}

/** How a file differs from the worktree's base. */
export type ChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'

export interface ChangedFile {
  /** Path relative to the worktree root, forward slashes. For a rename: the new path. */
  readonly path: string
  /** Renames only: the old path. */
  readonly oldPath?: string
  readonly kind: ChangeKind
  /** Changed line counts; null for binary files (or an untracked file too large to count). */
  readonly additions: number | null
  readonly deletions: number | null
}

/** Everything that differs between merge-base(baseBranch, HEAD) and the worktree on disk (committed, staged, unstaged, untracked). */
export interface WorktreeChanges {
  readonly worktreeId: Id
  /** Sorted by path. At most CHANGES_MAX_FILES entries (truncated = true when there were more). */
  readonly files: readonly ChangedFile[]
  readonly truncated: boolean
  /** Sums of the known counts. */
  readonly additions: number
  readonly deletions: number
  readonly computedAt: number // epoch ms
  /** User-readable reason when the changes could not be read (folder missing, git missing...). files is [] then. */
  readonly error?: string
}

export interface FileDiff {
  readonly worktreeId: Id
  readonly path: string
  /** Unified diff text (git diff output) of this one file; '' when binary. Cut at DIFF_MAX_BYTES. */
  readonly diff: string
  readonly binary: boolean
  readonly truncated: boolean
}

export const CHANGES_MAX_FILES = 500
export const DIFF_MAX_BYTES = 512 * 1024

/** Which windows are open. The Code mode either lives in the main window (switch) or in its own window. */
export interface WindowState {
  readonly codePoppedOut: boolean
}

/** Which window a renderer runs in. 'code' = the popped-out Code window (shows Code mode only). */
export type WindowRole = 'main' | 'code'

export interface HookEvent {
  readonly sessionId: Id
  readonly event: 'Notification' | 'Stop' | 'UserPromptSubmit' | 'AgentSession'
  /** Notification text; for 'AgentSession' it is the OpenCode session id the plugin reports. */
  readonly message?: string
  /** UserPromptSubmit only: the start of the user's prompt (trimmed, max TIMELINE_PROMPT_MAX chars). Absent = unknown. */
  readonly prompt?: string
  /** Per-process id the OpenCode plugins report (the owner process vs its child workers). Absent for Claude hooks. */
  readonly proc?: string
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
  /**
   * Sleep ALL sessions (the one on screen too) once the whole app is idle: no session working or waiting for the user,
   * no session output, and no keyboard/mouse input in SessionDeck for `allAfterMinutes`. Keep-awake and Remote Control
   * sessions are spared. Independent of `enabled`.
   */
  readonly allEnabled: boolean
  /** Minutes the whole app must be idle before everything sleeps (1 to 1440). */
  readonly allAfterMinutes: number
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
  /** What to do when the 5-hour window reaches criticalAtPercent (D30). */
  readonly criticalAction: QuotaCriticalAction
  /** What to do when the 5-hour window resets while sessions wait (slept for quota or stopped at the limit). */
  readonly resetAction: QuotaResetAction
  /** On wake after a reset, type "continue" into sessions whose turn was cut off by the usage limit. */
  readonly continueOnWake: boolean
}

/** ask = the critical toast offers "Sleep idle sessions"; sleep = do it automatically; nothing = only warn. */
export type QuotaCriticalAction = 'ask' | 'sleep' | 'nothing'
/** ask = the reset toast offers "Wake N sessions"; wake = wake them automatically. */
export type QuotaResetAction = 'ask' | 'wake'

/** "While you were away" summary (D29). */
export interface AwaySettings {
  readonly enabled: boolean
  /** Minutes without key/click/wheel in SessionDeck before the user counts as away (MIN_SLEEP_MINUTES..MAX_SLEEP_MINUTES). */
  readonly afterMinutes: number
}

/** Code mode (D31). */
export interface CodeSettings {
  /** Folder new worktrees go in (<root>/<repo name>/<worktree folder>). '' = <home>/SessionDeck/worktrees. Absolute when set. */
  readonly worktreesRoot: string
  /** Program used by Shell sessions. */
  readonly shell: ShellKind
}

export type ShellKind = 'powershell' | 'pwsh' | 'cmd'

export interface AppSettings {
  readonly autoStatus: AutoStatusSettings
  readonly tray: TraySettings
  readonly quota: QuotaSettings
  readonly sleep: SleepSettings
  readonly agents: AgentSettings
  readonly hub: HubSettings
  readonly away: AwaySettings
  readonly code: CodeSettings
}

export interface SettingsPatch {
  readonly autoStatus?: Partial<AutoStatusSettings>
  readonly tray?: Partial<TraySettings>
  readonly quota?: Partial<QuotaSettings>
  readonly sleep?: Partial<SleepSettings>
  readonly agents?: Partial<AgentSettings>
  readonly hub?: Partial<HubSettings>
  readonly away?: Partial<AwaySettings>
  readonly code?: Partial<CodeSettings>
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoStatus: { enabled: true, working: 'working', needsInput: 'waiting', finished: 'review' },
  tray: { closeToTray: true, desktopNotifications: true, notifyOnlyWhenUnfocused: true },
  quota: { enabled: true, warnAtPercent: 80, criticalAtPercent: 95, notifyOnReset: true, criticalAction: 'ask', resetAction: 'ask', continueOnWake: false },
  sleep: { enabled: false, afterMinutes: 30, allEnabled: false, allAfterMinutes: 60 },
  agents: { defaultAgent: 'claude', opencodeModel: '' },
  hub: { scrollToBusiest: true },
  away: { enabled: true, afterMinutes: 15 },
  code: { worktreesRoot: '', shell: 'powershell' }
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
    hub: { ...DEFAULT_APP_SETTINGS.hub, ...(stored?.hub ?? {}) },
    away: { ...DEFAULT_APP_SETTINGS.away, ...(stored?.away ?? {}) },
    code: { ...DEFAULT_APP_SETTINGS.code, ...(stored?.code ?? {}) }
  }
}

/** A quota alert shown in-app (toast) and as a desktop notification. */
export interface QuotaAlert {
  readonly window: 'fiveHour' | 'sevenDay'
  readonly kind: 'warn' | 'critical' | 'reset'
  readonly percent: number
  readonly resetsAt: number | null // epoch seconds
  /** Autopilot (D30): what SessionDeck did by itself for this alert. Absent = nothing. */
  readonly autoAction?: 'slept' | 'woke'
  /**
   * Autopilot (D30): on 'critical', the idle sessions that could be slept (autoAction absent) or that were slept
   * (autoAction 'slept'); on 'reset', the sessions waiting to be woken (autoAction absent) or that were woken
   * (autoAction 'woke'). Absent or empty = no session action to offer.
   */
  readonly sessionIds?: readonly Id[]
}

/** Sessions the quota autopilot holds for the next 5-hour reset (persisted in <userData>/quota-autopilot.json). */
export interface QuotaAutopilotState {
  /** Slept at the critical level by the autopilot (button or automatic). */
  readonly sleptForQuota: readonly Id[]
  /** Their turn was cut off by Claude's usage-limit message. */
  readonly stoppedAtLimit: readonly Id[]
  /** Epoch SECONDS of the 5-hour reset being waited for; null = unknown (no usage data yet). */
  readonly resetsAt: number | null
}

// ---- Timeline + away summary (D29) ----

export const TIMELINE_PROMPT_MAX = 200
export const TIMELINE_MAX_TURNS_PER_SESSION = 200
export const TIMELINE_MAX_AGE_DAYS = 30

/** How a turn ended. A permission request is not an end: it sets neededYou and the turn goes on. */
export type TurnEnd = 'finished' | 'limit' | 'slept' | 'closed' | 'exited'

export interface TimelineTurn {
  /** Unique within the session. */
  readonly id: string
  readonly sessionId: Id
  /** Start of the prompt (max TIMELINE_PROMPT_MAX chars); '' when unknown (OpenCode does not report it). */
  readonly prompt: string
  readonly startedAt: number // epoch ms
  readonly endedAt: number | null // null = still running
  readonly end: TurnEnd | null // null while running
  /** Cost of this turn in USD (session cost delta); null = unknown. Never negative. */
  readonly costUsd: number | null
  /** A permission request or question happened during this turn. */
  readonly neededYou: boolean
}

export interface AwaySessionSummary {
  readonly sessionId: Id
  readonly name: string
  /** Turns that ended 'finished' inside the away window. */
  readonly finished: number
  /** Pending 'permission' attention right now, or a turn inside the window needed the user. */
  readonly needsYou: boolean
  readonly hitLimit: boolean
  /** It was put to sleep inside the window (a turn ended 'slept', or it is asleep now and was not before). */
  readonly slept: boolean
  /** Sum of known turn costs inside the window; null = none known. */
  readonly costUsd: number | null
  /** Prompt of the newest turn inside the window ('' when unknown). */
  readonly lastPrompt: string
  /** Epoch ms of the newest event inside the window (sorting, newest first). */
  readonly lastAt: number
}

export interface AwaySummary {
  readonly since: number // epoch ms: the last user input before going away
  readonly until: number // epoch ms: the input that ended the away time
  /** Only sessions with something to report, newest lastAt first. Empty = nothing happened (no panel). */
  readonly sessions: readonly AwaySessionSummary[]
  readonly totals: {
    readonly finished: number
    readonly needsYou: number
    readonly slept: number
    readonly hitLimit: number
    readonly costUsd: number // sum of known costs, 0 when none
  }
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
