# SessionDeck handoff (updated 2026-10-13, end of the "all phases" round)

Read README.md (run/test), DESIGN.md (the Orca-style UI spec + decisions) and PLAN.md (original architecture). This file = current state.

## State: v1 feature-complete, Orca-style UI done, awaiting the user's first hands-on test round

Verification at the end of this round: 691 unit tests, strict typecheck clean, build clean, and these suites against the REAL built app (CDP):
`npm run e2e` (18: window shown, create/rename/status, real claude in a PTY, hooks -> attention, COLOUR present even with NO_COLOR in the launcher, close) · `e2e:close` (9: close/reopen/instant reopen/remove) · `e2e:resume` (6: kill app, relaunch, same conversation returns) · `e2e:dialogs` (9: New session + Statuses dialogs through real typing/clicks, unsafe args rejected) · `e2e:robust` (6: late/bogus IPC does not freeze main, malformed createSession rejected, last change saved on graceful quit). Visual review: `node scripts/e2e-visual.cjs` -> `scripts/visual/*.png` (11 states; compare with `reference/orca/docs/assets/readme-hero.jpg`).

## Added after the first hands-on feedback (2026-10-13)
1. **Custom sounds**: Settings > Sound. main no longer beeps; it sends `ev:sound` (sessionId, reason) and the renderer plays the user's choice (src/renderer/sound/*: 6 synthesized built-ins via WebAudio, custom audio file via file:// URL, volume, per-reason, localStorage key sessiondeck.sound.v1). Status-bar toggle shares the same store.
2. **Close really closes**: closing a tab / removing / restarting / quitting now kills the WHOLE process tree (src/main/pty/treeKiller.ts: taskkill /T /F while the parent is alive). Before, a command Claude had started (powershell/ping/dev server) survived. Verified at the OS level by `npm run e2e:busyclose`.
3. **Hub + status config**: Hub board (src/renderer/hub/*, nav item + pinned tab) and Settings > Statuses (reorder via IPC.statusReorder; order = Hub column order). The old StatusEditor dialog was removed.

## Added: usage + notes (2026-10-13, second feedback round)
- **Usage**: Claude Code pipes JSON to a `statusLine` command on every turn (rate_limits.five_hour/seven_day used_percentage + resets_at, cost.total_cost_usd, context_window.used_percentage, model.display_name). The attention settings file (`--settings <file>`, private to SessionDeck sessions) now also contains a throttled (10 s) bash+curl statusLine command that POSTs it to the local hook server (`POST /statusline/<sessionId>`, token-checked, 64 KB cap). Parsed in src/main/usage, sent to the renderer as `ev:usage`, shown by src/renderer/usage/UsageChips in the status bar; last account usage is cached in localStorage so the bars show right after a restart (stale). Note: a user-defined global statusLine is overridden for SessionDeck sessions.
- **Notes + checklist**: Session.notes / Session.checklist (validated in store, persistence drops invalid values instead of failing the file); src/renderer/notes (NotesPanel, debounced autosave, chips on cards); toggle button in the tab bar.
- Bugs caught by the e2e while building: startup usage reply from main (empty) erased the cached numbers (now merged).

## Usage reload button (manual, Orca approach)
- IPC.usageRefresh -> src/main/usage/usageRefresh.ts (single flight, 5 s floor, 429 cool-down honoring Retry-After) -> oauthUsage.ts: reads `<CLAUDE_CONFIG_DIR|~/.claude>/.credentials.json` (claudeAiOauth.accessToken) IN MAIN ONLY, GET https://api.anthropic.com/api/oauth/usage (Authorization Bearer, anthropic-beta oauth-2025-04-20, 10 s timeout), maps five_hour/seven_day, classifies 401/403 stale-token, 429 rate-limited, 5xx server, network, unavailable. The token is never sent over IPC, stored or logged (tests assert it is absent from errors/logs). The undocumented endpoint can change or rate-limit: it is manual only, never polled.
- UI: refresh icon at the end of the usage bars (also in the "waiting for a Claude turn" state), spinner, 8 s error text, first-use consent dialog (localStorage sessiondeck.usage.consent.v1). A successful refresh ALWAYS stamps updatedAt and notifies (UsageService.ingestAccount), even with identical numbers.
- Verified with a real request (`npm run e2e:usage-refresh`).

## What exists
- Sessions as real PTY terminals (xterm.js WebGL + node-pty ConPTY), statuses (user-defined), groups, attention (Claude Code hooks via `--settings <file>`; idle fallback; sound + taskbar flash), conversation restore (`--session-id`/`--resume`, lazy resume on select), tabs for open sessions, Closed section (closing a tab kills the process; resume later), group-by Groups|Status, search, filter, Orca look (Tailwind v4, shadcn primitives, Geist, Orca dark tokens measured from its hero screenshot), dialogs restyled.
- Main process safety nets: `<userData>/main-errors.log` (uncaught exceptions/rejections are logged, no blocking dialog), `<userData>/window-events.log` (window lifecycle), validated IPC, graceful quit flushes the store.

## Bugs found by running the real app (none were visible to unit tests) and fixed this round
window never shown (ready-to-show not firing with the hidden title bar) · sessions monochrome (NO_COLOR inherited from the launcher) · context menu at the window corner (Radix Slot passed its handler into a prop named onContextMenu with a different signature) · `#root` height lost when legacy CSS was removed · New session / Statuses dialogs never opened (App had a folder-picker-only path and a no-op handler) · typing into an exited session threw in main and froze the app behind a native error dialog · Ctrl+W stole readline's delete-word from the terminal (now Ctrl+W only outside the terminal, Ctrl+Shift+W anywhere).

## Not verified by a human / known gaps
- Sound and taskbar flash audibly/visually (code paths tested with fakes and the real hook path; shell.beep not heard).
- Drag-and-drop of cards/groups with a real mouse (pure logic tested; DnD events not simulated).
- Windows min/max/close overlay look (titleBarOverlay), light theme (dark only), packaging (electron-builder), app icon, auto-update: not started.
- xterm still shows small arrow buttons on its scrollbar track.
- Shortcuts: Ctrl+Shift+N = new session from anywhere (even in the terminal); plain Ctrl+N only outside the terminal (readline next-history stays with Claude); Ctrl+W closes the tab only outside the terminal, Ctrl+Shift+W anywhere; Ctrl+Tab cycles tabs.
- Code review round 2 done (main process: fixed; renderer: Ctrl+N in terminal, stacked dialogs, Closed list height, empty message, drag while renaming, Slot prop forwarding fixed; StatusRow draft kept on rejected save by design).

## How to work on it
Use the `opencode-orchestrator` skill (cost-first: deepseek-v4-flash / claude-haiku-5-5, caps via `-MaxCost`, check `opencode stats --days 1` first; Zen `opencode/*` paid models are blocked). Always verify with tests AND the e2e suites, and LOOK at screenshots for UI work. Close/relaunch the app yourself (`taskkill`, `npm run build`, start `node_modules\electron\dist\electron.exe .` with CLAUDE_CODE_* env removed).

## Batch 2 (2026-10-13): automation, quota guard, split panes, installer, tray
- Auto status: Claude hooks (UserPromptSubmit/Notification/Stop) post stdin JSON to `/hook/<id>/<Event>`; `activity` lives in RuntimeState; `decideAutoStatus` moves sessions (Settings > Automation; defaults working/waiting/review).
- Quota guard (src/main/quota): thresholds 80/95 of the 5h and weekly windows, once per window instance, reset notice, markers in `quota-markers.json`; renderer shows toasts + pace hint; Settings > Quota; sound key 'quota'.
- Hub cards show cost/context; header shows total cost.
- Split panes (src/renderer/split, Terminal/TerminalWorkspace): split right/down, drag/keyboard resize, max 4, layout in localStorage `sessiondeck.split.v1`.
- Tray + notifications + close-to-tray (src/main/tray, notify, app/closeToTray): default ON; Quit from tray or Settings > General. Start-on-login only works in the packaged app.
- Installer: `npm run icons`, `npm run dist` -> release/SessionDeck-Setup-0.0.1.exe (unsigned; SmartScreen warns). electron-builder needed the winCodeSign cache seeded without symlinks (copy an extracted `winCodeSign/<n>` dir to `winCodeSign-2.6.0`) because symlink creation needs Developer Mode.
- E2E: `npm run e2e:g1` (real Claude turn: auto status working->review, split, settings, close-to-tray), `npm run e2e:packaged` (unpacked exe). Known: a bare conhost.exe can outlive a closed session in the packaged app until quit; the check ignores it. CDP screenshots DO show the terminal (the earlier "black" caveat was wrong): check pixels, not only data.

## Batch 3 + 4 (2026-10-17): links, images, sleep, OpenCode, Remote Control
- Links: URLs, file and folder paths in the terminal are underlined when the target exists; click opens (Shift+click reveals). Executables/scripts are only revealed, UNC paths rejected (`src/main/links`).
- Input: image paste (Claude Alt+V, OpenCode Ctrl+V), dropped files paste their paths, double-paste guard (`pasteOnce`).
- Sound/attention: only Stop and Notification hooks ping; the idle-output detector is a no-op. Claude sessions always run yolo.
- Sleep: idle timer (Settings) plus manual Sleep/Wake; wake resumes the conversation. Per-session **Keep awake** flag (`Session.keepAwake`, right-click menu) exempts a session from the timer.
- OpenCode is a second agent (`Session.agent`): plugin injected through `OPENCODE_CONFIG_CONTENT` reports busy/idle/permission/cost; resume with `opencode -s <id>`; default agent and model in Settings, Agent dropdown in New Session.
- Remote Control: New Session checkbox adds `--remote-control`; the footer text `/rc active` is detected (`outputSignals.ts`) -> `RuntimeState.remoteControl`, RC badge, session auto-marked Keep awake. A prompt from any source clears pending attention; a question answered remotely returns the card to working when the spinner reappears.
- Resume fix: a session started but never prompted has no conversation; resuming fails ("No conversation found", then "already in use"). `shouldRotateSessionId` + `transcriptExists` give it a fresh Claude id (sessions with saved messages keep theirs).
- E2E scripts: `e2e-remote`, `e2e-keepawake`, `e2e-sleep`, `e2e-links`, `e2e-imagepaste`, `e2e-paste`, `e2e-opencode`. `e2e-notes-usage` restarts through `window.api.quitApp()` (a hard kill loses localStorage writes Chromium has not committed yet).
- Not rebuilt: the installer is stale (build only when the user asks).

## OpenCode worker tabs (read-only)
- A Claude session that starts OpenCode workers through the orchestrator skill (`oc-run`, which writes `<folder>/.opencode-runs/sessions/<name>.json` plus a JSONL log) now gets a read-only tab per worker after its own tabs.
- Main: `src/main/workers/` (`WorkerWatcher` polls the registry of each open session's folder, its 2 parents and its immediate subfolders every 1 s; `logParser` turns the JSONL into lines/cost/tokens; `registration` validates the file, the log must sit inside `.opencode-runs`). IPC: `workers:get` and `ev:workers`. Runs that ended before the app started are ignored.
- Renderer: `src/renderer/workers/` (`useWorkers`, `WorkerTabs`, `WorkerView`, `workerLogic`). Finished tabs close 2 min after ending unless being read; the X only hides the tab (the worker keeps running). Selecting any session or the Hub leaves the worker view.
- Not built (by choice): a real interactive OpenCode terminal (Phase 2: shared `opencode serve` + `opencode attach`), resume-from-tab.
- E2E: `scripts/e2e-workers.cjs` (8 checks).
