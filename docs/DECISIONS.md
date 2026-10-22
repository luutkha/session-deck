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

**D09 · 2026-10-13 · No git worktrees** · rejected
Option 2 of that list was skipped on purpose and the user has repeated they do not want it. Do not propose or build worktree-per-session.

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

### Suggested but not chosen (offer again only if relevant)
Prompt queue ("send when finished"), session presets, copy Remote Control link, broadcast a prompt to several sessions, per-session cost view, auto-reopen sessions on launch, search inside conversation history, fork a session, light theme, code signing, auto-update.

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
