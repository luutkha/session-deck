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

/** A prompt waiting to be typed into a session when its current turn finishes (prompt queue, D47). */
export interface QueuedPrompt {
  readonly id: string // unique within the session, 1..64 chars
  readonly text: string // 1..QUEUE_TEXT_MAX chars after trimming
  readonly addedAt: number // epoch ms
}

/** Prompt queue limits (D47): items per session and characters per prompt. */
export const QUEUE_MAX_ITEMS = 20
export const QUEUE_TEXT_MAX = 4000

export interface Group {
  readonly id: Id
  readonly name: string
  readonly collapsed: boolean
}

export type SessionRun = 'running' | 'exited'

/** Which coding agent a session runs. Absent on a stored session = 'claude'. */
export type AgentKind = 'claude' | 'opencode' | 'shell'

/**
 * OpenCode tool-permission policy (D79, D10): 'yolo' merges `permission: {"*": "allow"}` into the session's own
 * config content and is the default; 'ask' leaves the user's own OpenCode permission rules untouched.
 */
export type OpencodePermissions = 'yolo' | 'ask'

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
  /** OpenCode only (D79): how tool permissions are handled. Absent = 'yolo' (D10 default); 'ask' keeps the user's own OpenCode rules. */
  readonly opencodePermissions?: OpencodePermissions
  /** Present (epoch ms) = the user closed this session: its process is stopped and it lives in the sidebar "Closed" section until reopened. A process that merely exits stays open (not closed). */
  readonly closedAt?: number
  /** True = never auto-sleep this session (the idle timer skips it; a manual Sleep still works). Absent = false. */
  readonly keepAwake?: boolean
  /** Free-text notes for this session (max 20000 chars). Absent = none. */
  readonly notes?: string
  /** Work-in-progress checklist (max 100 items). Absent or empty = none. */
  readonly checklist?: readonly ChecklistItem[]
  /** Prompts typed in one by one as turns finish (D47; max QUEUE_MAX_ITEMS). Absent or empty = none. */
  readonly queue?: readonly QueuedPrompt[]
  /** Code mode (D31): the worktree this session runs in (its cwd is the worktree path). Absent = an Ops session. */
  readonly worktreeId?: Id
  /** D53: 'jarvis' = the one session that controls the app (pinned in the sidebar, gets SessionDeck's MCP tools). Absent = a normal session. */
  readonly role?: SessionRole
  /** D61: epoch ms of the last prompt, finished turn or typing in this session (main sets it, throttled). Absent = never seen active; sorts by `createdAt`. */
  readonly lastActiveAt?: number
}

/** D53: a special session kind. Only 'jarvis' exists. */
export type SessionRole = 'jarvis'

/** D54: an instruction SessionDeck gives Jarvis at a local time. */
export interface JarvisSchedule {
  readonly id: string
  /** Short name shown in the list (may be empty). */
  readonly label: string
  /** What Jarvis is told, e.g. "wake API and send 'pull and run the tests'". */
  readonly instruction: string
  /** Local time, minutes after midnight (0..1439). */
  readonly minutes: number
  /** Weekdays 0 = Sunday .. 6; empty = every day. */
  readonly days: readonly number[]
  /** Runs once, then stays in the list as done. */
  readonly once: boolean
  readonly enabled: boolean
  readonly createdAt: number
  /** Epoch ms of the last run; null = never. */
  readonly lastRunAt: number | null
}

/** D54: the result of one voice command: the words heard (null = nothing understood) and what sending them did. */
export interface JarvisVoiceResult {
  readonly heard: string | null
  readonly result: string | null
}

/** D53: Jarvis asks the user before a destructive action; the renderer answers with jarvisConfirmReply(id, yes). */
export interface JarvisConfirmRequest {
  readonly id: string
  readonly title: string
  readonly message: string
  readonly confirmLabel: string
}

/** D55: a window-side action Jarvis asks for (main resolves names to ids first; the renderer runs it with the UI's own hooks). */
export type JarvisUiAction =
  | { readonly kind: 'state' }
  | { readonly kind: 'mode'; readonly mode: UiMode }
  | { readonly kind: 'view'; readonly view: 'terminal' | 'grid' | 'hub' }
  | { readonly kind: 'grid'; readonly preset?: string; readonly cells?: readonly (Id | null)[] }
  | { readonly kind: 'split'; readonly how: 'right' | 'down' | 'unsplit' }
  | { readonly kind: 'openToSide'; readonly id: Id; readonly direction: 'right' | 'down' }
  | { readonly kind: 'sidebar'; readonly open: boolean }
  // D74: show a file in the side-panel viewer (Jarvis tool preview_file). `text` is a path main can resolve for the session.
  | { readonly kind: 'previewFile'; readonly sessionId: Id; readonly text: string }
  | { readonly kind: 'sidePanel'; readonly open: boolean; readonly tab?: 'notes' | 'activity' | 'queue' | 'changes' }
  | { readonly kind: 'dialog'; readonly name: 'settings' | 'costs' | 'search' | 'away' | 'palette' | 'newSession' | 'none'; readonly section?: string }
  | { readonly kind: 'zoom'; readonly action: 'in' | 'out' | 'reset' }
  | { readonly kind: 'worker'; readonly op: 'show' | 'dismiss' | 'leave'; readonly workerId?: string }
  // D58: the rest of the screen.
  | { readonly kind: 'sound'; readonly enabled?: boolean; readonly volume?: number; readonly events?: Readonly<Partial<Record<SoundEvent, JarvisSoundChoice>>>; readonly test?: SoundEvent }
  | ({ readonly kind: 'sidebarView' } & JarvisSidebarView)
  | { readonly kind: 'search'; readonly op: 'find' | 'next' | 'previous' | 'close'; readonly query?: string }
  | { readonly kind: 'tabs'; readonly op: 'next' | 'previous' | 'closeOthers' | 'closeAll' }
  | { readonly kind: 'changesFile'; readonly worktreeId: Id; readonly path: string | null; readonly view: 'diff' | 'preview' }
  // D71: the terminal / graphics preferences kept by the window (localStorage), and the sidebar width.
  | { readonly kind: 'terminalPrefs'; readonly renderer?: 'auto' | 'webgl' | 'canvas' | 'dom'; readonly effects?: 'auto' | 'full' | 'reduced'; readonly scrollbackLines?: number; readonly zoomPercent?: number; readonly rightClick?: 'menu' | 'copy-paste' }
  | { readonly kind: 'sidebarWidth'; readonly width: number | 'reset' | null }
  | { readonly kind: 'jarvisPrefs'; readonly speak?: boolean; readonly panelWidth?: number | 'reset' | null }

/** D58: a notification sound as Jarvis sets it (same shape as the Settings > Sound choice). */
export type JarvisSoundChoice =
  | { readonly kind: 'builtin'; readonly id: string }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'none' }

/** D58: how the sidebar list looks; every field is optional (only the given ones change). */
export interface JarvisSidebarView {
  readonly groupBy?: 'groups' | 'status'
  readonly showWorkspaces?: boolean
  /** '' clears the search. */
  readonly search?: string
  /** Status ids to show (null = "No status"); [] clears the filter. */
  readonly statusFilter?: readonly (Id | null)[]
  readonly closedSection?: 'collapsed' | 'expanded'
  /** Status sections and folder buckets (groups are stored, see group_change). */
  readonly sections?: 'collapseAll' | 'expandAll'
  /** D61: how sessions are ordered inside each section, worktree and Hub column. */
  readonly sort?: 'manual' | 'attention' | 'recent' | 'newest' | 'name'
}

/** D55: one window command from Jarvis; `mode` = the mode the targets live in (the window switches to it first). */
export interface JarvisUiCommand {
  readonly id: string
  readonly mode?: UiMode
  readonly action: JarvisUiAction
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
  /** D57: the repo's own folder (its main checkout), opened as a workspace; no branch was created for it. */
  readonly main?: boolean
}

export const WORKTREE_NAME_MAX = 60

/** D57: where a Code mode workspace comes from. new = a new branch from baseBranch; existing = an existing local branch; main = the repo's own folder. */
export type WorktreeSource = 'new' | 'existing' | 'main'

/** Persisted document (JSON on disk). Runtime-only data (run state, attention) is NOT persisted. */
/** One match in a past conversation (D52 conversation search). */
export interface ConversationHit {
  readonly sessionId: Id
  readonly role: 'user' | 'assistant'
  /** A short excerpt around the match, whitespace collapsed. */
  readonly snippet: string
  /** Where the match starts in `snippet`, and its length. */
  readonly matchStart: number
  readonly matchLength: number
  /** Epoch ms of the message, null when the transcript has no timestamp. */
  readonly at: number | null
}

export interface ConversationSearchResult {
  /** Newest first. */
  readonly hits: readonly ConversationHit[]
  /** True when more matches existed than were returned. */
  readonly truncated: boolean
  /** How many session transcripts were read. */
  readonly searchedSessions: number
}

/** A saved New Session form (D49): one click starts a session with these values. */
export interface SessionPreset {
  readonly id: Id
  /** 1..PRESET_NAME_MAX chars, trimmed. */
  readonly name: string
  readonly cwd: string
  readonly agent: AgentKind
  /** OpenCode only: "provider/model". Absent = OpenCode's own default. */
  readonly model?: string
  /** Claude only (includes --remote-control when chosen). */
  readonly claudeArgs: readonly string[]
  /** A group or status deleted later is simply left out when the preset is used. */
  readonly groupId: Id | null
  readonly statusId: Id | null
}

export const PRESET_MAX = 30
export const PRESET_NAME_MAX = 60

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
  /** Saved New Session forms (D49). Absent = none. Array order = menu order. */
  readonly presets?: readonly SessionPreset[]
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
  /**
   * OpenCode only (D79): health of the injected plugin. Absent = not known yet (still starting); 'ok' = at least one
   * plugin event arrived; 'missing' = silence past the grace window, so the session's status cannot be trusted.
   */
  readonly opencodePlugin?: 'ok' | 'missing'
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
  /** OpenCode only (D79): 'yolo' (default when absent) or 'ask' (use the user's own OpenCode permission rules). */
  readonly opencodePermissions?: OpencodePermissions
  /** Code mode: start the session inside this worktree. Main then uses the worktree path as cwd (input.cwd is ignored). */
  readonly worktreeId?: Id
  /** D53: main only (the IPC validation rejects this key); set when SessionDeck creates the Jarvis session. */
  readonly role?: SessionRole
}

/** Code mode: create a branch + worktree from a repo and start the first session in it. */
export interface CreateWorktreeInput {
  readonly repoId: Id
  /** 1..WORKTREE_NAME_MAX chars; the branch and folder name are derived from it (see branchNameFor). */
  readonly name: string
  /** An existing local branch of the repo: the new branch starts from it, and changes are shown against it. */
  readonly baseBranch: string
  /** D57: absent = 'new'. */
  readonly source?: WorktreeSource
  /** D57, source 'existing': the local branch to check out (it must not be open in another worktree). */
  readonly branch?: string
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
  /** D57: branches checked out in a worktree (the main one included), with its folder. Git allows one worktree per branch. */
  readonly checkedOut?: readonly { readonly branch: string; readonly path: string }[]
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
  /** D60: true = the file also differs from HEAD (staged, unstaged or untracked), so it can still be committed. Absent = committed already. */
  readonly uncommitted?: boolean
}

/** D60: where a worktree's branch stands against its remote and base (Changes panel: Push, Create PR, Merge). */
export interface BranchStatus {
  readonly worktreeId: Id
  /** Checked-out branch; null = detached HEAD. */
  readonly branch: string | null
  readonly baseBranch: string
  /** The remote a push goes to (the upstream's remote, else "origin", else the only remote); null = no remote. */
  readonly remote: string | null
  /** e.g. "origin/fix-login"; null = the branch was never pushed. */
  readonly upstream: string | null
  /** Commits a push would send: ahead of the upstream, or (never pushed) commits on the branch that the base lacks. */
  readonly ahead: number
  /** Commits on the upstream the branch lacks (as of the last fetch). */
  readonly behind: number
  /** Files that differ from HEAD (what Commit can take). */
  readonly uncommitted: number
  /** D57: the repository's own folder (no Merge into base, no delete from disk). */
  readonly repoFolder: boolean
  /** The host's new-pull-request page for this branch (GitHub, GitLab, Bitbucket); null = unknown host or no remote. */
  readonly compareUrl: string | null
  /** GitHub CLI installed and signed in: Create PR makes the PR itself. */
  readonly ghReady: boolean
  /** Readable reason when the status could not be read (other fields are then defaults). */
  readonly error?: string
}

/** D60: commit the given changed files of a worktree. */
export interface CommitInput {
  readonly worktreeId: Id
  readonly message: string
  /** Paths from the Changes list that are uncommitted (1..CHANGES_MAX_FILES). */
  readonly paths: readonly string[]
}

export interface CommitResult {
  readonly sha: string
  /** First line of the message. */
  readonly subject: string
  readonly files: number
}

export interface PushResult {
  readonly remote: string
  readonly branch: string
}

/** D60: title/body for a PR made with the GitHub CLI (ignored when the browser page is opened instead). */
export interface PullRequestInput {
  readonly title?: string
  readonly body?: string
}

export interface PullRequestResult {
  readonly url: string
  /** true = the GitHub CLI created the PR; false = the host's new-pull-request page was opened in the browser. */
  readonly created: boolean
}

export interface MergeResult {
  readonly merged: boolean
  /** What happened, in plain words ("Merged fix-login into main.", "Already up to date."). */
  readonly message: string
  /** Files that conflicted (the merge was undone). */
  readonly conflicts?: readonly string[]
}

/** D60: what removing a worktree from disk would lose (the Remove dialog's warnings). */
export interface WorktreeRemovalInfo {
  readonly worktreeId: Id
  readonly repoFolder: boolean
  readonly branch: string
  readonly baseBranch: string
  readonly path: string
  readonly uncommitted: number
  /** The branch's commits are all in the base branch (deleting it loses nothing). */
  readonly branchMerged: boolean
  readonly folderExists: boolean
}

export interface WorktreeRemoveOptions {
  /** Also `git worktree remove` the folder and delete the branch (never for the repository folder). */
  readonly deleteFromDisk?: boolean
  /** With deleteFromDisk: delete even with uncommitted files (they are lost). */
  readonly discardChanges?: boolean
  /** With deleteFromDisk: delete the branch even when it has commits the base lacks (`git branch -D`). */
  readonly deleteUnmergedBranch?: boolean
}

export interface WorktreeRemoveResult {
  readonly folderDeleted: boolean
  readonly branchDeleted: boolean
  /** Why something stayed on disk, in plain words; absent when everything asked for was done. */
  readonly note?: string
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

/** Rendered preview of one worktree file (Code mode, rich previews): image or text/markdown. */
export interface FilePreview {
  readonly worktreeId: Id
  readonly path: string
  readonly kind: 'image' | 'markdown' | 'text'
  /** image: the bytes as a base64 data-URL payload (mime included in the renderer's src). */
  readonly base64: string
  /** markdown/text: the decoded content (capped; truncated says so). */
  readonly content: string
  readonly mime: string
  /** True when the file exceeded its size cap and was cut (markdown/text only). */
  readonly truncated: boolean
}

/** Size caps of a rendered preview (server-side, previewRead.ts). */
export const PREVIEW_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const PREVIEW_TEXT_MAX_BYTES = 500 * 1024

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

/** Which provider an account row belongs to. Absent on legacy data = 'claude'. */
export type UsageProvider = 'claude' | 'opencode-go'

/** Account-level plan usage; identical for every session of the same account. */
export interface AccountUsage {
  /** Absent on cached/legacy data, which is always Claude. */
  readonly provider?: UsageProvider
  readonly fiveHour: UsageWindow | null
  readonly sevenDay: UsageWindow | null
  /** OpenCode Go only (a rolling 30-day allowance). Absent/null for Claude. */
  readonly monthly?: UsageWindow | null
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
  /** The Claude account. Quota autopilot/toasts read exactly this (D30 stays Claude-only). */
  readonly account: AccountUsage | null
  /** Every provider with data, Claude first, for display only. Absent = legacy single account. */
  readonly accounts?: readonly AccountUsage[]
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

/** D53: the Jarvis session. */
export interface JarvisSettings {
  /** Value of Claude's `--model` for Jarvis (an alias like "sonnet" or a full model id). Empty = Claude's own default. */
  readonly model: string
  /** D54: which agent runs Jarvis. Changing it starts a new Jarvis conversation on the next open. */
  readonly agent: 'claude' | 'opencode'
  /** D54: "provider/model" when Jarvis runs on OpenCode; empty = OpenCode's own default. */
  readonly opencodeModel: string
}

/** Jarvis model ids: letters, digits and . _ : [ ] - (they reach cmd.exe as a launch argument). */
export const JARVIS_MODEL_RE = /^[A-Za-z0-9._:[\]-]*$/
export const JARVIS_MODEL_MAX = 100

/**
 * D79: an OpenCode model set on one session (`set_session_model`): letters, digits, `.`, `-`, `_`, `/` and `:` only,
 * at most 100 characters. A value starting with `-` is refused separately (it would look like a CLI flag).
 */
export const SESSION_MODEL_RE = /^[A-Za-z0-9._\-/:]+$/
export const SESSION_MODEL_MAX = 100

/** App launch behaviour (D50). */
export interface LaunchSettings {
  /** Sessions that were running when SessionDeck quit are resumed in the background on the next launch. */
  readonly resumeRunning: boolean
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
  /** Show the OpenCode Go usage bars (the plugin asks zen/go/v1/usage; the key never reaches the app). */
  readonly showOpencodeGo: boolean
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

/**
 * Repeats the alert (sound, taskbar flash, desktop notice) while a session stays needs-you and unread (D44).
 * The session on screen never reminds, and the user's own "unread" flag is silent by rule.
 */
export interface ReminderSettings {
  readonly enabled: boolean
  /** Minutes a needs-you session stays unread before the alert repeats (1..120). */
  readonly afterMinutes: number
}

/** Code mode (D31). */
export interface CodeSettings {
  /** Folder new worktrees go in (<root>/<repo name>/<worktree folder>). '' = <home>/SessionDeck/worktrees. Absolute when set. */
  readonly worktreesRoot: string
  /** Program used by Shell sessions. */
  readonly shell: ShellKind
  /**
   * Opt-in (default off): answer Claude's "Do you trust the files in this folder?" prompt in a freshly created
   * worktree by typing the same Down + Enter a user would. Only the first start of a Claude Code session; never a
   * resumed one, and never an Ops session.
   */
  readonly autoTrustWorktrees: boolean
}

export type ShellKind = 'powershell' | 'pwsh' | 'cmd'

export interface AppSettings {
  readonly autoStatus: AutoStatusSettings
  readonly tray: TraySettings
  readonly quota: QuotaSettings
  readonly sleep: SleepSettings
  readonly agents: AgentSettings
  readonly hub: HubSettings
  readonly launch: LaunchSettings
  readonly away: AwaySettings
  readonly reminder: ReminderSettings
  readonly code: CodeSettings
  readonly jarvis: JarvisSettings
}

export interface SettingsPatch {
  readonly autoStatus?: Partial<AutoStatusSettings>
  readonly tray?: Partial<TraySettings>
  readonly quota?: Partial<QuotaSettings>
  readonly sleep?: Partial<SleepSettings>
  readonly agents?: Partial<AgentSettings>
  readonly hub?: Partial<HubSettings>
  readonly launch?: Partial<LaunchSettings>
  readonly away?: Partial<AwaySettings>
  readonly reminder?: Partial<ReminderSettings>
  readonly code?: Partial<CodeSettings>
  readonly jarvis?: Partial<JarvisSettings>
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoStatus: { enabled: true, working: 'working', needsInput: 'waiting', finished: 'review' },
  tray: { closeToTray: true, desktopNotifications: true, notifyOnlyWhenUnfocused: true },
  // Hands-off defaults (D33): sleep idle sessions at the critical level, wake + continue after the reset, no asking.
  quota: { enabled: true, warnAtPercent: 80, criticalAtPercent: 95, notifyOnReset: true, criticalAction: 'sleep', resetAction: 'wake', continueOnWake: true, showOpencodeGo: true },
  sleep: { enabled: false, afterMinutes: 30, allEnabled: false, allAfterMinutes: 60 },
  agents: { defaultAgent: 'claude', opencodeModel: '' },
  hub: { scrollToBusiest: true },
  launch: { resumeRunning: true },
  away: { enabled: true, afterMinutes: 15 },
  reminder: { enabled: true, afterMinutes: 10 },
  code: { worktreesRoot: '', shell: 'powershell', autoTrustWorktrees: false },
  // D53: "use sonnet first, changeable".
  jarvis: { model: 'sonnet', agent: 'claude', opencodeModel: '' }
}

export const MIN_SLEEP_MINUTES = 1
export const MAX_SLEEP_MINUTES = 1440

export const MIN_REMINDER_MINUTES = 1
export const MAX_REMINDER_MINUTES = 120

/** Fills every missing field with its default (a stored value that is present always wins). */
export function resolveSettings(stored: Partial<{ [K in keyof AppSettings]: Partial<AppSettings[K]> }> | undefined): AppSettings {
  return {
    autoStatus: { ...DEFAULT_APP_SETTINGS.autoStatus, ...(stored?.autoStatus ?? {}) },
    tray: { ...DEFAULT_APP_SETTINGS.tray, ...(stored?.tray ?? {}) },
    quota: { ...DEFAULT_APP_SETTINGS.quota, ...(stored?.quota ?? {}) },
    sleep: { ...DEFAULT_APP_SETTINGS.sleep, ...(stored?.sleep ?? {}) },
    agents: { ...DEFAULT_APP_SETTINGS.agents, ...(stored?.agents ?? {}) },
    hub: { ...DEFAULT_APP_SETTINGS.hub, ...(stored?.hub ?? {}) },
    launch: { ...DEFAULT_APP_SETTINGS.launch, ...(stored?.launch ?? {}) },
    away: { ...DEFAULT_APP_SETTINGS.away, ...(stored?.away ?? {}) },
    reminder: { ...DEFAULT_APP_SETTINGS.reminder, ...(stored?.reminder ?? {}) },
    code: { ...DEFAULT_APP_SETTINGS.code, ...(stored?.code ?? {}) },
    jarvis: { ...DEFAULT_APP_SETTINGS.jarvis, ...(stored?.jarvis ?? {}) }
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

// ---- GPU / terminal renderer (no-GPU support) ----

/** How Chromium renders here: a real GPU, software (SwiftShader / Basic Render Driver), or not detected yet. */
export type GpuMode = 'hardware' | 'software' | 'unknown'

/** What main measured about this run's GPU; the renderer picks xterm's renderer and a reduced-effects mode from it. */
export interface GpuInfo {
  readonly mode: GpuMode
  /** Human text: the adapter's deviceString (e.g. "NVIDIA ..."), or "SwiftShader (software)". */
  readonly renderer: string
  /** Hardware acceleration is off for this run (we or the user disabled it). */
  readonly accelerationDisabled: boolean
  /** Raw `webgl` entry of app.getGPUFeatureStatus(); '' when unknown. */
  readonly webgl: string
}

/** GPU acceleration preference, applied at the next start. Env SESSIONDECK_GPU=on|off overrides it for one run. */
export type GpuPref = 'auto' | 'on' | 'off'

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
  /** D58: the file was shown selected in its folder instead of opened (asked for, or a program/script). */
  readonly revealed?: boolean
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

/** D73: what the side-panel file viewer can show for a path a terminal link points at. */
export type FileViewKind = 'markdown' | 'text' | 'image' | 'csv' | 'sheet' | 'docx' | 'pdf'

/** One table of a csv (a single sheet) or an Excel workbook (one per sheet). Cells are display strings. */
export interface FileViewSheet {
  readonly name: string
  readonly rows: readonly (readonly string[])[]
  /** True when rows or columns were cut at FILE_VIEW_MAX_ROWS / FILE_VIEW_MAX_COLS. */
  readonly truncated: boolean
}

/** A file read by main for the viewer. The renderer never touches the disk (same rule as FilePreview). */
export interface FileView {
  /** Absolute path main resolved. */
  readonly path: string
  readonly name: string
  readonly kind: FileViewKind
  readonly size: number
  /** markdown/text: decoded text (capped). docx: HTML from mammoth, UNSANITIZED, the renderer must sanitize it. */
  readonly content: string
  /** image: bytes as base64 (mime tells the type). Empty for other kinds. */
  readonly base64: string
  readonly mime: string
  /** csv: one sheet; sheet (xlsx): every sheet up to FILE_VIEW_MAX_SHEETS. Empty for other kinds. */
  readonly sheets: readonly FileViewSheet[]
  /** True when the file or its text was cut at a size cap. */
  readonly truncated: boolean
  /** D75: a PDF over FILE_VIEW_PDF_MAX_BYTES is NOT sent whole: `base64` is '' and the renderer reads byte ranges with `readFileViewRange` (pdf.js range transport). `size` is the whole file. */
  readonly streamed?: boolean
  /** D74: the file's modified time (ms); with `size` it tells the live reload that the file changed. */
  readonly mtimeMs: number
}

export type FileViewResult =
  | { readonly ok: true; readonly view: FileView }
  | { readonly ok: false; readonly error: string }

/** Caps of the file viewer (main enforces them; main never reads past them). */
export const FILE_VIEW_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const FILE_VIEW_TEXT_MAX_BYTES = 1024 * 1024
export const FILE_VIEW_DOC_MAX_BYTES = 20 * 1024 * 1024
/** D75: a PDF is sent whole (base64) to the renderer, which draws it with pdf.js; bigger files are refused. */
export const FILE_VIEW_PDF_MAX_BYTES = 30 * 1024 * 1024
/** D75: a bigger PDF is read in ranges (never loaded whole); beyond this it is refused. */
export const FILE_VIEW_PDF_STREAM_MAX_BYTES = 1024 * 1024 * 1024
/** D75: the largest single range main hands out (pdf.js asks for far less per request). */
export const FILE_VIEW_PDF_RANGE_MAX_BYTES = 8 * 1024 * 1024
export const FILE_VIEW_MAX_ROWS = 2000
export const FILE_VIEW_MAX_COLS = 50
export const FILE_VIEW_MAX_SHEETS = 20

/** D74: a cheap look at a viewed file, so the open preview can notice that it changed on disk. */
export type FileViewStat =
  | { readonly ok: true; readonly mtimeMs: number; readonly size: number }
  | { readonly ok: false; readonly error: string; readonly gone?: boolean }

/** D74: what the app knows about the installed OpenCode (Settings > Agents). */
export interface OpencodeInfo {
  /** First version-looking token of `opencode --version`, or null when it could not be read. */
  readonly version: string | null
  /** Whether `opencode --help` lists `--standalone` (D72). */
  readonly supportsStandalone: boolean
  /** When this answer was probed (ms since the epoch); 0 = no probe finished yet. */
  readonly checkedAt: number
  /** True while a probe is running. */
  readonly probing: boolean
}

/** D75: one byte range of a big PDF, base64. `start` echoes the request so the renderer can feed pdf.js. */
export type FileViewRangeResult =
  | { readonly ok: true; readonly start: number; readonly base64: string }
  | { readonly ok: false; readonly error: string }
