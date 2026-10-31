# SessionDeck decisions

The record of what the user decided, and why, so nobody re-asks or quietly undoes it. Newest entries at the bottom of each section.

**Rules for this file**
- Add an entry whenever the user makes a choice: a feature yes/no, a design option, a scope cut, a working rule.
- Quote the user's words when they decided it. Say what was rejected or deferred too, since that is what gets forgotten.
- Never delete an entry. If a decision changes, mark the old one `Superseded by Dnn` and add the new one.
- Statuses: **active** (in force), **superseded**, **deferred** (maybe later, only if the user asks), **rejected** (do not build).

Current state of the code lives in `HANDOFF.md`; gotchas learned the hard way live in `docs/LESSONS.md`.

---

## Product decisions

**D01 · 2026-10-12 · A narrow Orca, six features only** · active
"similar apps but more narrow, only these feature: 1/ able to create session easy with claude code 2/ easy to changes name of session 3/ can monitor by status that we assign 4/ can sound when need attention 5/ can easy grouped, changes group of a session, changes name of group 6/ smooth ui console view - as close as native as possible". Everything after that was added one request at a time (below). Original spec: `PLAN.md`.

**D02 · 2026-10-13 · UI looks exactly like Orca** · active
"i want the same UI like orca, exactly". Spec and measured tokens: `DESIGN.md`. Orca's source is in `reference/` (git-ignored, third-party).

**D03 · 2026-10-13 · Sessions survive an app restart (conversation resume)** · active
User: Orca keeps sessions after close/reopen, SessionDeck should too. Each session has its own Claude conversation id; selecting it after a restart runs `claude --resume`. Nothing starts at launch.
Rejected for now: a background service that keeps `claude` processes alive while the app is closed (offered, not taken).

**D04 · 2026-10-13 · Closing a tab kills the session, but it can be resumed** · active
"close a tab should close the session, but i want still can resume it later". Close kills the whole process tree and moves the session to the Closed section; resume restores the same conversation. Remove (with confirmation) deletes for good.

**D05 · 2026-10-13 · Custom sounds, a Hub by status, a place to configure statuses** · active
From the first hands-on test. Settings > Sound, the Hub board, Settings > Statuses.

**D06 · 2026-10-13 · Usage in the status bar, per-session notes and checklist** · active
"Usage in the status bar, Per-session notes and a work-in-progress checklist".

**D07 · 2026-10-13 · Usage bars get a manual reload, the Orca way** · active
"should have a button for mannually reload when i want => follow orca approach". Uses the Anthropic OAuth usage endpoint with the local Claude login token, read in main only, manual only (never polled), one-time consent.

**D08 · 2026-10-13 · Batch 2: auto status, quota guard, split panes, installer, tray** · active
"do for 1, and 3, 4, 5 and tray icon" (from my list: 1 auto status, 2 worktrees, 3 quota guard, 4 split panes, 5 installer).

**D09 · 2026-10-13 · No git worktrees** · superseded by D31 (2026-10-22) for Code mode only
Option 2 of that list was skipped on purpose and the user has repeated they do not want it. Do not propose or build worktree-per-session. 2026-10-22: the user asked for worktrees themselves, in a separate Code mode (D31). Ops mode stays worktree-free.

**D10 · 2026-10-17 · Claude sessions always run in yolo mode** · active
"when create session, i want it always on yolo mode". `--dangerously-skip-permissions` unless the user already passed a permission flag. OpenCode sessions get `permission: {"*": "allow"}`.

**D11 · 2026-10-17 · Ping only when a session stops or needs the user** · active
"i want only ping user when session done the task user assign and stop or need ask user, not when it still working". Only the Stop and Notification hooks ping; the idle-output detector is off.

**D12 · 2026-10-17 · Clickable links in the terminal** · active
URLs, file paths and folder paths open on click (depending on the target).

**D13 · 2026-10-17 · Image paste and file drop** · active
Pasting a clipboard image attaches it; dropping a file pastes its path.

**D14 · 2026-10-17 · Sleep, like Orca's hibernation** · active
Idle timer plus manual Sleep/Wake; waking resumes the conversation.

**D15 · 2026-10-17 · OpenCode as a second agent** · active
"default session should can config on setting. for the select model, i want to do the textbox first"; "should have a dropdownn on create session modal for me can choose the claude or opencode". Default agent in Settings, model is a text box (no model dropdown yet), Agent dropdown in New Session.

**D16 · 2026-10-17 · Remote Control works, sessions can be kept awake** · active
Remote Control sessions keep working; per-session **Keep awake** flag ("it should be a flag or something similar"); a session with Remote Control active is marked Keep awake automatically.

**D17 · 2026-10-17 · Notes panel: Save button, Add button, checkbox insert; checklist draft survives a session switch** · active
"i want a button for 'save' to easy control. and checklist should have the checkbox insert format". Checkboxes in the notes text stay plain text (clickable ones were offered, not requested).

**D18 · 2026-10-17 · The tab bar shows only sessions from the active session's folder** · active
"i only want session that open or fork from the same folder root show toghether, if not have anyother, they show stand alone".

**D19 · 2026-10-17 · OpenCode worker tabs: read-only, auto-close, must work anywhere** · active
"first, readl only for now. 2/ closed 3. ... make sure it follow UI, easy for user to see and use". Then: "i want a reliable solutions, not the solutions that only working on 1 PC". So detection is a plugin injected into every opencode process started from a Claude terminal, not folder scanning.
Deferred: a real interactive OpenCode terminal (shared `opencode serve` + `opencode attach`) and resume-from-tab.
2026-10-25 follow-up: OpenCode sessions are covered too ("any opencode process started from an OpenCode session shows as a worker tab, exactly like Claude/Shell"). The owner is the FIRST process that reports for the session (both plugins carry `proc` = pid; the parent must report first, so the worker plugin posts `hello` at initialization and loads before the session plugin). Child session-plugin events (AgentSession, busy/idle, cost) are ignored by proc: they never change the parent's `opencodeSessionId`, activity, status or usage. Owner records reset when the pty starts (sleep/wake, restart), not on exit.

**D20 · 2026-10-17 · Workspaces inside sidebar groups** · active
"in grouping, we show the workspace also, base on the root folder that open the session". User accepted all three recommendations: workspace = the folder the session was opened in (`cwd`, not the git root), Groups view only (Status view unchanged), headers shown even for a single workspace, with a "Show workspaces" toggle.

**D21 · 2026-10-18 · The right mouse button belongs to SessionDeck** · active
"the issue of double paste when right click on claude on this apps still not fixed". Right-click copies a selection or pastes once; it is never forwarded to the program in the pane (Claude's fullscreen UI would paste a second time).

**D22 · 2026-10-19 · Orca-style attention bell** · active
"currently, the app only show the status, but not show when a session need a attention from me, Orca have a "bell" icon that show it? can we do the same?" Then "1. yes 2. yes, list 3. okie, include it":
1. A filled amber bell **replaces** the status dot (card, tab, Hub) while a session needs the user.
2. The sidebar-header bell (with count) opens a **list** of sessions that need the user; click a row to open it. The status-bar count opens the same list.
3. Manual **Mark as read / Mark as unread** (bell click and context menu) is included.
What raises the bell is unchanged (D11: finished / needs-you only).
2026-10-19 follow-up: "i ask them to ask me some question, but still no "bell" icon displayed". The session on screen gets the bell too (it means "waiting for you"); it just never pings (no sound, flash or desktop notice) because the user is looking at it. Typing into it or opening it clears the bell.

**D23 · 2026-10-19 · New Session remembers the last folder** · active
"on model of create new session, the default value of the root folder is the last folder we choose (except the very first time)". The folder field opens with the folder of the most recently created session (derived from the store, so it survives restarts with no extra setting); empty when there are no sessions. A folder passed by the caller (workspace header, D20) still wins.

**D24 · 2026-10-19 · Opening the Hub scrolls to the busiest status** · active
"when i click to button that will redirect me to the hub, can we auto scroll to the status that have most ticket?! make it a option on setting". Settings > General "Open the Hub at the busiest status", on by default (`AppSettings.hub.scrollToBusiest`). Leftmost column wins a tie; a busiest column already in view does not move the board; it runs each time the Hub opens, never while working in it.

**D25 · 2026-10-19 · Auto-update over the internet** · deferred
User asked how to push updates that other machines install over the internet, then "any free options?", then "skip for now". Researched answer, for when it comes back: `electron-updater` + electron-builder `publish`; free hosting = GitHub Releases on a public repo (a separate public releases repo if the source stays private; a private repo would need a token in every install) or Cloudflare R2 free tier; no free code signing for a private app (unsigned works, SmartScreen warns once per machine; SignPath Foundation is free only for open source). Existing 0.0.1 installs need one manual install of the first updater build.

**D26 · 2026-10-22 · Sleep everything when the app is idle** · active
"i want a setting that can auto trigger sleep for alls after a specific time the apps not working". User picked: trigger = no session working or waiting for you AND no key/click/wheel in SessionDeck for X minutes (then the session on screen sleeps too); spared = Keep-awake and Remote Control sessions. Separate switch from the per-session idle timer (D14), default off, 60 minutes.

**D27 · 2026-10-22 · Sleeping keeps the attention bell** · active
Asked for recommendations, user replied "do 1 and 3". Item 1: a session put to sleep (manually, idle timer or sleep-all) keeps its bell and its "Needs you" entry until the user opens it or marks it read.

**D28 · 2026-10-22 · Command palette** · active
Item 3 of the same reply. Ctrl+K (outside the terminal, which keeps Ctrl+K for Claude's delete-to-end-of-line) or Ctrl+Shift+K (anywhere) opens an Orca-style palette: jump to any session (open, sleeping, closed), New session / Hub / Settings, and actions on the session on screen (sleep, keep awake, read/unread, set status).

**D29 · 2026-10-22 · "While you were away" timeline** · active
Asked "any big feature u recommend?", replied "do 2,3". Item 2: per-session log of turns (prompt, start/end, duration, cost, needed you) plus a summary across all sessions when the user returns. Plan shown, user said "go". Defaults (not asked, chosen by Claude, user may change): away after 15 minutes, can be turned off in Settings > General.

**D30 · 2026-10-22 · Quota-aware autopilot** · active
Item 3 of the same reply: at the critical quota level offer to sleep idle sessions; when the 5-hour window resets, notify and wake them with one click (optional "continue"). Plan shown, user said "go". Defaults: both actions ask (automatic is a setting), "continue" off. Busy, Keep-awake and Remote Control sessions are never slept.

**D31 · 2026-10-22 · Code mode (worktrees)** · active
"a new saparate mode for task that will require changing code ... saparate windows ( or have a swith ...) ... UI should be complettly saparate ... follow the approach of Orca (create work-tree), all others feature should similar". Answers: layout = BOTH (Ops | Code switch in the main window, plus pop Code out into its own window and back); structure = Orca style repo > worktree > sessions (Claude, OpenCode or a plain shell in one worktree); git actions in v1 = Changes / diff view ONLY (no commit/merge, no PR, no git delete: user left those unticked); alerts = shared across modes (one quota, autopilot, sleep-all, sounds), bell and Needs-you list per mode, badge on the switch when the other mode needs you. Plan shown, user said "go". Defaults (Claude chose, user may change): worktrees in <home>/SessionDeck/worktrees/<repo>/<name> (Settings), branch = name made git-safe, base = repo's current branch, Shell = PowerShell, "Remove from SessionDeck" keeps folder and branch on disk, Claude's trust-folder prompt is not bypassed.
2026-10-25 follow-up (post-implementation review fixes): a failed first session rolls the worktree back out of SessionDeck (files stay on disk — "Remove" semantics unchanged); git runs with LC_ALL=C so its error lines stay parseable on a non-English Windows; a drive root (D:\) as repo folder falls back to a cleaned name for the worktrees path; removing a session also drops it from the per-window "on screen" map (no ghost feeding sleep checks). The "New session in this worktree" dialog (row "+") is fully wired: agent + model only, the folder is the worktree.

**D32 · 2026-10-25 · Grid view: see many sessions at one time** · active
"a next feature i want: view many session one time. by choose view with 1x1, 2x1, 1x2, 2x2 or 2x3, 3x2. each sub-window i want can choose session i want to see." Plan: `plan/grid-view.md` (proposed, waiting "go"). Confirmed answers: every cell is a FULLY INTERACTIVE terminal (typing, not read-only mirrors); a session picked for a cell that already shows it is MOVED there (no duplicate sessions in cells); cell sizes are UNIFORM per preset (no draggable dividers in v1); empty cells show a PICKER with no auto-fill. Operations mode and Code mode each keep their own grid (per-mode storage keys, like D31).

**D33 · 2026-10-25 · Fully hands-off quota autopilot** · active
Asked "do we have auto continue when the quota reset after a session hit limit?", shown the ask-defaults, replied "i want it fully handoff". So the DEFAULT settings become: at the critical level sleep idle sessions without asking (`criticalAction: 'sleep'`), at the 5-hour reset wake the held sessions without asking (`resetAction: 'wake'`) and type "continue" into the one that was cut off by the limit (`continueOnWake: true`). The user hears everything (notifications + "Woke N sessions" info) but clicks nothing. Ask-mode options stay in the settings for those who want them back. If hands-off automation FAILS (a wake fails, or "continue" can never be typed), it must never fail silently: a "SessionDeck needs you" desktop notice + quota sound names the session (the give-up / wake-failure path is unit-tested; the real-app e2e covers the happy path). A stored quota block that still equals the OLD defaults field-for-field (ask/ask/false, including untouched thresholds) migrates itself to the new defaults on boot; any customized field means a deliberate choice and is kept. Phase 2 (auto-continue against a weekly window) is deferred. Plan: `plan/hands-free-quota.md` — implemented the same day, user said "i want it fully handoff" then approved Phase 1 only.

**D34 · 2026-10-25 · Annotate AI diffs — comments ship to the agent, Code-change mode only** · active
"write plan for 1. => but this should only active for code-change-mode only." (choice 1 = Orca's "Annotate AI Diffs": review a changed file, comment per diff line, send the comments back to the agent without leaving the app). The Code-mode-only guard is the user's condition, kept literally: the annotation UI lives only where the Changes tab lives (`NotesPanel` renders `ChangesPanel` for worktree sessions only) — an Ops session has no Changes tab and no annotation UI. v1 scope: no threads/replies, no PR review (PRs were left out in D31), no auto-wake on send.

**D35 · 2026-10-25 · Rich previews — rendered Markdown and images of worktree files, Code mode only** · active
Orca's "Rich repo previews", v1 scope per plan (the user approved the queue): a Diff | Preview toggle in the Changes panel for renderable changed files — images (png/jpg/gif/webp/bmp; svg excluded: scriptable) and Markdown (marked + DOMPurify, sanitized; links open through the app's open pipeline, never the window). A new additive IPC reads the file in main with the path resolved (and realpath-checked) inside the worktree and sizes capped (5 MB images, 500 KB text, cut marked). PDFs and a repo-wide file browser are out of v1.

**D36 · 2026-10-25 · Terminal comfort — global zoom + scrollback setting** · active
User asked for "terminal comfort settings: font zoom + scrollback length". Decisions taken (defaults chosen by Claude, user may change): ONE app-wide terminal profile (no per-pane zoom), Ctrl+= / Ctrl+- / Ctrl+0 and Ctrl+wheel zoom live by 10% steps within 50..200%, the scrollback length is a Settings > Terminal value (1,000..100,000 lines, default 10,000) applied to NEW panes; the profile persists in localStorage and both windows share it.

**D37 · 2026-10-25 · Quota bars for both agents (Claude + OpenCode Go)** · active
"the quota bar only display for claude code, i want it display both, like Orca do." The status bar now shows one labelled group per account: Claude (unchanged; still `UsageState.account`, the only account the autopilot and quota toasts read) and OpenCode Go, whose allowance the OpenCode plugin fetches from `https://opencode.ai/zen/go/v1/usage` and posts as a normal statusline body with `source: 'opencode-go'`. Display only: no autopilot, no quota alerts, no toasts from Go numbers. The Go key is resolved ONLY through the v2 plugin API (`context.integration.connection.active('opencode-go')` + `resolve`) and never leaves the plugin process; it is never stored, posted or logged, and any failure (not signed in, 401/429, offline, no usable window) posts nothing at all. The plugin refreshes at setup and after each turn end, throttled to once per 5 minutes. Labels (`Claude` / `Go`) appear only when two or more accounts exist, so Claude-only users see no visual change; the Go group adds a `Month` chip. Settings > Quota gains "Show OpenCode Go usage" (default on), enforced in main: a disabled provider drops at once and later Go payloads are ignored. A real Go endpoint check is not possible on this machine (no OpenCode Go login), so the fetch path is covered by unit tests with fake credentials/responses and the multi-provider UI by `e2e:usage-both`. Plan: `plan/opencode-quota-bars.md.done`.

**D38 · 2026-10-25 · Timeline trust: late Stops/costs and sleeps across a restart** · active
Hardening W1 of `plan/hardening-round.md` — the three gaps found by the earlier read-only review. Root cause: `startPrompt` ended the running turn itself, and a later `Stop`/statusLine ended or charged whatever turn happened to be running, so a quick follow-up prompt stole the previous turn's ending and cost.
Rules now: a prompt submitted while a turn is still open SUPERSEDES it (`awaitingStop`, FIFO, max 8 — a lost Stop must not grow the list forever); a late `Stop` settles the OLDEST superseded turn at its arrival time and never touches the newly started one; the cost cursor (`CostTrack.startCost`) is advanced on every `refreshCost`, so increments accumulate per targeted turn and a late statusLine still books its delta on the old turn; after a superseded turn settles the cursor moves to the next queued turn else the running one (`focusCostAfterStop`). Limit/close/exit forget the queue. Sleep times are persisted in the same timeline file (`sleeps`, newest per session, retention-pruned, field omitted when empty) so `lastSleptAt` and the away summary survive a restart. Covered by unit tests (3 new out-of-order scenarios, sleep round-trip) and `e2e:away` (16 checks, new late Stop/cost pair through the real hook and statusLine endpoints). Kill criterion not hit: the saved-file shape is unchanged for existing timelines (the new field is optional).

**D39 · 2026-10-25 · Quota autopilot hardening: real wording, weekly critical, reset dedup** · active
Hardening W2 of `plan/hardening-round.md`, three changes that add no UI:
- **Wording capture.** The usage-limit pattern list is knowingly incomplete, so the first `USAGE_LIMIT_PATTERNS` match of a process is now logged to `main-errors.log` as `usage limit wording (add to USAGE_LIMIT_PATTERNS if new): Error: <line>` — ANSI-stripped, control characters collapsed, max 200 chars, once per process, and only when a limit is REPORTED (a resumed session redrawing an old message is still ignored). No telemetry, no file of its own: the existing error log.
- **Weekly critical follows `criticalAction`.** `onAlert` gives the critical level of EITHER window the ask/sleep/nothing policy (before, only the 5-hour one did). A weekly-critical sleep is a normal quota hold, so the next 5-hour reset wakes it: there are still no 7-day holds. A weekly reset stays notification-only (it never wakes or types "continue").
- **Reset dedup is per window.** The 30-minute dedup that drops a guard copy of a reset the autopilot timer already handled applies to the five-hour window only; a weekly reset arriving inside that window is still delivered (it changes no autopilot state, so it cannot disturb the hold). Locked by a unit test and by `e2e:autopilot` (weekly critical at 99% sleeps the idle session with no click, the 5-hour reset wakes it, then a weekly reset inside the dedup window still shows a toast).
The `continue` retry/notification item of the plan is already shipped by `hands-free-quota.md.done` (D33), so it was skipped instead of built twice.

**D40 · 2026-10-26 · "On screen" means every open window, not the focused one** · active
Hardening W5 of `plan/hardening-round.md`. `isSessionOnScreen` used to compare the id with `activeSessions.get(windows.focusedRole())`, so with Code popped out:
- the Code window's session looked background while the user was reading it → the idle timer could sleep it, and its bell/desktop notice could fire;
- after the Code window docked/closed, its role kept the last id forever (nothing cleared it), so that session was never slept and its notices were always suppressed.
Rules now: `onScreenSessionIds()` is `new Set(activeSessions.all())` and `isSessionOnScreen(id)` is a membership test; the sleep scheduler depends on `getOnScreenSessionIds` and `pickSessionsToSleep` takes `onScreenSessionIds: ReadonlySet<Id>` (2 new unit tests). `windows.onStateChange` clears the Code role whenever `codePoppedOut` is false, so a docked/closed window cannot leave a ghost. The app-wide sleep-all rule is deliberately unchanged: it sleeps the session on screen too (D26). E2E `e2e:sleep` now drives the real UI: a worktree session is opened in the popped-out Code window, a background Ops session sleeps while it keeps running, then docking + switching the main window to Ops makes it sleep on the next tick.

**D41 · 2026-10-26 · Terminal search on Ctrl+Shift+F, visible pane only** · active
Hardening W3 of `plan/hardening-round.md`.
- `@xterm/addon-search` 0.16 is loaded in `paneFactory` per pane (`TerminalView.searchAddon`), so the scrollback of one session is never searched through another.
- **Ctrl+Shift+F, not Ctrl+F**: Ctrl+F is readline forward-char and must reach the program. The shortcut is a window capture listener (the Ctrl+Shift+K palette precedent) and `keymap.ts` also swallows it so `^F` cannot leak; dialogs still take precedence.
- The bar lives in `ModeWorkspace` (bottom-right of the terminal area) and is enabled for the terminal and grid views only. It captures the pane id when opened: switching tabs/view closes it instead of moving the search to a pane the user did not choose. v1 is visible pane only, no all-panes search.
- Enter / Shift+Enter cycle, Esc closes, clears decorations and refocuses the xterm textarea. The counter needs the addon's `decorations` option — without it `onDidChangeResults` never reports counts.
- Scrollbar arrow buttons (Windows' default WebKit styling) are hidden with a scoped `::-webkit-scrollbar-button` rule; the theme thumb colours stay.

**D42 · 2026-10-26 · Bulk select sessions and act on them from the sidebar and Hub** · active
Hardening W4 of `plan/hardening-round.md`.
- **Rules are pure, not React.** `renderer/state/multiSelect.ts` owns plain/Ctrl/Shift click semantics, `Esc`, pruning to the visible order and view-ordered output; `useMultiSelect` is the shared React shell. Both views pass their own order (sidebar `flatSessionIds`, Hub board order), so collapsed groups, workspaces, search and status filters all behave like the screen.
- **Plain click opens and clears** (it only sets the range anchor). Ctrl/Cmd+click toggles without changing the active session; Shift+click replaces the set with the visible range. A Ctrl+click on an empty set first includes the plain-clicked anchor, matching Explorer (found by `e2e:bulk`, not by unit tests).
- **v1 actions:** Sleep, Wake, Set status, Move to group, Clear. No Close/Remove: destructive bulk actions stay one-at-a-time. Wake opens the session because `wakeSession` is main-only.
- **Application order and failures:** sequentially in view order (never click order), one try/catch per item; the store banner reports failures and the loop continues. The selection survives the action, so the user can chain another one or clear with `Esc`.
- **Two independent selections:** the sidebar and the Hub each own their state; selecting in one never changes the other. The Hub rows use the same modifiers and bar, so the board is not a second, weaker UI.
- Rejected: drag-to-select rectangles, a "select all" shortcut and bulk close (offer again if the user asks).

**D43 · 2026-10-27 · Answer Claude's worktree trust prompt only when the user opts in** · active
Hardening W6 of `plan/hardening-round.md`.
- **Default OFF, a Code setting.** `code.autoTrustWorktrees` sits in Settings > Code next to the worktree folder. Turning it on means "when I create a new worktree, accept Claude's folder-trust prompt for me"; nothing changes for anyone who leaves it off.
- **Narrow scope.** The watcher answers only a fresh start (`mode === 'new'`), only a Claude session, only one with `worktreeId`, and at most once per process. Resumed conversations never ask again; Ops sessions, OpenCode and Shell sessions are never touched; sleep/wake and restarts (which resume) are not answered. The trust state is cleared on start, exit, close, remove and restart.
- **Same answer as a user.** It types Down + Enter (`\x1b[B\r`), moving from the preselected "No, exit" to "Yes, I trust this folder". Detection needs BOTH menu labels in the last 4,000 ANSI-stripped characters, so ordinary prose or a half-drawn menu does not trigger it. This is the exact sequence the real-TUI e2e harness already used, so no new bypass of Claude's checks is introduced: the user still chooses to trust the folder, only once instead of per worktree.
- **Tested without touching the real trust store.** `e2e:trust` puts a fake `claude.cmd` first on PATH; it prints the real menu and records received bytes. The suite proves default OFF sends nothing, the Settings switch persists, and a fresh worktree gets the answer exactly once.

**D44 · 2026-10-27 · Repeat the alert while a needs-you session stays unread** · active
Plan `plan/attention-reminders.md` (bell escalation).
- **On by default, easy to turn off.** New store-backed `reminder { enabled: true, afterMinutes: 10 }` (1–120 minutes) on Settings > Sound, NOT localStorage: main reads it on every tick, so a change applies immediately and survives a restart. The setting is the user's requested off switch for the whole reminder feature.
- **Only real attention repeats.** `permission`, `done`, `idle` and `bell` schedule; the user's own `unread` flag never does. A reminder is exactly the same path as the first raise: `Notifier` sends `ev:sound` + flashes the taskbar, and `onReminder` builds the same desktop text through `attentionNotice` → `notifySession` (so the tray settings, including "only when unfocused", still decide whether a notification shows). Main still never plays a sound itself.
- **The one stateful owner.** `main/attention/reminder.ts` is pure (`since` / `lastRemindAt` / due check, clamping); `AttentionService` arms on every non-null transition, disarms on null/forget, and runs one 30 s interval started in `start()` and cleared in `stop()`. Sleeping keeps the reminder (`suspend` leaves the bell); reading, clearing, closing, removing or forgetting disarms it. A priority upgrade (e.g. done → permission) keeps the original `since` but drops `lastRemindAt`, so the more urgent reason repeats like a fresh raise.
- **No ping for the session on screen.** A due reminder for the visible session is marked as snoozed but not played, so looking at a waiting session never nags and leaving it starts a fresh interval.
- **Restart semantics (v1).** The wait start is in memory only: a bell that existed before a restart stays silent until a new raise. No pre-restart catch-up and no per-reason intervals.
- **Verified in the real app.** `e2e:reminder` opens Settings > Sound through CDP, stores 1 minute, raises a real hook bell on a background Shell session (one sound at once, a second after ~60 s), leaves an on-screen session raised for the same minute with no sound, clears the bell (no further sound), turns the switch off in the UI (a new raise pings once, no second), and asserts the store values throughout.

**D45 · 2026-10-31 · Code review round 3: improve without changing feature logic** · active
"review all the code, to improve, but DO NOT break the logic of features", then "go ahead with all, remove A1, keep the route".
- **Rename no longer touches the active session.** The `session:rename` handler used to call `controller.setActiveSession(getActiveSessionId())` (a leftover from the initial commit), which could auto-start or wake the session on screen. Removed; renaming only renames.
- **Legacy `POST /hook` route is kept** (body `{sessionId, event, message?}`), although nothing in `src` posts to it.
- Everything else is behaviour-preserving: `PtyManager.kill` never throws on a dead pid-less pty, `WorkerHub` prunes heartbeats of forgotten processes, shared `isJsonObject` / `errorMessage` helpers, one wrapper for the renderer store actions, `HookServer` auth/body helpers, `sessionController` tidy-up.

**D46 · 2026-10-31 · Next round: quick fixes, the queued features, then an installer for hands-on testing** · active
After the round-3 review the suggestion list was: 1 hands-on round with a fresh installer, 2 quick fixes (Windows reserved worktree names, stale docs, away summary across restart), 3 features (prompt queue, send one prompt to several sessions, session presets, reopen sessions on launch, cost per session over time, search past conversations / fork), 4 share-only items (auto-update, code signing, light theme). The user: "Do for 1,2,3 . Skip 4".
- Order: quick fixes, then the features one by one (each verified and committed), then `npm run dist` so the hands-on round uses a build that has everything.
- Auto-update, code signing and the light theme stay deferred.

**D47 · 2026-10-31 · Prompt queue: send the next prompt when the turn finishes** · active
Feature 1 of the D46 list ("Do for 1,2,3"). Defaults chosen while building, change on request:
- **Saved per session** in the store (`Session.queue`, max 20 prompts, 1..4000 chars), so a queue survives a restart.
- **When:** the moment the session's activity turns `finished` (Claude Stop hook or the OpenCode plugin's Stop). One prompt per finished turn. A prompt added while the session is already idle goes out at once.
- **How:** main types the text, then Enter 300 ms later (same as the autopilot's "continue"). A 30 s guard holds the next prompt until the session reports a new turn, so two prompts never go out back to back.
- **Never:** into Shell sessions, sleeping, exited or closed sessions; the queue never wakes a session.
- **UI:** a Queue tab in the side panel (add with Ctrl+Enter, Move up, Send now, Remove, state line) and a count chip on sidebar / Code / Hub cards.

### Suggested but not chosen (offer again only if relevant)
Prompt queue ("send when finished"), session presets, changes/diff panel per session (offered 2026-10-22, not picked), copy Remote Control link, broadcast a prompt to several sessions, per-session cost view, auto-reopen sessions on launch, search inside conversation history, fork a session, light theme, code signing, auto-update.

---

## How we work (standing rules)

**W01 · Cheap models first** · active
"next time i dont want to use expensive model, it make the quota burn too fast". Free, then flash, then `deepseek-v4-pro`. Expensive models only after a cheaper one failed twice, and say so. Never paid Zen `opencode/*` models without explicit approval.

**W02 · Claude orchestrates OpenCode workers** · active
Claude decides models, worker count and report format, with no approval needed before delegating; workers may do everything inside the project; every brief carries the user's coding standards. Small fixes Claude may just do itself.
2026-10-19: "i dont see you use opencode for do the work? why?" The bell (D22), D23 and D24 were built by Claude directly, which drifted from this rule. Feature implementation goes to OpenCode workers; Claude plans, briefs, verifies (unit + real-app e2e) and commits. Only genuinely tiny fixes are done directly.

**W03 · Plan first when the user asks for analysis** · active
"analyze for that feature first, and show me plan, dont changes any code yet". When asked for a plan, show it and wait for "go".

**W04 · Test it yourself, in the real app, before reporting** · active
"did u test the feature u just code?" Unit tests are not enough: run an e2e against the built app, and a real Claude/OpenCode run when the feature depends on one.

**W05 · Never skip a failing test** · active
"e2e-notes-usage fix this, why u skip it?" Find the root cause and fix it.

**W06 · Fix root causes, not guesses** · active
The first double-paste "fix" was a guess and the bug came back (D21). Reproduce first, then fix, then show the test going from failing to passing.

**W07 · Must work on any PC and any folder** · active
"or install this app in another pc, will the feature worK?" No machine-specific paths, no reliance on the user's own scripts or skills being present.

**W08 · Restart the app after a change** · active
"next time u can close and open yourself"; "restart the apps to make sure it use latest code". Relaunch SessionDeck so the user tests the latest build.

**W09 · Build the installer only when asked** · active
"only build the release when i ask for it". If it is stale, say so in one line.

**W10 · Commit after each finished feature** · active
"create git project and commit for me, for easy rollback". Conventional commits on `main`; the tag `baseline-2026-10-17` marks the first commit.

**W11 · Tests must not touch the user's real setup** · active
2026-10-18: a probe ran `/tui fullscreen` in a test Claude session and wrote the user's real `~/.claude/settings.json` (reverted). Test Claude sessions share the real config: never send state-changing slash commands into them; use a temp `--settings` file instead.

**W12 · Keep this knowledge base current** · active
"build knownledge for this project, to avoid forget what we decided". Every decision goes into this file in the same turn it is made; gotchas go into `docs/LESSONS.md`; state goes into `HANDOFF.md`.
2026-10-22: asked "do we have a knownledge hub for this project, for agent can check and get infomation?", then "yes" to adding `AGENTS.md` (entry point for OpenCode and other agents, points to CLAUDE.md) and `docs/CODEMAP.md` (folder-by-folder map).
2026-10-25: added `docs/FEATURES.md` after "can u build a docs that list all feature support by this app in a tree or matrix form? the goal is make the agent can easily check and get the info/logic/related code path of feature without mistake and fater". It is the feature tree + per-domain matrices (rules, code path, tests) plus IPC/storage/shortcut/settings/e2e maps and change recipes. Keep it in sync when a feature ships or its code path changes.

