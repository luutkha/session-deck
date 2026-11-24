# SessionDeck feature reference

> **What this file is.** The complete feature inventory of SessionDeck, in tree + matrix form, built so an agent can go from "which feature?" to its rules, its code path and its tests in one lookup. It complements, and does not replace:
> - `docs/DECISIONS.md` - *why* a feature exists and what the user chose (D01-D54).
> - `HANDOFF.md` — the one-page current state, known gaps and history.
> - `docs/IMPLEMENTATION.md` — how to build a change (workflow, checklists, tests, definition of done).
> - `docs/CODEMAP.md` — folder-level map.
> - `docs/LESSONS.md` — mistakes already paid for.
>
> **Conflict rule.** Code wins over this file. If they disagree, trust the code, then fix this file in the same turn. Cite paths and exported symbols, never line numbers.

---

## 0. How to use this file

1. Find the feature in the **tree** (§1) to get its ID (`SES-6`, `USE-7`, …).
2. Open the **domain matrix** (§2) and read the `Rules` column before changing anything.
3. Follow `Code` for the real implementation and `Tests` for the proof that already exists.
4. Check the **cross-cutting maps** (§3) when the change touches IPC, storage, shortcuts, settings or e2e.
5. Follow `docs/IMPLEMENTATION.md` for the change itself (§4 points there); respect the **invariants** (§5).

**Status legend**

| Status | Meaning |
|---|---|
| `Shipped` | Implemented and covered by unit tests **and** a real-app e2e suite. |
| `Shipped (u)` | Implemented and unit-tested; no dedicated real-app e2e (or covered indirectly). |
| `Gap` | Implemented, but a known limitation or unverified path remains (see `HANDOFF.md`). |
| `Planned` | A plan exists, no code yet. |
| `Deferred` | Explicitly not built now; only on a new user request. |

A parenthetical after a status is a caveat, not a different status (e.g. `Shipped (packaged only)`).

**Conventions**

- `src/renderer` = renderer, `src/main` = Electron main, `src/shared` = the frozen contract.
- "Pure" means no React, DOM or IPC — the file is unit-testable in isolation.
- Per-mode keys: Ops uses the historical key, Code appends `.code` via `storageKeyFor` / `modeStorageKeys` (`renderer/mode/modeLogic.ts`).
- `Dnn` refers to an entry in `docs/DECISIONS.md`.

---

## 1. Feature tree

```
SessionDeck
├── SES  Sessions & lifecycle
│   ├── SES-1  Create session (Claude / OpenCode / Shell)
│   ├── SES-2  Rename session or group
│   ├── SES-3  Assign status
│   ├── SES-4  Groups (create / rename / delete / reorder / collapse)
│   ├── SES-5  Move session (group + index)
│   ├── SES-6  Close session (kill process, move to Closed)
│   ├── SES-7  Reopen session (resume conversation)
│   ├── SES-8  Remove session (delete from SessionDeck)
│   ├── SES-9  Sleep / wake
│   ├── SES-10 Keep awake
│   ├── SES-11 Restart exited PTY
│   ├── SES-12 Conversation restore across app restart
│   ├── SES-13 Active session / on-screen semantics
│   ├── SES-14 Busy-close process-tree safety
│   ├── SES-15 Prompt queue (send when finished)
│   ├── SES-16 Session presets
│   ├── SES-17 Resume running sessions on launch
│   ├── SES-18 Fork a Claude session
│   └── SES-19 Search past conversations
├── TRM  Terminal & input
│   ├── TRM-1  xterm panes, WebGL, replay + sequence gate
│   ├── TRM-2  PTY write / resize
│   ├── TRM-3  Copy / paste / right-click menu (D59)
│   ├── TRM-4  Image paste and file drop
│   ├── TRM-5  Clickable links (URL / file / folder)
│   ├── TRM-6  Terminal bell
│   ├── TRM-7  Split panes (2–4)
│   ├── TRM-8  Grid view (up to 6)
│   ├── TRM-9  Exited overlay + restart
│   ├── TRM-10 Terminal colours (NO_COLOR)
│   ├── TRM-11 Scrollback / reattach replay
│   ├── TRM-12 Terminal search (Ctrl+Shift+F)
│   └── TRM-13 File viewer in the side panel (click a path) (D73)
├── NAV  Sidebar & organisation
│   ├── NAV-1  Session cards and run/agent indicators
│   ├── NAV-2  Search and status filter
│   ├── NAV-3  Group by Group | Status
│   ├── NAV-4  Workspace buckets inside groups
│   ├── NAV-5  Closed section
│   ├── NAV-6  Drag and drop
│   ├── NAV-7  Inline rename
│   ├── NAV-8  Context menus
│   ├── NAV-9  Keyboard navigation
│   ├── NAV-10 Status view
│   ├── NAV-11 Bulk selection and actions (sidebar + Hub)
│   ├── NAV-12 Sort sessions (D61)
│   └── NAV-13 Adjustable sidebar width (D70)
├── ATT  Attention & alerts
│   ├── ATT-1  Claude hook pipeline
│   ├── ATT-2  Attention reasons and priority
│   ├── ATT-3  Bell UI (card / tab / Hub / header)
│   ├── ATT-4  Needs-you list
│   ├── ATT-5  Notification sounds
│   ├── ATT-13 Keyboard triage (next / previous session that needs you)
│   ├── ATT-6  Taskbar flash
│   ├── ATT-7  Desktop notifications
│   ├── ATT-8  Tray menu
│   ├── ATT-9  Close to tray
│   ├── ATT-10 Idle-output detector (no-op by design)
│   └── ATT-11 Sound relay (main never beeps)
├── HUB  Hub board
│   ├── HUB-1  Status columns + "No status"
│   ├── HUB-2  Drag card to change status
│   ├── HUB-3  Open session from a card
│   ├── HUB-4  Card metadata (cost / context / notes / bell)
│   ├── HUB-5  Header total cost
│   └── HUB-6  Scroll to busiest column
├── TAB  Tabs, views & panels
│   ├── TAB-1  Open tabs and restore
│   ├── TAB-2  Per-folder tab bar
│   ├── TAB-3  Tab shortcuts
│   ├── TAB-4  Terminal | Hub view (per mode)
│   ├── TAB-5  Notes | Activity side panel
│   ├── TAB-6  Worker tabs (see WRK)
│   └── TAB-7  View changes in the tab menu (D82)
├── NTS  Notes & checklist
│   ├── NTS-1  Free-text notes (autosave)
│   ├── NTS-2  Checklist
│   ├── NTS-3  Progress chip
│   ├── NTS-4  Parse steps from notes
│   └── NTS-5  Draft preservation
├── USE  Usage & quota
│   ├── USE-1  statusLine ingestion
│   ├── USE-2  Usage chips (account + session)
│   ├── USE-3  Cached usage after restart
│   ├── USE-4  Manual usage refresh + consent
│   ├── USE-5  Quota guard thresholds
│   ├── USE-6  Quota toasts and pace hint
│   ├── USE-7  Autopilot: sleep at critical level
│   ├── USE-8  Autopilot: wake at reset (+ "continue")
│   ├── USE-9  Held-for-reset chip
│   ├── USE-10 Usage-limit detection
│   ├── USE-11 Hands-off defaults, migration, failure notice
│   └── USE-12 Multi-provider quota bars (Claude + OpenCode Go)
├── AUT  Automation & sleep
│   ├── AUT-1  Auto status from activity
│   ├── AUT-2  Per-session idle sleep
│   ├── AUT-3  Sleep everything when idle
│   ├── AUT-4  User-input / away detection
│   └── AUT-5  Scheduler tick
├── TML  Timeline & away summary
│   ├── TML-1  Turn recording
│   ├── TML-2  Turn cost and settling
│   ├── TML-3  Timeline persistence
│   ├── TML-4  Activity tab
│   ├── TML-5  Away detection
│   ├── TML-6  "While you were away" summary
│   └── TML-7  Cost over time (report + per-session strip)
├── AGT  Agents
│   ├── AGT-1  Claude Code
│   ├── AGT-2  OpenCode
│   ├── AGT-3  Shell
│   ├── AGT-4  Remote Control
│   └── AGT-5  Agent badge
├── COD  Code mode (worktrees)
│   ├── COD-1  Ops | Code separation
│   ├── COD-2  Add repository
│   ├── COD-3  Repo tree (collapse / remove)
│   ├── COD-4  Create worktree
│   ├── COD-5  Worktree location setting
│   ├── COD-6  Remove worktree
│   ├── COD-7  Changes list
│   ├── COD-8  File diff
│   ├── COD-9  Changes refresh cadence
│   ├── COD-10 Pop-out Code window
│   ├── COD-11 Opt-in trust-prompt auto-answer
│   ├── COD-12 Commit (D60)
│   ├── COD-13 Branch line + Push (D60)
│   ├── COD-14 Create PR (D60)
│   ├── COD-15 Merge into base (D60)
│   ├── COD-16 Delete a worktree from disk (D60)
│   └── COD-17 Detach the Changes panel (D83)
├── WIN  Windows, tray & app lifecycle
│   ├── WIN-1  Main window
│   ├── WIN-2  Second Code window
│   ├── WIN-3  Quit
│   ├── WIN-4  Start on login
│   ├── WIN-5  Focus a session from outside
│   ├── WIN-6  Error / window logs
│   └── WIN-7  Navigation guard
├── SET  Settings & persistence
│   ├── SET-1  Settings dialog sections
│   ├── SET-2  Settings validation and defaults
│   ├── SET-3  Store durability
│   ├── SET-4  Invalid stored data
│   └── SET-5  UI preferences (localStorage)
├── PAL  Command palette
│   ├── PAL-1  Open shortcuts
│   ├── PAL-2  Items and groups
│   ├── PAL-3  Filtering and ranking
│   └── PAL-4  Command execution and focus return
├── JRV  Jarvis (AI that controls the app)
│   ├── JRV-1  Jarvis session + right-side panel (Ops and Code, Ctrl+Shift+J, tab-bar button, palette)
│   ├── JRV-2  MCP tool server (local, token, only for Jarvis)
│   ├── JRV-3  Tools (see / lifecycle / prompts / organize)
│   ├── JRV-9  App-wide tools (settings, queue, checklist, groups, statuses, presets, bulk, quota, costs, Code extras)
│   ├── JRV-10 Screen tools (mode, view, grid, split, sidebar, side panel, dialogs, zoom, worker tabs)
│   ├── JRV-11 The rest of the app (sounds, sidebar list, Code tree, file on screen, search, tabs, files, links, window, restart) (D58)
│   ├── JRV-12 Git tools: branch status, commit, push, pull request, merge, delete from disk (D60)
│   ├── JRV-13 Tuning for the PC (system info, GPU, terminal, sidebar and Jarvis panel settings)
│   ├── JRV-4  Confirm before destructive tools
│   ├── JRV-5  Jarvis engine + model settings (Claude or OpenCode)
│   ├── JRV-6  Scheduled instructions
│   ├── JRV-7  Undo
│   └── JRV-8  Voice (talk to Jarvis, read replies aloud)
├── WRK  OpenCode worker tabs
│   ├── WRK-1  Worker plugin injection
│   ├── WRK-2  Worker events and heartbeat
│   ├── WRK-3  Worker hub limits
│   ├── WRK-4  Worker tabs and view
│   └── WRK-5  Worker limitations
└── SEC  Robustness & security
    ├── SEC-1  IPC validation
    ├── SEC-2  Hook server token and caps
    ├── SEC-3  Credentials stay in main
    ├── SEC-4  Process-tree kill
    └── SEC-5  Test isolation from the real setup
```

### 1.1 Domain quick index

| Domain | Start here (pure rules first) | Main-process side |
|---|---|---|
| SES | `renderer/Sidebar/dialogLogic.ts` | `main/app/sessionController.ts` |
| TRM | `renderer/Terminal/useTerminalPanes.ts`, `split/splitLogic.ts` | `main/pty/PtyManager.ts` |
| NAV | `renderer/state/selectors.ts`, `Sidebar/uiLogic.ts` | `main/store/reducers.ts` |
| ATT | `renderer/attention/needsYou.ts` | `main/attention/AttentionService.ts` |
| HUB | `renderer/hub/hubLogic.ts` | — (renderer only) |
| TAB | `renderer/shell/openTabsLogic.ts` | — (renderer only) |
| NTS | `renderer/notes/checklistLogic.ts` | `main/store/sessionNotes.ts` |
| USE | `renderer/usage/usageLogic.ts` | `main/usage/UsageService.ts`, `main/quota/*` |
| AUT | `main/sleep/sleepPolicy.ts` | `main/automation/autoStatus.ts`, `main/sleep/SleepScheduler.ts` |
| TML | `main/timeline/awaySummary.ts` | `main/timeline/timelineService.ts` |
| AGT | `main/app/startOptions.ts` | `main/opencode/*`, `main/attention/*` |
| COD | `renderer/code/sidebar/codeTree.ts` | `main/git/*`, `main/app/codeWiring.ts` |
| WIN | `renderer/mode/modeLogic.ts` | `main/app/windowRegistry.ts` |
| SET | `shared/types.ts` (`DEFAULT_APP_SETTINGS`) | `main/store/settings.ts`, `main/store/persistence.ts` |
| PAL | `renderer/palette/paletteItems.ts` | — (renderer only) |
| JRV | `renderer/jarvis/jarvisLogic.ts`, `main/jarvis/targets.ts` | `main/jarvis/jarvisWiring.ts`, `jarvisTools.ts`, `mcpHttpServer.ts` |
| WRK | `renderer/workers/workerLogic.ts` | `main/workers/WorkerHub.ts` |
| SEC | — | `main/app/ipcValidation.ts`, `main/attention/HookServer.ts` |

---

## 2. Feature matrices

### 2.1 SES — Sessions & lifecycle

| ID | Feature | Status | Trigger / entry | Rules (must-know) | Code | Tests |
|---|---|---|---|---|---|---|
| SES-1 | Create session | Shipped | New Session dialog; `Ctrl+Shift+N` anywhere, `Ctrl+N` outside the terminal | Folder required and must be an existing directory (`validateCwd`); name optional, defaults to the folder's last segment (`defaultNameFromFolder`), 1–100 chars; group/status optional; agent `claude` \| `opencode` \| `shell`; Claude args are validated as safe CLI tokens; OpenCode model optional (≤200 chars, `A-Za-z0-9._:/@+-`); Remote Control checkbox appends `--remote-control` last; dialog opens in the last used folder. Main creates the store entry, then starts the PTY. | `renderer/Sidebar/dialogLogic.ts` → `buildCreateInput`, `initialFolder`; `main/app/startOptions.ts` → `buildStartOptions`; `main/app/sessionController.ts`; `main/store/reducers.ts` → `createSession` | `dialogLogic.test.ts`, `reducers.test.ts`, `sessionController.test.ts`, `startOptions.test.ts`; e2e `e2e.cjs`, `e2e:dialogs`, `e2e:lastfolder` |
| SES-2 | Rename session / group | Shipped | Double-click or `F2` on a card / group header | Inline editor; `Enter` commits, `Esc` cancels; trimmed; 1–100 chars; main re-validates. Renaming never starts or wakes a session (D45). Group rename follows the same rule. | `renderer/Sidebar/InlineEdit.tsx`, `inlineEditValidation.ts`; `main/store/reducers.ts` → `renameSession`, `renameGroup` | `inlineEditValidation.test.ts`, `reducers.test.ts`; e2e `e2e.cjs` |
| SES-3 | Assign status | Shipped | Card context menu, palette "Set status", Hub drag | Statuses are user-defined `{id,name,color}`; `null` = No status; deleting a status clears it from every session; status order = Hub column order. | `renderer/Sidebar/SessionContextMenu.tsx`; `main/store/reducers.ts` → `upsertStatus`, `removeStatus`, `reorderStatuses` | `reducers.test.ts`, `statusOrder.test.ts`; e2e `e2e.cjs`, `e2e:hub` |
| SES-4 | Groups | Shipped | Sidebar "New group", group context menu, drag | Create (default name `New group`), rename, delete (sessions become ungrouped), reorder, collapse; group array order drives the sidebar; deleting never deletes sessions. | `renderer/Sidebar/GroupSection.tsx`, `GroupContextMenu.tsx`; `main/store/reducers.ts` → `createGroup`, `removeGroup`, `reorderGroups`, `setGroupCollapsed` | `reducers.test.ts`; e2e `e2e.cjs` |
| SES-5 | Move session | Shipped | Drag a card, "Move to group", palette | Moves to `(groupId, index)`; target order renormalised; a moved session keeps its status/notes/attention. | `renderer/state/dropTarget.ts`; `main/store/reducers.ts` → `moveSession` | `dropTarget.test.ts`, `reducers.test.ts` |
| SES-6 | Close session | Shipped | Tab `×`, context menu "Close session" | Kills the **whole** process tree, marks `closedAt`, moves the card to **Closed**; a closed session has no PTY and cannot be typed into; attention is forgotten; closing is not deleting. | `main/app/sessionController.ts` → `closeSession`; `main/pty/treeKiller.ts`; `main/store/reducers.ts` → `closeSession` | `sessionController.test.ts`, `treeKiller.test.ts`; e2e `e2e:close`, `e2e:busyclose` |
| SES-7 | Reopen session | Shipped | Closed section "Reopen", palette | Clears `closedAt` and starts again with `--resume` (Claude) / `-s` (OpenCode); a session that was started but never prompted has no conversation, so it gets a fresh Claude id (`shouldRotateSessionId` + `transcriptExists`); an immediate reopen is retried while the old process is still stopping. | `main/app/sessionController.ts` → `reopenSession`; `main/app/claudeLaunch.ts`; `main/app/transcript.ts`; `main/app/retryWhileStopping.ts` | `claudeLaunch.test.ts`, `transcript.test.ts`, `retryWhileStopping.test.ts`; e2e `e2e:close` |
| SES-8 | Remove session | Shipped | Context menu "Remove session", Closed "Delete" | Confirmation dialog; kills the process, deletes the store entry, renormalises the group order, forgets attention/workers/timeline. Files on disk are untouched. | `main/app/sessionController.ts`; `main/store/reducers.ts` → `removeSession`; `renderer/Sidebar/ConfirmDialog.tsx` | `reducers.test.ts`; e2e `e2e:close` |
| SES-9 | Sleep / wake | Shipped | Context menu Sleep/Wake, palette, idle timer, sleep-all, quota autopilot | Stops the process but keeps the card, status, notes and conversation; waking resumes the same conversation; a sleeping session keeps its bell (D27); Shell sessions are **never** auto-slept; closed sessions cannot sleep. | `main/app/sessionController.ts` → `sleepSession` / `wakeSession`; `main/sleep/sleepPolicy.ts`; `main/sleep/sleepAllPolicy.ts` | `sleepPolicy.test.ts`, `sleepAllPolicy.test.ts`, `sessionController.sleep.test.ts`, `sleepKeepsBell.test.ts`; e2e `e2e:sleep`, `e2e:sleepall`, `e2e:sleepbell` |
| SES-10 | Keep awake | Shipped | Card context menu, palette toggle | Per-session `Session.keepAwake`; exempts the session from the idle timer, sleep-all and quota autopilot; shows a badge; persists; Remote Control sessions are auto-marked. | `main/store/reducers.ts` → `setKeepAwake`; `renderer/Sidebar/SessionContextMenu.tsx` | `reducers.test.ts`; e2e `e2e:keepawake` |
| SES-11 | Restart exited PTY | Shipped | Exited overlay "Restart", pane header | Starts a new process for the same session; conversation resumes if one exists; restarting never creates a second session. | `renderer/Terminal/TerminalPane.tsx`; `main/app/sessionController.ts` → `restartSession` | `sessionController.test.ts`; e2e `e2e.cjs` |
| SES-12 | Conversation restore across app restart | Shipped | App relaunch; select a session | Stored `claudeSessionId` / `opencodeSessionId`; sessions come back `exited` and resume **lazily** when selected; the same conversation returns. | `main/store/persistence.ts`; `main/app/sessionController.ts`; `main/app/startOptions.ts` | `persistence.test.ts`, `startOptions.test.ts`; e2e `e2e:resume` |
| SES-13 | Active session / on-screen semantics | Shipped | Selecting a session, focusing a pane/cell | Renderer tells main which session is on screen per window role (`session:setActive`); attention is cleared on focus/input; sound, flash and desktop notice are suppressed for a session on screen in ANY open window **but the bell is still recorded**; sleep policy spares every such session. Docking/closing the Code window clears its role (no ghost on-screen ids). | `renderer/state/useSessionStore.ts`; `main/app/activeSessions.ts`, `windowRegistry.ts`; `main/index.ts` → `onScreenSessionIds` / `isSessionOnScreen` | `activeSessions.test.ts`, `windowRegistry.test.ts`, `sleepPolicy.test.ts`; e2e `e2e-bell`, `e2e:sleep` |
| SES-18 | Fork a Claude session | Shipped | Session right-click "Fork session" (sidebar + Code); palette "Fork <name>" | Claude sessions only. A new session "<name> (fork)" in the same folder, group, worktree and args (no status) whose FIRST start is `claude --resume <parent> --fork-session --session-id <new>` (verified with Claude Code 2.1.316: the fork has the history, the parent transcript is untouched); later starts resume the new id. Refused with "Nothing to fork yet…" when the parent has no saved conversation (`transcriptExists`). The fork opens in a tab (`nav.openCreated`). | `main/app/claudeLaunch.ts` (`forkFrom`), `startOptions.ts`, `sessionController.forkSession`; `renderer/Sidebar/SessionContextMenu.tsx`; `mode/useWorkspaceCommands.ts` → `forkSession` | `claudeLaunch.test.ts`, `sessionController.sleep.test.ts`, palette tests; e2e `e2e-fork-search-real.cjs` |
| SES-19 | Search past conversations | Shipped | Palette "Search conversations" | Read-only search in `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/*/<claudeSessionId>.jsonl` of SessionDeck's Claude sessions: typed user text and assistant text parts (tool calls/results, meta lines and slash-command echoes skipped); case-insensitive; 2..200 chars; ≤20 hits per session, ≤200 total, newest first, excerpt ±60 chars with the match highlighted; files >50 MB skipped; parsed transcripts cached by size + mtime. A hit opens its session. OpenCode conversations are not searched (v1). | `main/transcripts/conversationSearch.ts`; `main/app/ipcHandlers.ts`; `renderer/search/ConversationSearchDialog.tsx` | `conversationSearch.test.ts`; e2e `e2e-fork-search-real.cjs` |
| SES-17 | Resume running sessions on launch | Shipped | App launch (`launch.resumeRunning`, default on) | Sessions that were running (awake, not closed) at quit or crash start again in the background with `--resume`, 400 ms apart, after the hook server is up; closed / sleeping / exited ones stay stopped; tabs and the active session are untouched; opening one right after never starts a second process. The list `<userData>/resume-on-launch.json` follows every run change (1 s debounce) and is saved first in shutdown (before the kills); pending staggered starts are kept on a quick quit. Off = the D03 lazy start on select. | `main/app/launchResume.ts`; `sessionController.resumeInBackground`; `main/index.ts`; `renderer/settings/GeneralSection.tsx` | `launchResume.test.ts`, `sessionController.sleep.test.ts`, `settings.test.ts`; e2e `e2e-resume-launch.cjs` (9), `e2e:resume` (lazy path, switch off) |
| SES-16 | Session presets | Shipped | New Session dialog **Presets** menu / **Save as preset**; palette "New session: <preset>" | `StoreData.presets` (max 30; name 1..60; folder, agent, OpenCode model, Claude args incl. `--remote-control`, group, status). Save as preset stores the current form (name suggested from the session name or folder; same name, any case, replaces). Picking a preset fills the form; a deleted group/status is left empty. The palette item (Ops mode only) creates the session in one step and opens it. Delete through the menu's "Delete a preset". Stored presets are shape-checked on load (invalid ones dropped, deleted group/status → null); session:create re-applies the Claude argument safety rule. | `main/store/presets.ts`; `main/app/ipcValidation.ts` → `asPreset`; `renderer/presets/presetLogic.ts`, `PresetMenu.tsx`; `Sidebar/NewSessionDialog.tsx`; `palette/paletteItems.ts`, `runCommand.ts`; `mode/useWorkspaceCommands.ts` | `presets.test.ts`, `presetLogic.test.ts`, `paletteItems.test.ts`, `runCommand.test.ts`; e2e `e2e-presets.cjs` (11) |
| SES-15 | Prompt queue (send when finished) | Shipped | Side panel > **Queue** tab; chip on cards | `Session.queue` (max 20 prompts, 1..4000 chars, saved in the store). When the session's activity turns `finished` (Claude Stop hook / OpenCode plugin Stop) main types the FIRST prompt (an idle session that only got Claude's "waiting for your input" reminder counts as finished, D54 fix), then a separate Enter 300 ms later; one prompt per finished turn. Adding a prompt to an idle (`finished`) session sends it at once. After a send nothing else goes out until the session reports a new turn (working / needs-input) or 30 s pass. Never types into Shell, sleeping, exited or closed sessions (and never wakes them). "Send now" types one prompt immediately (running, awake session) and removes it. Move up / Remove edit the order. CR/CRLF become LF so only the Enter submits. | `main/queue/promptQueue.ts`; `main/store/sessionNotes.ts` → `validateQueue`, `setSessionQueue`; `main/app/ipcHandlers.ts`; `renderer/queue/QueuePanel.tsx`, `queueLogic.ts`; `notes/NotesPanel.tsx`, `ChecklistChip.tsx` | `promptQueue.test.ts`, `queueLogic.test.ts`, `sessionNotes.test.ts`, `persistence.notes.test.ts`; e2e `e2e-queue.cjs` (fake claude, 17), `e2e-queue-real.cjs` (real Claude, 6) |
| SES-14 | Busy-close process-tree safety | Shipped | Close a session while a command runs | `taskkill /T /F` while the parent is alive; no orphan shell/dev-server survives; verified at OS level. | `main/pty/treeKiller.ts` | `treeKiller.test.ts`; e2e `e2e:busyclose` |

### 2.2 TRM — Terminal & input

| ID | Feature | Status | Trigger / entry | Rules (must-know) | Code | Tests |
|---|---|---|---|---|---|---|
| TRM-1 | xterm panes, WebGL, replay | Shipped | Any visible session | **One xterm instance per session**, mounted for the session's whole life, hidden via CSS when not visible (scrollback survives); WebGL with a DOM fallback on context loss; live data is one subscription dispatched by id; replay buffer + `seq` gate drops stale live chunks after a reattach. | `renderer/Terminal/useTerminalPanes.ts`, `paneFactory.ts`, `seqGate.ts`; `main/pty/RingBuffer.ts` | `seqGate.test.ts`, `terminalOptions.test.ts`, `RingBuffer.test.ts`, `pty.test.ts` |
| TRM-2 | PTY write / resize | Shipped | Typing, pane resize, split/grid layout | Renderer sends `pty:write` / `pty:resize`; initial geometry 120×30; `fit` is event-driven after layout changes; writing to a stopped session is rejected safely. | `renderer/Terminal/TerminalPane.tsx`; `main/pty/PtyManager.ts`; `main/app/startOptions.ts` (`INITIAL_COLS`, `INITIAL_ROWS`) | `PtyManager.test.ts`, `ipcValidation.test.ts`; e2e `e2e:robust` |
| TRM-3 | Copy / paste / right-click menu (D59) | Shipped | `Ctrl+C`, `Ctrl+Shift+C`, `Ctrl+V`, right-click | `Ctrl+C` with a selection copies, without one sends `^C`; `Ctrl+Shift+C` always copies; `Ctrl+V` / `Ctrl+Shift+V` paste. Right-click (D59, like Orca) opens the terminal menu at the pointer: Copy (disabled without a selection), Select All, Paste, Find…, Fork Session (Claude with a saved conversation, not Jarvis), Split Terminal Right / Down (terminal view, `split.canSplit`), Close Pane (pane in a split), Copy Folder Path (session cwd), Clear Screen (`term.clear()`); the clicked pane becomes active first; every row gives the terminal its focus back (Find focuses the search bar). Escape closes it (the 100 ms opening guard is only on the outside click). Settings > Terminal > Right-click: "Show menu" (default) or "Copy / paste" (copies the selection else pastes; Ctrl+right-click = menu), renderer-only `sessiondeck.rightclick.v1`, read at click time. The right mouse button is **never** reported to the program (Claude's fullscreen mouse mode would paste it twice); every paste goes through `pasteOnce`. **D76:** right-clicking a detected link (file, folder, URL; paths with spaces/accents too) puts link rows at the TOP of the menu, under a small header naming the target, then a separator and the rows above unchanged: a file the viewer knows = Open in Side Panel / Open in Default App / Show in Explorer / Copy Path; any other file = Open in Default App / Show in Explorer / Copy Path; a folder = Open Folder / Copy Path; a URL = Open in Browser / Copy Link (Copy Path copies the absolute path main resolved). The link is the one xterm last reported as hovered (`links/hoveredLink.ts`), cleared when the pointer leaves it, so no stale rows; in the quick copy/paste mode only Ctrl+right-click shows the menu (and the link rows). | `renderer/Terminal/keymap.ts` → `decideKeyAction`, `isRightButton`, `decideRightClick`; `rightClickPref.ts`; `paneFactory.ts` (`onContextMenu`); `TerminalContextMenu.tsx`, `useTerminalMenu.ts`, `terminalMenuLogic.ts`; `mode/ModeWorkspace.tsx`; `settings/TerminalSection.tsx` | `keymap.test.ts`, `terminalMenu.test.ts`; e2e `e2e:termmenu`, `e2e:paste`, `e2e:imagepaste` |
| TRM-4 | Image paste and file drop | Shipped | Paste an image, drop files on a pane | Claude receives the image through its own paste path (Alt+V), OpenCode through Ctrl+V; dropped files paste their absolute paths; a double-paste guard ensures exactly one paste. | `renderer/Terminal/inputExtras.ts`, `dropPaths.ts`; `renderer/Terminal/paneFactory.ts` → `pasteOnce` | `dropPaths.test.ts`; e2e `e2e:imagepaste` |
| TRM-5 | Clickable links | Shipped | Hover/click a URL, file or folder in the terminal | Underlined only when the target exists (relative paths resolved against the session cwd); click opens (URL → browser, file → default app, folder → Explorer; a file the viewer knows opens the side-panel Preview instead, Ctrl+click = default app, TRM-13); `Shift+click` reveals; executables/scripts are only revealed; UNC paths rejected; main re-resolves and never trusts the renderer. **D75:** unquoted paths with spaces or accented/non-Latin letters are links too: letters of any script stay inside a token, and for every word ending in a file extension the provider also tries the 1-6 words before it (single spaces only) as ALTERNATIVES, asks main which exist and keeps the LONGEST that does (`spacedPaths.ts`, `linkChoice.ts`), so `C:\Users\Me\Báo cáo tháng 10.pdf` and a relative `docs/Báo cáo.md` underline and click like any other path (quoted paths already worked). **D77:** a link's underline and click area are computed from the terminal's CELLS (`links/lineCells.ts`): a wide (CJK, emoji) character takes two columns and a combining mark none, so a link after or inside such text is no longer shifted or cut short; the keyboard Menu key never picks up a stale hovered link. | `main/links/LinkService.ts`, `linkText.ts`; `renderer/Terminal/links/detectLinks.ts`, `linkCache.ts` | `LinkService.test.ts`, `linkText.test.ts`, `detectLinks.test.ts`, `linkCache.test.ts`; e2e `e2e:links` |
| TRM-6 | Terminal bell | Shipped | Program emits BEL | Raises attention reason `bell` (priority 1); sound/flash follow the user's sound settings; the bell is silent for an `unread` flag. | `main/attention/AttentionService.ts`; `main/attention/AttentionManager.ts` | `AttentionManager.test.ts`, `AttentionService.test.ts`; e2e `e2e-bell` |
| TRM-7 | Split panes | Shipped | Tab bar split-right / split-down; divider drag / keyboard | 2–4 panes (`MAX_PANES = 4`), row or column; no duplicate sessions; sizes sum to 1, min fraction 0.15; drag or arrow keys resize, `Enter` equalises; layout persisted per mode (`sessiondeck.split.v1` / `.code`). | `renderer/split/splitLogic.ts` (pure), `useSplitLayout.ts`, `Terminal/TerminalWorkspace.tsx`, `SplitDivider.tsx` | `splitLogic.test.ts`, `useSplitLayout.test.ts`; e2e `e2e:g1` |
| TRM-8 | Grid view | Shipped | Tab bar **Grid ▾** (1x1, 2x1, 1x2, 2x2, 2x3, 3x2), palette "Open grid view"; leave: the **X** next to the grid icon, **Grid ▾ > Exit grid**, palette "Exit grid view" (D55) | Leaving keeps the layout for next time and puts the focused cell's session on screen. Every cell is a fully interactive terminal; max 6 cells; one session per cell (picking a visible session MOVES it, the occupant takes its old cell); empty cells show a picker with no auto-fill; open sessions only; a shrink keeps overflow ids in memory and restores them when a bigger preset fits; Ops and Code keep separate grids (`sessiondeck.grid.v1` + `.code`). ONE host element per xterm: `TerminalWorkspace` draws the grid itself. | `renderer/grid/gridLogic.ts`, `useGridLayout.ts`, `GridCells.tsx`, `GridCellHeader.tsx`; `Terminal/TerminalWorkspace.tsx`; `mode/ModeWorkspace.tsx` | `gridLogic.test.ts`, `useGridLayout.test.ts`; e2e `e2e:grid` |
| TRM-9 | Exited overlay + restart | Shipped | Process exits | Overlay shows the exit code; Restart starts a new process; no typing into an exited session (main rejects it). The same exit code labels the tab tooltip and the Hub card dot (`Exited (N)`) for every agent. | `renderer/Terminal/TerminalPane.tsx`; `renderer/shell/tabStatus.ts`; `renderer/hub/hubLogic.ts`; `main/app/sessionController.ts` | `sessionController.test.ts`, `sessionController.opencode.test.ts`, `tabStatus.test.ts`, `hubLogic.test.ts`; e2e `e2e:robust` |
| TRM-10 | Terminal colours | Shipped | Any Claude session | The launcher strips inherited `NO_COLOR` so Claude keeps colour even when SessionDeck was started from a colourless shell. | `main/pty/launch.ts` | `launch.test.ts`; e2e `e2e.cjs` |
| TRM-11 | Scrollback / reattach replay | Shipped | Switch tabs, split, sleep/wake, app restart | Ring buffer replays recent output on reattach; `PtyReplay.seq` marks the last included chunk; hidden panes keep their xterm and scrollback. | `main/pty/RingBuffer.ts`; `renderer/Terminal/useTerminalPanes.ts`, `seqGate.ts` | `RingBuffer.test.ts`, `seqGate.test.ts` |
| TRM-12 | Terminal search | Shipped | `Ctrl+Shift+F` (terminal + grid view) | One `@xterm/addon-search` provider per pane; the bar searches the pane that was active when it opened (visible pane only, v1) and closes on a tab/view change. Typing highlights all matches and the active one; count shows `n/total` or "No matches"; `Enter` / `Shift+Enter` cycle; `Esc` closes, clears decorations and refocuses the terminal. Plain `Ctrl+F` still reaches the program. The scrollbar arrow buttons are hidden, thumb colours unchanged. | `renderer/Terminal/paneFactory.ts` → `searchAddon`; `useTerminalSearch.ts`; `searchLogic.ts`; `TerminalSearchBar.tsx`; `keymap.ts`; `Terminal.css` | `searchLogic.test.ts`, `keymap.test.ts`; e2e `e2e:termview` |
| TRM-13 | File viewer in the side panel (D73) | Shipped | Plain click on a file path in a terminal; Preview tab of the side panel | The link provider asks `decideLinkClick`: a plain click on a file whose extension `fileViewKindFor` knows (md, txt/log/json/yaml, png/jpg/jpeg/gif/webp/bmp/svg/ico/avif, csv/tsv, xlsx/xlsm, docx/docm/dotx, pdf; never legacy .xls/.doc, programs or archives) goes to `requestFileView` (renderer bus), the workspace opens the side panel on a **Preview** tab and loads it; Ctrl/Meta+click opens the file in its default app, Shift+click reveals, folders/URLs/other files keep the old click. Main (`readFileView`, via `file:viewRead`) re-resolves the link text with `LinkService` (cwd, `~`, UNC refused), reads at most the caps in `FILE_VIEW_*` (text 1 MB cut at a line break, image 10 MB refused over the cap, xlsx/docx 20 MB refused over the cap, csv/xlsx 2000 rows x 50 columns x 20 sheets), converts csv (own RFC-4180 parser), xlsx (`read-excel-file`, legacy .xls not supported) and docx (`mammoth`, images dropped), and returns a `FileView`; the renderer never touches the disk. Docx HTML is sanitized in the renderer (DOMPurify strict allow-list + a second allow-list pass; links only open http(s) through the app's link pipeline). `FileViewPane` shows markdown, text, image (Fit / 100%), tables with sheet tabs and column letters, and a footer (name, kind, size, cut note). The panel is resizable (drag its left edge, arrows, Home/End, double-click resets; 280-1000 px, default 320, widened once to 520 on the first preview; saved in `sessiondeck.sidePanelWidth.v1`; the terminal keeps >= 420 px). Detach (`file:viewDetach`) opens the same file in its own small window (`createMainWindow({ viewer })`, request in the launch argument `--sessiondeck-viewer=`, renders only `ViewerWindow`, not registered in the window registry). **D74:** live reload (the open preview stats the file every 2 s through `file:viewStat` while visible; a changed mtime/size re-reads silently, a deleted file keeps its content with a "File no longer exists" notice); header buttons Copy path / Open in default app / Show in Explorer; text decoding by BOM, NUL sniff for UTF-16 and a windows-1252 fallback (`encoding.ts`); find in preview (Ctrl+F in the pane: text, markdown, docx, ALL rows of a table); zoom (images 10-800%, Ctrl+wheel; text/markdown/docx/tables 70-200%, saved in `sessiondeck.fileview.zoom.v1`); tables: sticky header, first-row-is-header toggle (csv on), sort by column, 200 rows per page, draggable column widths, a note saying which side was cut; more ways to open a preview: drop a file on the side panel, palette **Preview file...** (`dialog:pickViewFile`), an eye button on Changes rows (Code mode, worktree sessions), Jarvis tool `preview_file` (86 tools in all). **D75:** PDF files (`pdf.js` legacy build, lazy-loaded, drawn on canvases page by page; fit-to-width, zoom, page indicator; main refuses a non-PDF; a PDF up to 30 MB is sent whole, a bigger one (up to 1 GB) is NOT loaded: main answers `streamed` with no bytes and pdf.js reads byte ranges through `file:viewRange` (`readPdfRange`, at most 8 MB per call; first page of a 60 MB file in about 0.7 s), a toolbar note says "Large file ... pages load as you scroll"; past 1 GB it is refused; no text selection or find inside a PDF); SVG is shown through an `<img>` so its scripts never run; CSV delimiter detection (`,` `;` tab `|`, quote-aware, decimal commas stay); Markdown relative images are loaded through main as data URLs (remote http images stay blocked by the CSP) and a relative link to a viewable file opens it in the viewer. Hidden Excel sheets are shown like the others. Not done: per-session preview with history (the preview belongs to the window), relative links inside a preview, .xls/.pdf/.pptx, editing. **D77 (review hardening):** spreadsheet and Word parsing runs in a WORKER THREAD (`officeRunner.ts` + `officeWorker.ts`, 768 MB / 20 s limits; a hostile file kills the worker, not the app) behind a zip guard (`zipGuard.ts`: refuses a zip that inflates past 64 MB or has over 5000 parts, from its directory alone); one plain error sentence per kind (no library text or links); a damaged image says so instead of loading forever; find folds case without changing the text length (the Turkish dotted I shifted every later highlight) and an all-blank query is no query everywhere; the table's column drag captures the pointer; the side panel is drawn at the width it really has (window minus sidebar minus the terminal's room); PDF zoom from the Fit level never goes the wrong way; a failed stat only says "File no longer exists" when the file is really gone (a locked file keeps its content); a preview whose session was removed is closed; Jarvis `preview_file` checks the file exists (and accepts `:12:3`); CSV delimiter detection ignores a candidate under which a quote opens mid-field (`1;"1,5"`). | `renderer/Terminal/links/linkClick.ts` + `linkProvider.ts`; `renderer/viewer/*`; `renderer/preview/*`; `renderer/shell/sidePanelWidth.ts` + `SidePanelResizeHandle.tsx`; `renderer/notes/NotesPanel.tsx`; `main/preview/*`; `shared/fileViewKind.ts` | `linkClick.test.ts`, `fileViewLogic.test.ts`, `fileViewState.test.ts`, `previewBus.test.ts`, `sidePanelWidth.test.ts`, `sidePanelTab.test.ts`, `main/preview/*.test.ts`; e2e `e2e-fileview.cjs` |

### 2.3 NAV — Sidebar & organisation

| ID | Feature | Status | Trigger / entry | Rules (must-know) | Code | Tests |
|---|---|---|---|---|---|---|
| NAV-1 | Session cards | Shipped | Sidebar | Show name, status dot or amber bell, running/exited dot, agent badge, notes progress, Keep-awake / RC badges; relative time re-renders every 30 s. | `renderer/Sidebar/SessionCard.tsx`, `StatusRow.tsx`, `components/AgentBadge.tsx` | `uiLogic.test.ts`, `AgentBadge.test.ts`, `formatTime.test.ts` |
| NAV-2 | Search and status filter | Shipped | Sidebar search icon, filter menu | Search matches session name/folder; status filter is a set (multi-select, `null` = No status); filtered-out sessions are not keyboard-selectable. | `renderer/Sidebar/Sidebar.tsx`; `renderer/state/selectors.ts`; `Sidebar/uiLogic.ts` → `toggleStatusFilter` | `selectors.test.ts`, `uiLogic.test.ts` |
| NAV-3 | Group by Group / Status | Shipped | Filter menu | `groups` = group sections; `status` = one section per status plus "No status"; choice persisted (`sessiondeck-sidebar-groupby`). | `renderer/state/selectors.ts` → `sections`, `statusSections`; `Sidebar/sidebarPrefs.ts` | `selectors.test.ts`, `shellPrefs.test.ts` |
| NAV-4 | Workspace buckets | Shipped | Inside a group, Groups view | Sessions bucketed by `cwd` (`folderKey`: slash style, trailing slash and case ignored); duplicate folder names labelled `parent/name`; collapsible; "New session in this workspace" pre-fills the folder; toggle persisted; Status view unchanged. | `renderer/state/selectors.ts` → `workspaceBuckets`, `workspaceCollapseKey`, `flatSessionIds`; `Sidebar/WorkspaceSection.tsx` | `workspaces.test.ts`; e2e `e2e:workspaces` |
| NAV-5 | Closed section | Shipped | Sidebar bottom | Collapsed by default; sorted by `closedAt` descending; Reopen / Delete per row; height bounded; persists collapsed state. | `renderer/Sidebar/ClosedSection.tsx`; `renderer/state/selectors.ts` → `splitClosed` | `selectors.test.ts`; e2e `e2e:close` |
| NAV-6 | Drag and drop | Shipped (real mouse unverified) | Drag cards/groups | Insert before/after by midpoint (`resolveDropPosition`); group reorder; session move to group/index; pure logic tested, real HTML5 DnD events not simulated. | `renderer/state/dropTarget.ts`; `Sidebar/uiLogic.ts`; `Sidebar/GroupSection.tsx` | `dropTarget.test.ts`, `uiLogic.test.ts`; known gap in `HANDOFF.md` |
| NAV-7 | Inline rename | Shipped | Double-click / `F2` | See SES-2; status rows keep a rejected draft visible by design. | `renderer/Sidebar/InlineEdit.tsx`, `inlineEditValidation.ts` | `inlineEditValidation.test.ts`, `statusDraft.test.ts`; e2e `e2e:dialogs` |
| NAV-8 | Context menus | Shipped | Right-click a card / group | Session: rename, status submenu, move to group, new group + move, sleep/wake, keep awake, mark read/unread, close, remove. Group: rename, new session, delete. Menus clamp to the viewport. | `renderer/Sidebar/SessionContextMenu.tsx`, `GroupContextMenu.tsx`, `uiLogic.ts` → `clampMenuPosition` | `uiLogic.test.ts` |
| NAV-9 | Keyboard navigation | Shipped | Sidebar focused | `↑`/`↓` roving selection, `Enter` opens, `F2` renames, `Delete` asks to remove; typing in inputs and open dialogs suppress global shortcuts. | `renderer/Sidebar/useSidebarKeyboard.ts`; `Sidebar/uiLogic.ts` → `moveFocus`, `shouldHandleGlobalShortcut` | `uiLogic.test.ts` |
| NAV-10 | Status view | Shipped | Group-by = Status | Read-only grouping by status; no workspace buckets; drag between sections changes status (same as Hub). | `renderer/state/selectors.ts`; `Sidebar/Sidebar.tsx` | `selectors.test.ts` |
| NAV-11 | Bulk selection and actions | Shipped | Sidebar / Hub with Ctrl / Shift / Esc | Plain click opens and clears (sets the range anchor); Ctrl/Cmd+click toggles without opening; Shift+click replaces with the visible range; Esc clears unless a dialog/menu/input/xterm has focus. Ids are pruned to the visible order; actions apply in view order, sequentially, one try/catch each (store banner reports failures) and the selection survives. Actions: Sleep, Wake (opens), **Prompt** (D48: one prompt into every selected Claude/OpenCode session's queue — idle ones get it at once, busy ones when their turn finishes, not-running ones later; Shell sessions and full queues are skipped; the dialog shows that split), Set status, Move to group, Clear. The bar's buttons wrap to a second line in the 300 px sidebar. Closed sessions never select; sidebar and Hub selections are independent. | `renderer/state/multiSelect.ts`, `useMultiSelect.ts`, `useBulkActions.ts` (the shared action loops); `components/BulkActionBar.tsx`; `queue/BroadcastDialog.tsx`, `queueLogic.ts` → `broadcastPlan`; `Sidebar/Sidebar.tsx`, `SessionCard.tsx`; `hub/HubView.tsx`, `HubCard.tsx` | `multiSelect.test.ts`, `useBulkActions.test.ts`, `queueLogic.test.ts`; e2e `e2e:bulk`, `e2e-broadcast.cjs` |
| NAV-12 | Sort sessions (D61) | Shipped | Sidebar header ↕ button (Ops and Code), Jarvis `sidebar_view sort` | Manual (default: drag order in Ops, creation order in Code), Needs attention (rank: needs you = a bell or a non-reminder `needs-input` → working → finished / idle reminder → running, nothing known → sleeping → not running; ties by last active), Last active (`Session.lastActiveAt` desc, else `createdAt`), Newest (`createdAt` desc), Name A–Z (natural, case-insensitive). Sorts inside each group, folder bucket, status section, worktree and Hub column; groups, repos and worktrees keep their order (folder buckets follow their first session). Hub on Manual keeps its own most-recent-activity order. Saved per mode (`sessiondeck.sort.v1` / `.code`). Live sorts (attention, recent) are pinned while the pointer is over the list or board and re-sort when it leaves. While sorted, a drop that only reorders inside a group is refused with a 4 s hint "Switch the sort to Manual to reorder"; a drop into another group still moves. Keyboard ↑/↓ and Shift+click ranges follow the sorted order. `lastActiveAt` is set in main by `lastActive.ts`: a new `working`/`finished` activity or a typed line with Enter (focus reports do not count), first touch written at once, then at most one trailing write per session per 30 s, flushed at quit. | `renderer/state/sessionSort.ts` (pure rules), `useSessionSort.ts` (per-mode pref + hover freeze), `selectors.ts` → `orderSectionSessions`; `Sidebar/SortMenu.tsx`, `SessionsHeader.tsx`, `Sidebar.tsx`; `code/sidebar/codeTree.ts` → `orderCodeTreeSessions`, `useCodeTreeModel.ts`, `CodeSidebar.tsx`; `hub/HubView.tsx`; `mode/ModeWorkspace.tsx`; `main/app/lastActive.ts`, `store/reducers.ts` → `setLastActiveAt`; `shared/idleReminder.ts` | `sessionSort.test.ts`, `lastActive.test.ts`, `codeTree.test.ts`, `reducers.test.ts`, `persistence.notes.test.ts`, `workspaceUi.test.ts`, `jarvisTools.test.ts`; e2e `e2e:sort`, `e2e-jarvis-app.cjs` |
| NAV-13 | Adjustable sidebar width (D70) | Shipped | Drag the sidebar's right edge; focus it and use arrows | The sessions sidebar (Ops and Code, both windows) is 300px by default and can be dragged between 220px and 640px; the terminal area always keeps 420px (CSS `max-width`, so a small window is safe). Live while dragging (no width transition then), saved when the pointer is released (`sessiondeck.sidebarWidth.v1`, shared by both modes). The edge is a focusable separator: Left/Right = 16px, Shift = 64px, Home/End = the limits; double-click resets to 300px. Hiding the sidebar keeps the width. | `renderer/shell/sidebarWidth.ts` (limits, parse, key and drag rules), `useSidebarWidth.ts`, `SidebarResizeHandle.tsx`; `mode/ModeWorkspace.tsx` | `sidebarWidth.test.ts`; e2e `e2e:sidebarwidth` |

### 2.4 ATT — Attention & alerts

| ID | Feature | Status | Trigger / entry | Rules (must-know) | Code | Tests |
|---|---|---|---|---|---|---|
| ATT-1 | Claude hook pipeline | Shipped | Claude Code hooks | Each Claude pty gets a private `--settings <file>` with a token-checked local HTTP hook server; events: `UserPromptSubmit`, `Notification`, `Stop`, `AgentSession` (OpenCode); the hook server also receives `statusLine` and worker events. | `main/attention/HookServer.ts`, `claudeSettings.ts`; `main/attention/AttentionService.ts` | `HookServer.test.ts`, `HookServer.route.test.ts`, `claudeSettings.test.ts`; e2e `e2e.cjs` |
| ATT-2 | Attention reasons and priority | Shipped | Hooks, bell, user flag | Priority: `permission` 4 > `done` 3 > `idle` 2 > `bell` 1 > `unread` 0; a lower reason never replaces a higher one; `unread` is the user's own flag and is silent; clearing happens on focus or user input. | `main/attention/AttentionManager.ts` → `PRIORITY`, `raise`, `markUnread` | `AttentionManager.test.ts`, `needsYou.test.ts` |
| ATT-3 | Bell UI | Shipped | Card / tab / Hub / header | A session that needs the user shows a filled amber bell **instead of** its status dot; clicking the card's bell marks read without opening; the on-screen session gets the bell but never pings. | `renderer/attention/*` (`AttentionBell`, `FilledBellIcon`); `renderer/shell/tabStatus.ts` | `needsYou.test.ts`, `tabStatus.test.ts`; e2e `e2e-bell` |
| ATT-4 | Needs-you list | Shipped | Header bell, status bar "N needs you" | Newest bell first (no timestamp sorts last, then name); click opens; "Mark all as read"; list is per mode (Ops/Code). | `renderer/attention/NeedsYouPopover.tsx`, `needsYou.ts`; `mode/modeLogic.ts` → `needsYouCounts` | `needsYou.test.ts`, `modeLogic.test.ts`; e2e `e2e-bell` |
| ATT-5 | Notification sounds | Shipped | Settings > Sound, status-bar toggle | 6 synthesized built-ins + custom audio file; per event (`permission`, `done`, `idle`, `bell`, `quota`), volume, Test button; main never beeps — it sends `ev:sound` and the renderer plays; persisted in `sessiondeck.sound.v1`; status-bar toggle shares the store. | `renderer/sound/soundSettings.ts`, `soundStore.ts`, `soundPlayer.ts`, `builtinSounds.ts`; `main/app/soundRelay.ts` | `soundSettings.test.ts`, `soundStore.test.ts`, `soundPlayer.test.ts`, `builtinSounds.test.ts`, `soundRelay.test.ts`; e2e `e2e:hub` |
| ATT-6 | Taskbar flash | Shipped (not human-verified) | Attention raised | `Notifier` flashes the window for real attention reasons (not `unread`, not the on-screen session); code path tested with fakes, flash not visually confirmed. | `main/attention/Notifier.ts` | `Notifier.test.ts`; gap in `HANDOFF.md` |
| ATT-7 | Desktop notifications | Shipped (not human-verified) | Attention / quota, Settings > General | Windows notification with title/body; 3 s dedupe window; optional "only when unfocused"; click focuses the owning session in the correct window/mode; unsupported platforms degrade silently. | `main/notify/desktopNotifier.ts`, `attentionNotice.ts`, `attentionWiring.ts` | `desktopNotifier.test.ts`, `attentionNotice.test.ts`, `attentionWiring.test.ts` |
| ATT-8 | Tray menu | Shipped | Tray icon | Tooltip with attention count; "Show" + up to 8 attention sessions (reason suffix) + "Quit"; attention listed regardless of run state. | `main/tray/trayModel.ts`, `main/app/trayWiring.ts` | `trayModel.test.ts` |
| ATT-9 | Close to tray | Shipped | Window close button | Default ON: closing hides the window, sessions keep running; Quit is explicit (tray or Settings > General); a hidden window counts as away for sleep-all. | `main/app/closeToTray.ts`, `quitState.ts` | `closeToTray.test.ts`, `quitState.test.ts`; e2e `e2e:g1` |
| ATT-10 | Idle-output detector | Shipped (intentional no-op) | — | Only `Stop` and `Notification` hooks ping; the idle-output detector does not raise attention by itself (D11-era decision). Do not "fix" it into pinging. | `main/attention/IdleDetector.ts`; `AttentionService.ts` | `IdleDetector.test.ts`, `AttentionService.test.ts` |
| ATT-11 | Sound relay | Shipped | Any attention / quota | Main emits `ev:sound` with `(sessionId, event)`; `sessionId` is `''` for `quota`; the main window plays (the popped-out Code window does not). | `main/app/soundRelay.ts`; `renderer/sound/useAttentionSound.ts` | `soundRelay.test.ts` |
| ATT-12 | Reminder escalation | Shipped | Settings > Sound "Repeat the alert…" | While a session stays needs-you and unread, repeat the same sound + taskbar flash + desktop notice every `reminder.afterMinutes` (1–120, default 10). Disabled = never. `unread` (the user's own flag) never schedules; the session on screen never pings (it still counts as snoozed for one interval). Reading/clearing/closing/forgetting disarms; a priority upgrade re-arms the more urgent reason. The settings are read on every 30 s tick (no restart). | `main/attention/reminder.ts` (pure), `main/attention/AttentionService.ts`; `main/index.ts` → `onReminder`; `renderer/settings/ReminderBlock.tsx` | `reminder.test.ts`, `AttentionService.test.ts` (reminders), `reminderValidation.test.ts`, `settings.test.ts`; e2e `e2e:reminder` |
| ATT-13 | Keyboard triage (D69) | Shipped | `Ctrl+Shift+Down` / `Ctrl+Shift+Up`, palette "Next / Previous session that needs you" | Shows the next / previous session that has a bell, in the needs-you list's order (newest bell first), per mode. From a session without a bell: Down = the newest bell, Up = the oldest; from one in the list: the one after / before it, wrapping; the only waiting session being the one on screen, or nobody waiting, does nothing. A viewed session loses its bell, so repeated presses walk the waiting sessions. Works with the terminal focused (window capture phase + stopPropagation: neither xterm nor the sidebar's Shift+arrow select sees it); ignored while a dialog is open or a text field has the focus. The two palette items exist only while a session has a bell. | `renderer/attention/attentionNav.ts` (`decideAttentionShortcut`, `pickAttentionTarget`), `useAttentionShortcuts.ts`; `mode/useWorkspaceCommands.ts` (`stepAttention`); `palette/paletteItems.ts`, `runCommand.ts` (`step-attention`) | `attentionNav.test.ts`, `paletteItems.test.ts`, `runCommand.test.ts`; e2e `e2e:attentionnav` |

### 2.5 HUB — Hub board

| ID | Feature | Status | Trigger / entry | Rules (must-know) | Code | Tests |
|---|---|---|---|---|---|---|
| HUB-1 | Status columns | Shipped | Sidebar "Hub" / palette | One column per user status in configured order, plus a synthetic "No status" column; closed sessions are excluded; empty columns still render. | `renderer/hub/hubLogic.ts` → `hubColumns`; `HubView.tsx` | `hubLogic.test.ts`; e2e `e2e:hub` |
| HUB-2 | Drag card to change status | Shipped (real mouse unverified) | Drag a card onto a column | Drop computes `{sessionId, statusId}`; dropping on "No status" clears the status; pure logic tested, real DnD not simulated. | `renderer/hub/hubLogic.ts` → `statusDrop`; `HubView.tsx` | `hubLogic.test.ts`; e2e `e2e:hub` |
| HUB-3 | Open session from a card | Shipped | Click / `Enter` / `Space` | Opens the session in the terminal view (or its grid cell once grid ships); the card is keyboard-focusable. | `renderer/hub/HubCard.tsx` | `hubLogic.test.ts`; e2e `e2e:hub` |
| HUB-4 | Card metadata | Shipped | Hub card | Cost, context fill, notes progress (`✓ 2/5`), bell, agent badge; values come from the same selectors/usage as the sidebar. | `renderer/hub/HubCard.tsx`, `hubLogic.ts` | `hubLogic.test.ts` |
| HUB-5 | Header total cost | Shipped | Hub header | Sum of known session costs; unknown costs are skipped. | `renderer/hub/hubLogic.ts` → `totalCost` | `hubLogic.test.ts` |
| HUB-6 | Scroll to busiest column | Shipped | Open the Hub | `hub.scrollToBusiest` (default true): scrolls once on mount, left-aligns the busiest column unless already fully visible; Settings > General switch; no scroll when off. | `renderer/hub/hubLogic.ts` → `busiestColumnIndex`; `HubView.tsx` | `hubLogic.test.ts`; e2e `e2e:hubscroll` |

### 2.6 TAB — Tabs, views & panels

| ID | Feature | Status | Trigger / entry | Rules (must-know) | Code | Tests |
|---|---|---|---|---|---|---|
| TAB-1 | Open tabs and restore | Shipped | Opening a session | Open sessions get tabs; tab state and active tab persisted (`sessiondeck-open-tabs` + `.code`); dead ids pruned on load; cycling wraps. | `renderer/shell/openTabsLogic.ts` (pure), `useOpenTabs.ts` | `openTabsLogic.test.ts` |
| TAB-2 | Per-folder tab bar | Shipped | Tab bar | Shows only open sessions sharing the active session's folder (`folderKey`) that are running and awake (`isActiveSession`, D55); the session on screen always keeps its tab, even asleep or exited; a lone session gets a bar of one; with no active session every active tab shows. Close others / Close all act on the visible tabs only. | `renderer/shell/projectTabs.ts` → `projectTabIds` | `projectTabs.test.ts`; e2e `e2e:foldertabs` |
| TAB-3 | Tab shortcuts | Shipped | Keyboard | `Ctrl+Tab` / `Ctrl+Shift+Tab` cycle; `Ctrl+W` closes the active tab **outside** the terminal only (readline keeps delete-word); `Ctrl+Shift+W` closes everywhere; dialogs and text inputs win. | `renderer/shell/openTabsLogic.ts` → `decideTabShortcut`; `useTabShortcuts.ts` | `openTabsLogic.test.ts`; e2e `e2e:palette` (shortcut context) |
| TAB-4 | Terminal \| Grid \| Hub view | Shipped | Tab-bar view control, palette "Open Hub" | Per-mode persisted `MainView` (`sessiondeck.view.v1` / `.code`); switching view never destroys terminal state; a focus request may switch the view. `grid` is the third value (TRM-8). | `renderer/mode/viewPref.ts`; `mode/useWorkspaceNav.ts`; `ModeWorkspace.tsx` | `viewPref.test.ts`, `modeLogic.test.ts` |
| TAB-5 | Notes \| Activity \| Queue side panel | Shipped | Tab-bar panel toggle | Per-mode open/closed and per-mode selected tab (`sessiondeck.notes.open.v1`, `sessiondeck.sidepanel.tab.v1` + `.code`); Code sessions add a **Changes** tab; the chosen tab falls back to the first valid one. | `renderer/timeline/sidePanelTab.ts`; `renderer/notes/NotesPanel.tsx`; `mode/useWorkspaceNav.ts` | `sidePanelTab.test.ts`; e2e `e2e:notes`, `e2e:away` |
| TAB-7 | View changes in the tab menu (D82) | Shipped | Right-click a session tab OR the session in the Code sidebar (worktree session) > View changes | Activates that tab, leaves grid/hub for the terminal view, opens the side panel on its **Changes** tab (the panel remounts on it) and widens it once from the default 320 to 520 px (a saved width is kept). From the sidebar a session without an open tab gets one (never wakes it). Not offered for sessions without a worktree; works for a sleeping session. | `renderer/shell/Tab.tsx` (`showViewChanges`), `TabBar.tsx`, `tabStatus.ts` (`TabModel.worktree`); `Sidebar/SessionContextMenu.tsx` (`onViewChanges`), `code/sidebar/CodeSessionRow.tsx`; `mode/ModeWorkspace.tsx` (`viewChanges`), `mode/viewChangesLogic.ts` | `Tab.test.ts`, `tabStatus.test.ts`, `viewChangesLogic.test.ts`; e2e `e2e:tab-changes` |
| TAB-6 | Worker tabs | Shipped | OpenCode process started from a Claude session | Read-only tabs beside the session's tabs; see WRK. | `renderer/workers/*` | `workerLogic.test.ts`; e2e `e2e:workers` |

### 2.7 NTS — Notes & checklist

| ID | Feature | Status | Trigger / entry | Rules (must-know) | Code | Tests |
|---|---|---|---|---|---|---|
| NTS-1 | Free-text notes | Shipped | Side panel > Notes | Max 20,000 chars; autosave 600 ms after the last keystroke; flush on blur, session switch and unmount; stored on `Session.notes` (persisted). | `renderer/notes/useSessionNotes.ts`, `debounce.ts`; `main/store/sessionNotes.ts` | `debounce.test.ts`, `sessionNotes.test.ts`, `persistence.notes.test.ts`; e2e `e2e:notes` |
| NTS-2 | Checklist | Shipped | Side panel > Notes | Max 100 items, text 1–300 chars, ids unique; add / toggle / edit / delete / move up-down / clear done; invalid stored items are dropped, not fatal. | `renderer/notes/checklistLogic.ts` (pure); `main/store/sessionNotes.ts`; `main/store/reducers.ts` | `checklistLogic.test.ts`, `sessionNotes.test.ts`, `ipcValidation.notes.test.ts`; e2e `e2e:notes` |
| NTS-3 | Progress chip | Shipped | Sidebar card, Hub card | `done/total` percent; shows `✓ 2/5`; absent when the checklist is empty. | `renderer/notes/checklistLogic.ts` → `progress` | `checklistLogic.test.ts` |
| NTS-4 | Parse steps from notes | Shipped | Notes panel action | Turns note lines into checklist items; preserves order; empty lines skipped. | `renderer/notes/parseSteps.ts` | `parseSteps.test.ts` |
| NTS-5 | Draft preservation | Shipped | Switching sessions mid-edit | An unsent checklist step survives switching away and back. | `renderer/notes/checklistDrafts.ts` | `checklistDrafts.test.ts`; e2e `e2e:checklist-draft` |

### 2.8 USE — Usage & quota

| ID | Feature | Status | Trigger / entry | Rules (must-know) | Code | Tests |
|---|---|---|---|---|---|---|
| USE-1 | statusLine ingestion | Shipped | Claude Code's `statusLine` after each turn; the OpenCode plugin for Go | The private settings file contains a throttled (10 s) bash+curl command that POSTs JSON to `POST /statusline/<sessionId>` (token-checked, 64 KB cap); parses `rate_limits`, `cost`, `context_window`, `model`; a user's global statusLine is overridden for SessionDeck sessions. An optional `source: 'opencode-go'` routes the body to the Go account instead of Claude and allows a `monthly` window (ISO `resets_at` accepted). | `main/usage/statusLineParser.ts`; `main/attention/statusLineBash.ts`, `HookServer.ts`; `main/usage/UsageService.ts` | `statusLineParser.test.ts`, `statusLineBash.test.ts`, `HookServer.statusLine.test.ts`, `UsageService.test.ts` |
| USE-2 | Usage chips | Shipped | Status bar | One group per account (Claude, OpenCode Go) with 5-hour and weekly plan windows, reset countdowns, level colouring and pace hint; provider labels only with 2+ groups; Go adds a `Month` chip; active session model, context fill, cost. | `renderer/usage/UsageChips.tsx`, `usageLogic.ts`, `usagePace.ts` | `usageLogic.test.ts`, `usagePace.test.ts`; e2e `e2e:notes-usage`, `e2e:usage-both` |
| USE-3 | Cached usage after restart | Shipped | App relaunch | Account list cached in `sessiondeck.usage.v1` (array form; a legacy single object reads as one Claude row) so bars show immediately; marked stale; a startup reply with empty values must not erase the cache, and a missing Claude row keeps its cached value while a missing Go row is dropped (the toggle). | `renderer/usage/useUsage.ts`, `usageCache.ts`, `usageLogic.ts` (`mergeUsageState`) | `usageCache.test.ts`, `usageLogic.test.ts` |
| USE-4 | Manual usage refresh | Shipped | Reload icon on the bars | First-use consent dialog (`sessiondeck.usage.consent.v1`); single flight; 5 s floor; 429 cool-down honours `Retry-After`; reads the Claude OAuth token **in main only**, never sends/stores/logs it; errors classified `no-credentials` / `stale-token` / `rate-limited` / `server` / `network` / `unavailable`; manual only, never polled. | `main/usage/usageRefresh.ts`, `oauthUsage.ts`; `renderer/usage/UsageRefreshButton.tsx`, `UsageConsentDialog.tsx` | `usageRefresh.test.ts`, `oauthUsage.test.ts`; e2e `e2e:usage-refresh` |
| USE-5 | Quota guard thresholds | Shipped | Every usage update | Warn / critical thresholds (defaults 80 / 95) for the 5-hour and weekly windows; once per window instance (keyed by `resetsAt`); reset notice; markers persisted in `<userData>/quota-markers.json`; a reset the autopilot already handled is deduped for 30 min — five-hour resets only, a weekly reset in the same window is still delivered. | `main/quota/quotaGuard.ts`, `quotaMarkers.ts`, `quotaNotice.ts` | `quotaGuard.test.ts`, `quotaMarkers.test.ts`, `quotaNotice.test.ts`, `autopilot.test.ts` (weekly-reset dedup) |
| USE-6 | Quota toasts and pace hint | Shipped | `ev:quota` | In-app toast with action when offered; at most N toasts, plain ones dropped before actionable ones; `quota` sound; pace hint estimates whether the window will be hit. | `renderer/usage/quotaToastLogic.ts`, `quotaAlertLogic.ts`, `QuotaToast.tsx`; `usagePace.ts` | `quotaToastLogic.test.ts`, `quotaAlertLogic.test.ts`, `quotaActions.test.ts` |
| USE-7 | Autopilot: sleep at critical | Shipped | Settings > Quota "At the critical level" | Applies to the critical level of EITHER window (5-hour or weekly): `ask` = toast button "Sleep N idle sessions"; `sleep` = automatic; `nothing` = warn only. Idle = open, running, not working/needs-input, not Keep awake, not Remote Control; **busy turns are never interrupted**. A weekly-critical sleep is held until the next five-hour reset (no 7-day holds). | `main/quota/autopilot.ts`, `autopilotPolicy.ts`, `autopilotOps.ts`; `renderer/usage/QuotaToast.tsx`, `QuotaToastCard.tsx`, `QuotaToastControls.tsx` | `autopilot.test.ts`, `autopilotPolicy.test.ts`; e2e `e2e-autopilot` |
| USE-8 | Autopilot: wake at reset | Shipped | Reset time | Own timer at `resets_at + 5 s` (no usage update arrives while everything sleeps); `ask` = toast "Wake N sessions" + optional "Type continue"; `wake` = automatic; waking resumes in the background (screen stays put); "continue" is typed only into limit-stopped sessions after 3 s of quiet (give up after 90 s); Enter follows after 300 ms. | `main/quota/autopilotTimer.ts`, `autopilotContinue.ts`, `autopilotStore.ts`; `renderer/usage/quotaActions.ts` | `autopilotTimer.test.ts`, `autopilotContinue.test.ts`, `autopilotStore.test.ts`; e2e `e2e-autopilot` |
| USE-9 | Held-for-reset chip | Shipped | Status bar while sessions wait | "N waiting for reset · HH:MM"; click wakes them; hidden when none. | `renderer/usage/QuotaHeldChip.tsx`, `quotaHeldLogic.ts`, `useQuotaAutopilot.ts` | `quotaHeldLogic.test.ts`; e2e `e2e-autopilot` |
| USE-10 | Usage-limit detection | Shipped (wording capture on) | Claude output | `USAGE_LIMIT_PATTERNS` (Claude only), armed only by a prompt submitted in the running process so a resumed session redrawing an old message is ignored; marks the session limit-stopped for the autopilot. The FIRST real match per process is written to `main-errors.log` (`usage limit wording (add to USAGE_LIMIT_PATTERNS if new)`, ANSI-stripped line, max 200 chars) so the list can grow from actual wording. | `main/app/outputSignals.ts` (`findUsageLimitLine`), `sessionController.ts`; `main/quota/autopilot*` | `outputSignals.test.ts`, `sessionController.quota.test.ts` |
| USE-11 | Hands-off defaults + migration + failure notice | Shipped | D33 | NEW defaults: `criticalAction='sleep'`, `resetAction='wake'`, `continueOnWake=true` (still user-changeable; ask-mode kept). Boot migration `upgradeLegacyQuotaFields()` upgrades ONLY a stored quota block whose every present field equals the old defaults (ask/ask/false, 80/95, notify true) field-for-field — any customized field is a deliberate choice and is kept. When hands-off automation FAILS (wake fails at the reset, or "continue" is given up after the max wait) a "SessionDeck needs you" desktop notice + quota sound names the session (`onContinueFailed` → `notifyContinueFailed(sessionName)`). | `shared/types.ts` (defaults); `main/store/settings.ts`; `main/quota/autopilotTypes.ts` (`onContinueFailed`), `autopilotOps.ts` (wake fail), `autopilotContinue.ts` (`onGiveUp`), `continueFailedNotice.ts`; `main/app/featureWiring.ts`, `index.ts` | `settings.test.ts` (migration ×5), `autopilot.test.ts` (wake-fail, give-up), `autopilotContinue.test.ts` (`onGiveUp` order), `continueFailedNotice.test.ts`, `quotaActions.test.ts`; e2e `e2e:handsfree` |
| USE-12 | Multi-provider quota bars (Claude + OpenCode Go) | Shipped | Status bar / D37 | `UsageState.accounts` = display list, Claude first then `opencode-go`; `account` stays the Claude account and is the ONLY input of the autopilot/toasts (Go is display-only). The OpenCode plugin resolves the Go credential via the v2 connection API, GETs `https://opencode.ai/zen/go/v1/usage` and POSTs `source:'opencode-go'` statusline bodies (rolling→five_hour, weekly→seven_day, monthly→monthly) at setup + after each turn end, throttled 5 min; any failure posts nothing and the key never leaves the plugin. Labels appear only with 2+ groups; Go adds a `Month` chip. `showOpencodeGo` (default on) is enforced in main (drop at once) and filtered again in the renderer; the localStorage cache is an array and a missing Claude row keeps its cached value while a missing Go row is dropped. | `main/opencode/pluginSource.ts`; `main/usage/statusLineParser.ts`, `UsageService.ts`; `renderer/usage/usageLogic.ts`, `usageCache.ts`, `useUsage.ts`, `UsageChips.tsx`; `main/app/featureWiring.ts`; `renderer/settings/QuotaSection.tsx` | `pluginSource.test.ts` (credential/failure/throttle), `statusLineParser.test.ts`, `UsageService.test.ts`, `usageCache.test.ts`, `usageLogic.test.ts`, `settings.test.ts`; e2e `e2e:usage-both` |

### 2.9 AUT — Automation & sleep

| ID | Feature | Status | Trigger / entry | Rules (must-know) | Code | Tests |
|---|---|---|---|---|---|---|
| AUT-1 | Auto status from activity | Shipped | Settings > Automation | Maps `working` / `needs-input` / `finished` to a status id (defaults Working / Waiting / Review); disabled, null mapping, missing status or already-set status = no change; closed sessions skipped. | `main/automation/autoStatus.ts` → `decideAutoStatus`; `applyAutoStatus.ts` | `autoStatus.test.ts`, `applyAutoStatus.test.ts`; e2e `e2e:g1` |
| AUT-2 | Per-session idle sleep | Shipped | Settings > Automation "Sleep idle sessions" | Enabled + open + running + not asleep + not Keep awake + not Remote Control + not on screen in ANY open window (main + popped-out Code) + idle for `afterMinutes` (1–1440, default 30) with no output/activity change; Shell never; finished-turn bell does not block. Docking the Code window clears its role, so its session becomes sleepable again. | `main/sleep/sleepPolicy.ts`; `SleepScheduler.ts` | `sleepPolicy.test.ts`, `SleepScheduler.test.ts`; e2e `e2e:sleep` |
| AUT-3 | Sleep everything when idle | Shipped | Settings > Automation | All-or-nothing: no user input for X minutes **and** every candidate session idle for X minutes, not working, not needs-input, no permission request; the on-screen session is included; Keep-awake / Remote Control spared; independent of AUT-2; window hidden in tray counts as away. | `main/sleep/sleepAllPolicy.ts`; `SleepScheduler.ts` | `sleepAllPolicy.test.ts`, `SleepScheduler.test.ts`; e2e `e2e:sleepall` |
| AUT-4 | User-input / away detection | Shipped | Key, click, wheel, pty write | Renderer listens in capture phase (xterm typing counts) and reports at most every 15 s (`app:userActivity`); main also counts every `pty:write`; feeds sleep-all and away detection. | `renderer/shell/useUserActivityReporter.ts`, `userActivity.ts`; `main/app/userPresence.ts` | `userActivity.test.ts`, `userPresence.test.ts`; e2e `e2e:sleepall`, `e2e:away` |
| AUT-5 | Scheduler tick | Shipped | Every 30 s | Runs the per-session and sleep-all rules on the same tick and sleeps the union; `noteUserInput()` postpones both. | `main/sleep/SleepScheduler.ts` | `SleepScheduler.test.ts` |

### 2.10 TML — Timeline & away summary

| ID | Feature | Status | Trigger / entry | Rules (must-know) | Code | Tests |
|---|---|---|---|---|---|---|
| TML-1 | Turn recording | Shipped | Hooks | One turn per prompt: `UserPromptSubmit` starts, `Notification` sets `neededYou` (turn continues), `Stop` ends `finished`; sleep / close / exit / limit also end it; prompt from the hook body (max 200 chars; OpenCode's plugin sends the user text from `session.inbox.enqueued`, else `''`). A prompt submitted while the previous turn is still open supersedes it (ended `finished` at once) and queues it in `awaitingStop` (FIFO, max 8): a late `Stop` then settles the OLDEST superseded turn, not the one just started. | `main/timeline/timelineService.ts`, `timelineState.ts` | `timelineService.test.ts`, `timelineState.test.ts`, `HookServer.prompt.test.ts`; e2e `e2e:timeline-prompt`, `e2e:away` |
| TML-2 | Turn cost and settling | Shipped | Each turn | Turn cost = session cost delta; still settling for 2 min after Stop; never negative; unknown = null. The tracked `startCost` is a cursor advanced on every refresh, so increments accumulate and a statusLine arriving after the next prompt still books the old turn's cost on the old turn; after a superseded turn settles, the cursor moves to the next queued turn (else the running one). | `main/timeline/timelineService.ts` → `refreshCost`, `focusCostAfterStop` | `timelineService.test.ts`, `timelineState.test.ts` |
| TML-3 | Timeline persistence | Shipped | Continuous | `<userData>/sessiondeck-timeline.json`; 200 turns/session, 30 days; sleeps are saved too (`sleeps: [{sessionId, at}]`, newest per session, retention-pruned, absent field still reads) so `lastSleptAt` survives a restart; a turn open at quit comes back `exited`; invalid entries dropped. | `main/timeline/timelineFile.ts` (`parseTimelineDocument` / `loadTimelineDocument` / `saveTimelineDocument`) | `timelineFile.test.ts`, `timelineService.test.ts`; e2e `e2e:away` |
| TML-4 | Activity tab | Shipped | Side panel > Activity | Per-session turns newest first; prompt, end reason, cost, needed-you marker; refetches on `ev:timeline`. | `renderer/timeline/ActivityList.tsx`, `useTimeline.ts`, `timelineLoad.ts`, `timelineFormat.ts` | `timelineLoad.test.ts`, `timelineFormat.test.ts`; e2e `e2e:away` |
| TML-5 | Away detection | Shipped | No input for `away.afterMinutes` (default 15, enabled) | Same input signal as sleep-all; coming back after the threshold builds a summary; only non-empty summaries are sent (`ev:awaySummary`) and kept as the last one. | `main/app/userPresence.ts`; `main/app/featureWiring.ts` | `userPresence.test.ts`; e2e `e2e:away` |
| TML-6 | "While you were away" | Shipped | Return after absence; palette action | Per session: finished turns, needs-you, hit limit, slept, known cost, newest prompt; sorted newest event first; rows open the session; totals; `away:getLast` keeps the last summary of the run. | `main/timeline/awaySummary.ts`; `renderer/timeline/AwayDialog.tsx`, `awayState.ts`, `useAwaySummary.ts` | `awaySummary.test.ts`, `awayState.test.ts`; e2e `e2e:away` |
| TML-7 | Cost over time | Shipped | Palette "Show cost report"; Hub header total (click); side panel Activity tab | From the timeline's per-turn `costUsd` (known costs only; 30-day retention, 200 turns/session). Dialog: Today / Last 7 days / Last 30 days tiles (calendar days, today included), a 14-day column chart (one series `--chart-1`, validated on the dark card surface; ≤24px bars with 4px rounded tops; hover/focus tooltip with cost and turns), and a per-session table (30 days, most expensive first; a row opens the session). Live: refetches a session on `ev:timeline`. Activity tab: a compact 14-day strip with the 14-day and today total, hidden until the session has a known cost. | `renderer/costs/costLogic.ts`, `CostBars.tsx`, `CostDialog.tsx`, `useCostTurns.ts`; `timeline/ActivityList.tsx`; `hub/HubView.tsx`; `palette/*`; `mode/useWorkspaceCommands.ts`, `ModeWorkspace.tsx`; `styles/orca-theme.css` (`--chart-1`) | `costLogic.test.ts`, palette tests; e2e `e2e-costs.cjs` (10) |

### 2.11 AGT — Agents

| ID | Feature | Status | Trigger / entry | Rules (must-know) | Code | Tests |
|---|---|---|---|---|---|---|
| AGT-1 | Claude Code | Shipped | Default agent | Always runs in yolo mode (`--dangerously-skip-permissions`) unless the user already passed a permission flag; gets the private hooks settings file; `--session-id` for a new conversation, `--resume` afterwards; a never-prompted session rotates to a fresh id on resume; `NO_COLOR` stripped. | `main/app/startOptions.ts`, `claudeLaunch.ts`; `main/pty/launch.ts` | `startOptions.test.ts`, `claudeLaunch.test.ts`, `launch.test.ts`; e2e `e2e.cjs`, `e2e:resume` |
| AGT-2 | OpenCode | Shipped | New Session agent dropdown, Settings > Agents default | Plugin package injected via `OPENCODE_CONFIG_CONTENT` (merged with the user's own value: plugins appended, `permission: {"*":"allow"}` merged, other fields kept; unparseable value left alone); reports busy/idle/permission/cost, the user's prompt text (v2 `session.inbox.enqueued` `item.payload.text`, v1 user-message parts; ≤200 chars, attached to that turn's `UserPromptSubmit`) and a context % (model catalog `limit.context` vs the LATEST `session.step.ended` prompt tokens = `input + cache.read + cache.write`; never cumulative totals; same catalog supplies the display name); resume with `opencode --standalone -s <id>`; the model travels in the config content `model` key (the TUI CLI has no `--model` flag — it prints help and exits); empty model = OpenCode default; no Claude args. `--standalone` (private server) so the per-process plugin env is honored. Also reports the OpenCode Go allowance (D37: v2 credential resolve → `https://opencode.ai/zen/go/v1/usage` → `source:'opencode-go'` statusline body, at setup + turn end, 5-min throttle, silent on any failure). **D79:** the conversation text of an OpenCode session is read with `opencode session export <id>` (`transcripts/opencodeTranscript.ts`, run by `opencode/exportRunner.ts`, cached, 3 at a time): Jarvis `get_last_answer`, `fleet_digest` and palette conversation search work for OpenCode. A session whose conversation id was never captured is recovered from `opencode session list` run IN THE SESSION'S FOLDER (the list is per project) when there is exactly one candidate (`opencode/sessions.ts`). If no plugin event arrives within 20 s the card shows an advisory "status unavailable" badge (`RuntimeState.opencodePlugin`). A usage-limit line on the OpenCode screen reaches autopilot (`opencode/health.ts`, last 25 lines, once per line). New Session > OpenCode has "Ask before running tools" (`opencodePermissions: 'ask'`: the user's own permission rules are not overwritten; yolo stays the default, D10). Fork on an OpenCode session is a copy (`opencode/fork.ts`). | `main/opencode/pluginEnv.ts`, `pluginSource.ts`, `writePlugin.ts`; `main/app/startOptions.ts` → `buildOpencodeStartOptions` | `pluginEnv.test.ts`, `pluginSource.test.ts`, `writePlugin.test.ts`, `startOptions.test.ts`; e2e `e2e:opencode` (13 checks), `e2e:timeline-prompt` (9 checks), `e2e:usage-both` **D72/D74:** `--standalone` is added only when `opencode --help` lists it; Settings > Agents shows the detected version and `--standalone` support with a **Re-check** button (`opencode:infoGet` / `opencode:recheck`); the probe runs in the background at app start (`warmOpencodeProbe`), a session launched before it finishes falls back to a one-off synchronous probe. |
| AGT-3 | Shell | Shipped | New worktree dialog agent `shell`; Settings > Code shell | Plain `powershell` / `pwsh` / `cmd` (PowerShell gets `-NoLogo`); no hooks, no conversation, restarts fresh; **never auto-slept** by idle, sleep-all or quota; not part of Ops. | `main/app/startOptions.ts` → `buildShellStartOptions`; `renderer/mode/codeSettingsLogic.ts` | `startOptions.shell.test.ts`, `codeSettingsLogic.test.ts`; e2e `e2e:codemode` |
| AGT-4 | Remote Control | Shipped | New Session checkbox `--remote-control` | Detects the `/rc active` footer (`RuntimeState.remoteControl`), shows an RC badge, auto-marks Keep awake; a prompt from any source clears pending attention; a remotely answered question returns the card to working when the spinner reappears. | `main/app/outputSignals.ts`; `main/app/runtimeRegistry.ts`; `renderer/Sidebar/SessionContextMenu.tsx` | `outputSignals.test.ts`, `runtimeRegistry.remote.test.ts`; e2e `e2e:remote` |
| AGT-5 | Agent badge | Shipped | Card / Hub | Small badge for Claude / OpenCode / Shell so mixed lists are readable. | `renderer/components/AgentBadge.tsx` | `AgentBadge.test.ts` |

### 2.12 COD — Code mode (worktrees)

| ID | Feature | Status | Trigger / entry | Rules (must-know) | Code | Tests |
|---|---|---|---|---|---|---|
| COD-1 | Ops \| Code separation | Shipped | Mode switch in the sidebar title bar | A session is Code iff it has `worktreeId`; the store is filtered per mode; tabs, split, view, notes, side-panel tab and (future) grid are per mode; Code can pop out into its own window; a needs-you badge marks the other mode. | `renderer/mode/modeLogic.ts` → `sessionMode`, `dataForMode`, `modeStorageKeys`; `useUiMode.ts`, `ModeSwitch.tsx`, `ModeWorkspace.tsx` | `modeLogic.test.ts`; e2e `e2e:codemode` |
| COD-2 | Add repository | Shipped | Code sidebar "Add repository" | Resolves the **git top level**; plain folders, bare repos and linked worktrees are rejected; an already-added repo is returned as is; repos persist in `StoreData.repos`. | `main/git/repoInfo.ts` → `resolveRepoRoot`; `main/app/codeWiring.ts`; `renderer/code/sidebar/CodeSidebar.tsx` | `repoInfo.test.ts`, `codeWiring.part*.test.ts`; e2e `e2e:codemode` |
| COD-3 | Repo tree | Shipped | Code sidebar | Repo > worktree > sessions; collapse state persisted; remove repo stops its sessions and forgets repo/worktrees (files and branches stay on disk). | `main/store/codeReducers.ts`; `renderer/code/sidebar/codeTree.ts` | `codeReducers.test.ts`, `codeTree.test.ts`; e2e `e2e:codemode` |
| COD-4 | Create worktree | Shipped | "New worktree" dialog | Name 1..`WORKTREE_NAME_MAX`; branch/folder derived git-safe (`branchNameFor`, `folderNameFor`); a Windows reserved segment (`con`, `nul`, `aux.v1`, `com1`…) gets `-wt` before its first dot, because git cannot create the branch file `refs/heads/con` on Windows; base = current branch; agent Claude/OpenCode/Shell; `git worktree add -b`; the first session starts inside it; input `cwd` is ignored when `worktreeId` is given. D57 (like Orca), "Start from": **New branch** — a taken name never fails: name, branch and folder get -2, -3 … together (up to -99; branches read once with `for-each-ref`); **Existing branch** — `git worktree add <dir> <branch>` for a local branch, the dialog lists every branch and disables those already checked out (`git worktree list --porcelain` → `RepoBranches.checkedOut`), main refuses a busy branch naming its folder, changes are compared with the default base; **Repo folder** — the repo's own folder as a workspace (`Worktree.main`), on its checked-out branch, once per repo, nothing created on disk, "repo folder" badge in the sidebar, Remove never touches the folder. Code mode only. Jarvis `create_worktree` takes `existing_branch` / `repo_folder`. | `main/git/branchName.ts`, `worktreeCreate.ts`, `repoInfo.ts` (`listCheckedOutBranches`); `main/app/codeWiring.ts`, `ipcValidation.ts`; `renderer/code/dialogs/NewWorktreeDialog.tsx`, `worktreeDialogLogic.ts`, `useWorktreeBranches.ts`; `code/sidebar/CodeWorktreeRow.tsx` | `branchName.test.ts`, `worktreeCreate.part*.test.ts`, `codeWiring.part*.test.ts`, `ipcValidation.code.test.ts`, `persistence.code.test.ts`, `worktreeDialogLogic.test.ts`, `jarvisTools.test.ts`; e2e `e2e:codemode`, `e2e-worktree-sources.cjs` |
| COD-5 | Worktree location | Shipped | Settings > Code | Empty = `<home>/SessionDeck/worktrees/<repo>/<name>`; a set value must be absolute; the repo folder is the repo's folder name. | `main/git/worktreeCreate.ts` → `defaultWorktreesRoot`; `renderer/mode/codeSettingsLogic.ts` | `worktreeCreate.part*.test.ts`, `codeSettingsLogic.test.ts`; e2e `e2e:codemode` |
| COD-6 | Remove worktree | Shipped | Worktree context menu "Remove worktree…" | Stops and removes its sessions from SessionDeck and forgets the worktree; the folder and branch **stay on disk** unless the dialog's "also delete from disk" is ticked (COD-16, D60). | `main/app/codeWiring.ts`; `renderer/code/sidebar/removeCopy.ts` | `codeWiring.part*.test.ts`, `removeCopy.test.ts`; e2e `e2e:codemode` |
| COD-7 | Changes list | Shipped | Side panel > Changes (Code only) | Diff vs `merge-base(base, HEAD)` including committed, staged, unstaged and untracked; renamed/deleted/added kinds; additions/deletions; binary counts null; max 500 files (`truncated`); git errors returned as a readable `error`, not a crash. | `main/git/worktreeChanges.ts`, `worktreeParse.ts`, `untrackedCount.ts`; `renderer/code/changes/*` | `worktreeChanges.part*.test.ts`, `worktreeParse.test.ts`, `untrackedCount.test.ts`, `changesState.test.ts`; e2e `e2e:codemode` |
| COD-8 | File diff | Shipped | Click a changed file | Unified diff for **one listed path only** (main re-validates); binary → `binary: true`, empty diff; cut at 512 KB (`truncated`); renderer parses hunks. | `main/git/worktreeFileDiff.ts`; `renderer/code/changes/parseUnifiedDiff.ts`, `DiffView.tsx` | `worktreeFileDiff.part*.test.ts`, `parseUnifiedDiff.test.ts`; e2e `e2e:codemode` |
| COD-9 | Changes refresh cadence | Shipped | Continuous | Recompute 1.5 s after a Stop hook in that worktree, on open, every 10 s while the panel is visible, every 30 s for row counts; a changed result is pushed to all windows (`ev:worktreeChanges`) only when the content key differs. | `main/app/codeWiring.ts` → `CHANGES_AFTER_TURN_MS`, `changesKey`; `renderer/code/changes/useWorktreeChanges.ts` | `codeWiring.part*.test.ts`, `changesLoad.test.ts`; e2e `e2e:codemode` |
| COD-10 | Pop-out Code window | Shipped | "Open Code in its own window" / "Move Code back" | Second BrowserWindow with `--sessiondeck-window=code`; `windowRole` fixes the renderer to Code; while popped out the main window shows Ops; docking returns Code to the main switch; focus requests route to the owning window. | `main/app/windowRegistry.ts`; `shared/ipc.ts` → `CODE_WINDOW_ARG`; `renderer/mode/useUiMode.ts` | `windowRegistry.test.ts`, `modeLogic.test.ts`; e2e `e2e:codemode` |
| COD-11 | Trust-prompt auto-answer | Shipped (opt-in) | Settings > Code switch, default OFF | When on, a fresh Claude session in a new worktree gets Down, then Enter (two writes 0.5 s / 0.4 s apart: Claude Code 2.1.316 drops an Enter sent in the same write as the arrow) at Claude's folder-trust menu. Only `mode === 'new'`, only Claude, only with `worktreeId`, once per process; detection needs both menu labels in the last 4,000 stripped chars; resumed/restarted/Ops/OpenCode/Shell never answered. Exception: the Jarvis session (JRV-1) is always answered. | `main/app/trustPrompt.ts`; `main/app/sessionController.ts`; `shared/types.ts` → `CodeSettings.autoTrustWorktrees`; `renderer/settings/CodeSection.tsx` | `trustPrompt.test.ts`, `sessionController.test.ts`, `settings.code.test.ts`; e2e `e2e:trust` |
| COD-12 | Commit (D60) | Shipped | Changes panel commit box (Ctrl+Enter), Jarvis `commit_worktree` | Each listed file that still differs from HEAD (`ChangedFile.uncommitted`, from `git status --porcelain=v1 -z` read with the changes) gets a tick, all ticked by default; files committed but not in the base yet stay listed without a tick. The unticked set is kept (new files arrive ticked) and pruned when files go. Commit = `git add -A` + `git commit --only -F <msg file>` through one NUL pathspec file with `--literal-pathspecs` (names with spaces, quotes or glob characters are literal; no command-line limit); other staged changes stay staged. An unstaged rename commits both sides. Main refuses an empty message, no files, or a path with nothing to commit; a missing git identity becomes a plain "Git does not know who you are" with the two config commands; hooks run (120 s timeout). `add`/`commit` retry for ~2 s while another git holds `index.lock`. | `main/git/commit.ts`, `main/app/codeGitOps.ts`, `codeGitValidation.ts`; `renderer/code/changes/GitSection.tsx`, `useGitActions.ts`, `gitActionsLogic.ts`, `ChangeRow.tsx` | `branchOps.commit.test.ts`, `codeGitOps.part*.test.ts`, `gitActionsLogic.test.ts`, `worktreeChanges.part*.test.ts`; e2e `e2e:code-git` |
| COD-13 | Branch line + Push (D60) | Shipped | Changes panel branch line, Jarvis `branch_status` / `push_worktree` | Shows the branch, ↑ahead ↓behind (vs the upstream; never pushed = commits the base lacks; behind as of the last fetch, no fetch is done). Push = `git push -u <remote> refs/heads/<b>:refs/heads/<b>` to the upstream's remote, else `origin`, else the only remote; never forced; a rejected push explains "pull or rebase in the session first". Confirm dialog first (Jarvis: in-app Yes/No). Status refreshes with every new Changes result and after each action. | `main/git/branchStatus.ts`; `main/app/codeGitOps.ts`; `renderer/code/changes/GitSection.tsx` | `branchOps.push.test.ts`, `gitActionsLogic.test.ts`; e2e `e2e:code-git` |
| COD-14 | Create PR (D60) | Shipped | Changes panel, Jarvis `create_pr` | Needs its own branch, a remote and a known host (GitHub incl. *github* enterprise hosts, GitLab incl. *gitlab* hosts, Bitbucket Cloud; `remoteHost.ts` parses https / ssh / scp-like URLs). Pushes first when never pushed or ahead. GitHub CLI installed and signed in (`gh auth status`, cached 60 s) → `gh pr create` with title/body (dialog; defaults: last commit subject, list of commit subjects), an existing PR returns its URL; otherwise opens the host's new-PR page in the browser (`shell.openExternal`). The result line offers "Open". e2e seams: `SESSIONDECK_E2E_OPENED_URLS_FILE` (write the URL instead of opening a browser), `SESSIONDECK_E2E_NO_GH=1`. | `main/git/remoteHost.ts`, `pullRequest.ts`, `branchStatus.ts` → `pullRequestDefaults`; `main/app/codeGitOps.ts`; `main/index.ts` (openExternal, gh check) | `remoteHost.test.ts`, `branchOps.gh.test.ts`, `codeGitOps.part*.test.ts`; e2e `e2e:code-git` |
| COD-15 | Merge into base (D60) | Shipped | Changes panel, Jarvis `merge_worktree` | Hidden for the repository-folder workspace. Refuses while the worktree has uncommitted files, when the repository folder is not on the base branch, or has uncommitted tracked changes. `git merge --no-ff --no-edit <branch>` in the repository folder; nothing to merge = "Already up to date"; a conflict is aborted at once (`git merge --abort`) and its files listed; nothing changes. Confirm first. | `main/git/merge.ts`; `main/app/codeGitOps.ts` | `branchOps.merge.test.ts`, `codeGitOps.part*.test.ts`; e2e `e2e:code-git` |
| COD-16 | Delete a worktree from disk (D60) | Shipped | Remove worktree… dialog checkbox (off by default), Jarvis `remove_worktree delete_from_disk` | Not offered for the repository folder (main refuses too). The dialog reads `worktree:removalInfo` (uncommitted files, branch merged into base) and warns in red; with warnings the button says "Delete anyway" and sends `discardChanges` / `deleteUnmergedBranch`. Main checks again before touching anything, then stops the sessions (they hold the folder on Windows), `git worktree remove [--force]` with retries for ~6 s (an empty folder git left behind because an exiting process still held it is removed; a folder with files never), then `git branch -d` (merged) / `-D` (only when allowed); what stayed is reported (`WorktreeRemoveResult.note`, shown in the sidebar banner). | `main/git/worktreeDelete.ts`; `main/app/codeGitOps.ts`; `renderer/code/sidebar/RemoveWorktreeDialog.tsx`, `removeWorktreeLogic.ts`, `useCodeSidebar.ts`, `useCodeCommands.ts` | `branchOps.delete.test.ts`, `codeGitOps.part*.test.ts`, `removeWorktreeLogic.test.ts`; e2e `e2e:code-git` |
| COD-17 | Detach the Changes panel (D83) | Shipped | Header button of the Changes tab (`data-changes-detach`) | Opens the worktree's Changes UI in its own window (`changes:detach` -> `changesWindows`: one per worktree, a repeat request focuses/restores it, cap 8; main checks the worktree exists and builds the title "Changes · <name> · SessionDeck"). The window is not registered (role main), carries `--sessiondeck-changes=` and mounts only `ChangesWindow` (`ChangesPanel layout="split"`: list 300 px left, diff right, first file auto-selected by `splitSelection`). Live by the 10 s poll + refresh (pushed `ev:worktreeChanges` only reaches registered windows); no annotation UI (no target). The side panel keeps working. | `main/app/changesWindows.ts`, `window.ts`, `ipcHandlers.ts`, `index.ts`; `preload/index.ts`; `renderer/code/changes/ChangesPanel.tsx`, `ChangesWindow.tsx`, `changesWindowLogic.ts`; `renderer/main.tsx`; `notes/NotesPanel.tsx` | `changesWindows.test.ts`, `ChangesPanel.test.tsx`, `changesWindowLogic.test.ts`; e2e `e2e:changes-detach` |

### 2.13 WIN — Windows, tray & app lifecycle

| ID | Feature | Status | Trigger / entry | Rules (must-know) | Code | Tests |
|---|---|---|---|---|---|---|
| WIN-1 | Main window | Shipped | App start | Hidden title bar with Orca look; `ready-to-show` with a fallback so the window always appears; renderer gets store/runtime on load. | `main/app/window.ts`; `renderer/App.tsx` | e2e `e2e.cjs` |
| WIN-2 | Second Code window | Shipped | Pop out / dock | See COD-10; events are broadcast to both windows. | `main/app/windowRegistry.ts`; `main/index.ts` | `windowRegistry.test.ts`; e2e `e2e:codemode` |
| WIN-3 | Quit | Shipped | Tray "Quit", Settings > General | Graceful quit flushes the store (last change saved); a hidden-to-tray window is not a quit; `quitState` guards re-entry. | `main/app/quitState.ts`; `main/store/persistence.ts` | `quitState.test.ts`; e2e `e2e:robust` |
| WIN-4 | Start on login | Shipped (packaged only) | Settings > General | `app.setLoginItemSettings`; unsupported/unpackaged reports `supported: false`; never fails the dialog. | `main/app/loginItem.ts` | `loginItem.test.ts` |
| WIN-5 | Focus a session from outside | Shipped | Tray item, notification click, away row | `ev:focusSession`; main window switches mode if needed unless Code is popped out; the owning window opens/activates the session; a grid cell is focused once grid ships. | `main/app/windowRegistry.ts`, `activeSessions.ts`; `renderer/App.tsx` → `decideFocus`; `mode/useWorkspaceNav.ts` | `activeSessions.test.ts`, `modeLogic.test.ts`; e2e `e2e-bell`, `e2e:away` |
| WIN-6 | Error / window logs | Shipped | Failures | `<userData>/main-errors.log` for uncaught exceptions/rejections (no blocking dialog); `<userData>/window-events.log` for window lifecycle — first place to look if the window does not appear. | `main/app/errorLog.ts`, `window.ts` | `errorLog.test.ts` |
| WIN-7 | Navigation guard | Shipped | `will-navigate` | Compares origin/path/query rather than a string prefix; external navigation blocked. | `main/app/navigation.ts` | `navigation.test.ts` |

### 2.14 SET — Settings & persistence

| ID | Feature | Status | Trigger / entry | Rules (must-know) | Code | Tests |
|---|---|---|---|---|---|---|
| SET-1 | Settings dialog | Shipped | Sidebar gear, palette, status bar | Sections: General, Agents, Code, Sound, Automation, Quota, Statuses; changes go through `settings:update` and come back resolved. | `renderer/settings/SettingsDialog.tsx` + section files | e2e `e2e:dialogs`, `e2e:g1`, `e2e:hub` |
| SET-2 | Settings validation and defaults | Shipped | Every settings write | Main validates each field (`settingsValidation.ts`, `store/settings.ts`); invalid writes are rejected; missing stored fields fall back to `DEFAULT_APP_SETTINGS`; partial patches merge per section. | `shared/types.ts` → `DEFAULT_APP_SETTINGS`, `resolveSettings`; `main/app/settingsValidation.ts`; `main/store/settings.ts` | `settingsValidation.test.ts`, `settingsValidation.code.test.ts`, `settings.test.ts`, `settings.code.test.ts` |
| SET-3 | Store durability | Shipped | Load / save | Store at `<userData>/sessiondeck-store.json`; a read error that is **not** invalid JSON/shape (EPERM/EBUSY/EIO) aborts startup and never overwrites the file; invalid JSON/shape is renamed and starts empty; a successful load keeps `<file>.bak`; saves are serialized and use a unique temp file `<path>.<pid>.<uuid>.tmp`; timer failures are logged, `flush()` rejects. | `main/store/persistence.ts`; `main/app/paths.ts` | `persistence.test.ts`, `persistence.code.test.ts`; e2e `e2e:robust` |
| SET-4 | Invalid stored data | Shipped | Load | Invalid notes/checklist/worktree/settings values are dropped per field instead of failing the whole file; open sessions come back `exited`. | `main/store/persistence.ts`, `sessionNotes.ts`, `codePersistence.ts` | `persistence.notes.test.ts`, `persistence.code.test.ts`, `sessionNotes.test.ts` |
| SET-5 | UI preferences (localStorage) | Shipped | Various UI controls | See §3.3; every access is guarded because localStorage can throw (quota/private mode); malformed values fall back to defaults. | `renderer/shell/shellPrefs.ts`; `Sidebar/sidebarPrefs.ts`; `mode/modeLogic.ts` | `shellPrefs.test.ts`, `openTabsLogic.test.ts`, `splitLogic.test.ts`, `modeLogic.test.ts` |

### 2.15 PAL — Command palette

| ID | Feature | Status | Trigger / entry | Rules (must-know) | Code | Tests |
|---|---|---|---|---|---|---|
| PAL-1 | Open shortcuts | Shipped | `Ctrl+K`, `Ctrl+Shift+K` | `Ctrl+Shift+K` opens anywhere except over an open dialog; plain `Ctrl+K` opens only outside the terminal and text inputs (in the terminal it is readline delete-to-end-of-line); never over another dialog. | `renderer/palette/paletteShortcut.ts`, `usePaletteShortcut.ts` | `paletteShortcut.test.ts`; e2e `e2e:palette` |
| PAL-2 | Items and groups | Shipped | Palette open | Groups: **Sessions** (all sessions with folder/state, bells first, then open, sleeping, closed), **This session** (sleep, keep awake, read/unread, set status), **Actions** (new session, open Hub, open settings, show away summary). | `renderer/palette/paletteItems.ts` | `paletteItems.test.ts`; e2e `e2e:palette` |
| PAL-3 | Filtering and ranking | Shipped | Typing | Every token must match label/detail/keywords; label-prefix matches rank first; max 50 results; cmdk filtering disabled (`shouldFilter={false}`). | `renderer/palette/paletteFilter.ts` | `paletteFilter.test.ts`; e2e `e2e:palette` |
| PAL-4 | Command execution and focus return | Shipped | Choosing an item | Commands are plain data mapped by `runPaletteCommand` to App handlers / `window.api`; closing returns focus where it was (often the terminal). | `renderer/palette/runCommand.ts`, `CommandPalette.tsx` | `runCommand.test.ts`; e2e `e2e:palette` |

### 2.16 WRK — OpenCode worker tabs

| ID | Feature | Status | Trigger / entry | Rules (must-know) | Code | Tests |
|---|---|---|---|---|---|---|
| WRK-1 | Worker plugin injection | Shipped | Any `opencode` started from a Claude terminal | Each Claude pty gets `OPENCODE_CONFIG_CONTENT` with only a plugin entry (merged with the user's own value; never a permission rule); the plugin lives in the package directory `<userData>/sessiondeck-attention/sessiondeck-worker-plugin/` (package.json `main` → index.mjs — OpenCode v2 loads configured plugins from package directories only). | `main/workers/workerPluginSource.ts`, `workerPluginEnv.ts`; `main/opencode/pluginEnv.ts`, `writePlugin.ts` | `workerPlugin.test.ts`, `workerPluginEnv.test.ts`, `pluginEnv.test.ts`; e2e `e2e:workers` |
| WRK-2 | Worker events and heartbeat | Shipped | Plugin → hook server | Ordered POSTs to `POST /worker/<claudeSessionId>/event` (token header, 32 KB cap); payloads validated; 5 s heartbeat; no heartbeat for 20 s → `failed` "lost". | `main/workers/workerEvents.ts`, `WorkerHub.ts`; `main/attention/HookServer.ts` | `workerEvents.test.ts`, `WorkerHub.test.ts`, `HookServer.worker.test.ts`; e2e `e2e:workers` |
| WRK-3 | Worker hub limits | Shipped | Continuous | Max 50 workers per session, 400 lines each; name from the session title else the first prompt line; running → done on idle; error + idle → failed; usage limits flagged; **in memory only**; no folder scanning. | `main/workers/WorkerHub.ts` | `WorkerHub.test.ts` |
| WRK-4 | Worker tabs and view | Shipped | Claude session with workers | Read-only tabs; finished tabs close 2 min after ending unless being read; `×` only hides; selecting any session or the Hub leaves the worker view; an empty view explains that plugin-less (`--pure`) processes are invisible and suggests a restart. | `renderer/workers/useWorkers.ts`, `WorkerTabs.tsx`, `WorkerView.tsx`, `workerLogic.ts` | `workerLogic.test.ts`; e2e `e2e:workers` |
| WRK-5 | Worker limitations | Gap | — | `opencode --pure` (no plugins) invisible; Claude sessions opened before the feature need a restart; workers started from an OpenCode session inside the app are not covered; no interactive worker terminal and no resume-from-tab (deferred). | — | See `HANDOFF.md` |

### 2.17 SEC — Robustness & security

| ID | Feature | Status | Trigger / entry | Rules (must-know) | Code | Tests |
|---|---|---|---|---|---|---|
| SEC-1 | IPC validation | Shipped | Every renderer → main call | Each handler validates ids/payloads (`assertId`, `assertBoolean`, `asCreateWorktreeInput`, …); malformed calls reject without wedging main; late IPC after a session stopped is safe. | `main/app/ipcValidation.ts`, `ipcHandlers.ts`, `codeWiring.ts` | `ipcValidation.test.ts`, `ipcValidation.code.test.ts`, `ipcValidation.notes.test.ts`; e2e `e2e:robust` |
| SEC-2 | Hook server token and caps | Shipped | Hooks / statusLine / workers | Local HTTP server; per-app token checked on every request; body caps (64 KB statusLine, 32 KB worker); oversized bodies drained, not backed up. | `main/attention/HookServer.ts` | `HookServer.test.ts`, `HookServer.route.test.ts`, `HookServer.statusLine.test.ts` |
| SEC-3 | Credentials stay in main | Shipped | Manual usage refresh | The Claude OAuth token is read and used only in main; never sent over IPC, stored or logged; errors and logs are asserted not to contain it. | `main/usage/oauthUsage.ts`, `usageRefresh.ts` | `oauthUsage.test.ts`, `usageRefresh.test.ts`; e2e `e2e:usage-refresh` |
| SEC-4 | Process-tree kill | Shipped | Close / remove / quit | Whole tree is killed while the parent is alive; no orphan dev servers. | `main/pty/treeKiller.ts` | `treeKiller.test.ts`; e2e `e2e:busyclose` |
| SEC-5 | Test isolation | Shipped | Any e2e / smoke test | Tests use a temp user-data dir and never change the user's real Claude/OpenCode config; never send state-changing slash commands into a test Claude session; use a temp `--settings` file (W11). | `scripts/e2e-lib.cjs` | e2e suites |

### 2.18 JRV — Jarvis (D53, D54)

| ID | Feature | Status | Trigger / entry | Rules (must-know) | Code | Tests |
|---|---|---|---|---|---|---|
| JRV-1 | Jarvis session + panel | Shipped | `Ctrl+Shift+J` (toggle), the Jarvis button at the right of the tab bar (both modes), palette "Open Jarvis" / "Jarvis: start a new conversation" | ONE Claude session with `Session.role = 'jarvis'` (only main can create it: IPC `session:create` rejects `role`), created on first open in `<userData>/jarvis` (name "Jarvis"); `jarvis:open` creates, reopens, wakes or starts it (serialized in main, no focus request). Shown ONLY in a right-side overlay panel (per window, mounted by `App` outside the mode workspace: stays open across session, tab and Ops/Code switches), never as a tab, sidebar card, Hub card or needs-you item (`dataForMode` filters it). Terminal created on first open, slid out (not resized) on close; width drag-resizable 340 px..75% of the window, remembered. Main counts it as always on screen (no ping/bell, never auto-slept). Its folder-trust question is always answered (Down, then Enter). "New conversation" removes it and creates a fresh one. | `main/jarvis/jarvisWiring.ts`; `main/index.ts` (`onScreenSessionIds`); `renderer/jarvis/JarvisPanel.tsx`, `jarvisPanelStore.ts`, `jarvisLogic.ts`, `useJarvisShortcut.ts`; `shell/TabBar.tsx`; `mode/modeLogic.ts` → `dataForMode`; `App.tsx` | `jarvisLogic.test.ts`, `sessionController.test.ts` (trust), `persistence.test.ts`, `ipcValidation.test.ts`; e2e `e2e-jarvis.cjs`, `e2e-jarvis-real.cjs` |
| JRV-2 | MCP tool server | Shipped | App start (before resume-on-launch) | `POST /mcp` on `127.0.0.1:<random>`, `Authorization: Bearer <per-run token>`, JSON-RPC 2.0 (initialize, ping, tools/list, tools/call), plain JSON answers, notifications 202, GET 405, 1 MB body cap. `<userData>/jarvis/mcp.json` + `system-prompt.md` are rewritten each run; the prompt lists every tool name (`jarvisSystemPrompt(toolNames)`). Only Jarvis is launched with `--mcp-config <mcp.json> --append-system-prompt-file <prompt> --model <m>` (via `SessionControllerDeps.launchExtras` → `{ claudeArgs }`; an OpenCode Jarvis gets `{ opencodeConfig }`, JRV-5); the user's `~/.claude` is never changed. | `main/jarvis/mcpProtocol.ts`, `mcpHttpServer.ts`, `jarvisLaunch.ts`; `main/app/startOptions.ts` (`LaunchExtras`); `main/index.ts` | `mcpProtocol.test.ts`, `mcpHttpServer.test.ts`, `jarvisLaunch.test.ts`; e2e `e2e-jarvis.cjs` |
| JRV-3 | Tools | Shipped | Jarvis calls them | Tools: `list_sessions`, `read_screen` (pty replay drawn in `@xterm/headless`), `get_activity`, `search_conversations`, D54: `wait_for_session` (until not working and no queued prompts; default 600 s, max 1800 s, polls 1 s; "still working" on timeout), `get_last_answer` (assistant text after the last user message in the saved Claude transcript, keeps the end, default 4000 / max 20000 chars; screen fallback for OpenCode/shell), `get_usage` (Claude 5-hour/weekly %, resets, OpenCode Go, cost today, running sessions' model/context/cost), `get_away_summary` (the last "While you were away"), Code mode (D54): `list_repos` (repos, current + local branches, worktrees with sessions), `add_repo`, `create_worktree` (base = the checked-out branch unless given; must be a local branch; optional first prompt), `worktree_changes` (files with kind and +/- vs the base), `create_session` (folder or preset, optional first prompt), `send_prompt` (auto: wake/start if needed, type when the screen settled, queue while working; now; queue), `broadcast_prompt`, `press_keys`, `sleep_session`, `wake_session` (sleeping→wake, stopped→start, closed→reopen), `restart_session`, `close_session`, `fork_session`, `remove_session`, `remove_worktree`, `rename_session`, `set_status`, `move_to_group`, `create_group`, `remove_group`, `set_notes`, `set_keep_awake`, `open_session`; D55 adds JRV-9 and JRV-10 (65 tools in all). Same controller/store/queue paths as the UI. Names resolve by id, exact name, or a unique part; ambiguity is an error listing candidates; Jarvis is never a target. Typing never goes into a folder-trust question. Every action is appended to `<userData>/jarvis/actions.log` (reset past 1 MB). **D79:** `fleet_digest` (one call for every session: agent, state and time in it, last prompt, reply tail, pending question, cost today, uncommitted files; needing-you first; about 6000 chars; `only_needing_attention`, `limit`), `set_session_model` (OpenCode only; the conversation survives: sleep + wake with `-s`; undo puts the model back); `get_last_answer` and `fork_session` now work for OpenCode sessions (`fork_session` makes a COPY: export, fresh ids, import). 88 tools. **D80:** `plan_create`, `plan_status`, `plan_cancel` (task plans, opt-in, see JRV-8). 91 tools. | `main/jarvis/jarvisTools.ts`, `targets.ts`, `screenText.ts`, `toolArgs.ts` | `jarvisTools.test.ts`, `targets.test.ts`, `screenText.test.ts`; e2e `e2e-jarvis.cjs` (shell sessions), `e2e-jarvis-real.cjs` |
| JRV-9 | App-wide tools (D55) | Shipped | Jarvis calls them | `get_settings` / `update_settings` (patch by section through `asSettingsPatch`, undo puts back exactly the touched fields; changing the Jarvis engine warns), `queue_list` / `queue_change` (add at a position, remove, move, clear, send_now via `promptQueue.sendNow`), `checklist_get` / `checklist_change` (add, check, uncheck, remove, clear; validated by `asChecklist`), `group_change` (rename, collapse, expand, reorder), `status_change` (create, update, reorder; remove asks), `preset_change` (list, save through `asPreset`, remove asks), `bulk_action` (sleep, wake, close, set_status, move_to_group, keep_awake, mark_read/unread over sessions / which / group / status, max 100; runs the single-session tools, so their rules and undo apply), `needs_you`, `set_read`, `refresh_usage` (needs the user's one-time consent), `quota_autopilot` (status, sleep_idle, wake_held), `cost_report` (per local day + top sessions), `remove_repo` (asks), `file_diff`, `send_review_comments` (the same text as the Changes panel's Send: `shared/reviewComments.ts`), `list_workers`, `code_window` (pop out / dock). Items are numbers or text. | `main/jarvis/appTools.ts`; deps wired in `main/index.ts` (`app`); `main/app/codeWiring.ts` (`removeRepo`, `fileDiff`) | `jarvisTools.test.ts` ("Jarvis app tools"); e2e `e2e-jarvis-control.cjs` |
| JRV-10 | Screen tools (D55) | Shipped | Jarvis calls them | `get_screen_state`, `switch_mode` (a popped-out Code window is brought forward instead), `set_view`, `set_grid` (preset + cells by session name, one mode only, no duplicates), `split_view` (right/down/unsplit, or a given session beside), `show_sidebar`, `side_panel` (notes/activity/queue/changes, optionally showing a session first), `open_dialog` (settings page, costs, search, away, palette, new session, none), `terminal_zoom`, `worker_tab` (show/dismiss/leave). Main resolves names, picks the mode and sends `ev:jarvisUi` to the window of that mode (Code → the Code window when popped out); `App` switches mode first when needed and waits (4 s) for that workspace to register; the workspace runs the action with the same hooks as its buttons (`runWorkspaceAction`) and answers through `jarvis:uiReply` (10 s timeout = error). | `main/jarvis/uiTools.ts`, `jarvisWiring.ts` (`ui`); `renderer/jarvis/useJarvisUi.ts`, `jarvisUiBridge.ts`, `workspaceUi.ts`; `mode/ModeWorkspace.tsx` | `jarvisTools.test.ts` ("Jarvis screen tools"), `renderer/jarvis/workspaceUi.test.ts`; e2e `e2e-jarvis-control.cjs` |
| JRV-11 | The rest of the app (D58) | Shipped | Jarvis calls them | `sound_settings` (on/off, volume 0-100, a sound per event: built-in id, none or an audio file that must exist; test play; a window action `sound` run by `useJarvisUi` in the main window on the window's sound store), `sidebar_view` (group by, folder buckets, search, status filter by name, Closed section, collapse/expand all; the sidebar registers a control in `sidebarView.ts`; Code mode: search, Closed and sort; D61: `sort`), `code_tree` (collapse/expand a repo, a worktree or all, through the store, with undo), `open_file` (a changed file's diff or preview next to its session: opens the session and the Changes tab, then `changesRequest.ts` hands the file to `ChangesPanel`; the path must be in the worktree's changes), `terminal_search` (find / next / previous / close on the bar of the session on screen), `switch_tab` (next, previous, close others, close all), `attach_files` (full paths that exist, max 20, typed like a file drop; bracketed paste when the agent turned it on (last `ESC[?2004h` after `ESC[?2004l`); `image_via_clipboard` puts one image on the clipboard and sends Alt+V (Claude) / Ctrl+V (OpenCode)), `open_link` (the terminal link service: URLs, files, folders; programs and scripts are only shown in their folder, `OpenLinkResult.revealed`), `app_window` (show, hide to tray, start on login on/off/status (installed app only, undo), quit after a Yes/No, 1.5 s after answering), `restart_jarvis` (in `jarvisWiring`: 2.5 s after answering; fresh = new conversation; applies a changed engine/model). `get_screen_state` also shows the sounds, the sidebar list view and the search bar. | `main/jarvis/controlTools.ts`, `jarvisWiring.ts`, `main/links/appLinks.ts`; `renderer/jarvis/windowUi.ts`, `sidebarView.ts`, `workspaceUi.ts`; `renderer/code/changes/changesRequest.ts` | `jarvisTools.test.ts`, `windowUi.test.ts`, `workspaceUi.test.ts`, `LinkService.test.ts`; e2e `e2e-jarvis-app.cjs` |
| JRV-12 | Git tools (D60) | Shipped | Jarvis calls them | `branch_status`, `commit_worktree` (message required; files default to every uncommitted file; no confirm: local), `push_worktree`, `create_pr`, `merge_worktree` (each asks Yes/No first), `remove_worktree` gains `delete_from_disk` / `discard_changes` / `delete_unmerged_branch` (the confirm text says what is deleted or kept). `worktree_changes` marks uncommitted files. They call `codeWiring.git` (`codeGitOps`), the Changes panel's path; `index.ts` passes it as a getter and `gitTools.ts` reads it per call, because Jarvis's tools are built before Code mode's wiring. 80 tools in all. | `main/jarvis/gitTools.ts`, `jarvisTools.ts` (remove_worktree, worktree_changes) | `jarvisTools.test.ts`; e2e `e2e-code-git.cjs`, `e2e-jarvis.cjs` (count) |
| JRV-13 | Tuning for the PC (D71) | Shipped | Ask Jarvis "tune the settings for my PC" | `get_system_info` reads the PC (OS, CPU and logical cores, RAM total / free, screens with scale, GPU mode / renderer / saved preference, sessions open / running / working) and prints tuning hints that name the setting and value (rules: no GPU = renderer dom + effects reduced + GPU off; RAM under 8 GB = scrollback 3000 and sleep idle sessions after 20 min, 8-16 GB = 5000-10000, over 16 GB = up to 20000; under 4 cores = effects reduced; big or scaled screen = zoom 110). Then `terminal_settings` (renderer, effects, scrollback, exact zoom, right-click), `gpu_setting` (auto / on / off, applies after a restart), `update_settings` (every stored section; autoStatus mappings accept status NAMES), `sidebar_width` (220-640px), `jarvis_panel_settings` (read replies aloud, panel width), plus the earlier `sound_settings`, `sidebar_view`, `terminal_zoom`, `app_window`. Window-side settings go through window actions (`terminalPrefs`, `sidebarWidth`, `jarvisPrefs`) so the mounted UI follows at once. Jarvis's prompt tells it to report each change as old -> new with the reason. Not possible yet: collapsing one status section / folder bucket, split pane sizes. | `main/jarvis/systemTools.ts`, `prefsTools.ts`, `layoutTools.ts`, `panelTools.ts`, `appTools.ts` (`withStatusIds`), `jarvisLaunch.ts`; `renderer/jarvis/terminalPrefsUi.ts`, `jarvisPrefsUi.ts`, `windowUi.ts`, `workspaceUi.ts`; `main/index.ts` (`system` deps) | `systemTools.test.ts`, `prefsTools.test.ts`, `layoutTools.test.ts`, `panelTools.test.ts`, `appTools.autoStatus.test.ts`, `terminalPrefsUi.test.ts`, `jarvisPrefsUi.test.ts`, `workspaceUi.test.ts`; e2e `e2e:jarvis-tuning` |
| JRV-4 | Confirm destructive tools | Shipped | `remove_session`, `remove_worktree`, `remove_group` | Main shows the window and sends `ev:jarvisConfirm`; the main window shows the Orca ConfirmDialog (queue, one at a time); the answer comes back via `jarvis:confirmReply`. No window, Cancel or 120 s without an answer = No, and Jarvis is told nothing changed. | `main/jarvis/jarvisWiring.ts` (`confirm`); `renderer/jarvis/JarvisConfirm.tsx` | `jarvisTools.test.ts`; e2e both Jarvis suites |
| JRV-6 | Scheduled instructions | Shipped | Ask Jarvis ("every weekday at 9:00 …"); the clock button in the panel header lists them | `schedule_add` / `schedule_list` / `schedule_remove` tools; `<userData>/jarvis/schedules.json` (max 50; instruction ≤2000, label ≤60; local HH:MM; days = every day / weekdays / weekends / names; once). Checked every 30 s; a run more than 15 min late (app closed, PC asleep) is skipped; a run is marked before delivery (never twice), a one-time one is then disabled. Delivery = Jarvis is opened/started and gets "[Scheduled task …] <instruction>" through the same sender as `send_prompt` (queued behind a running Jarvis turn; trust question retried), plus a desktop notice. Panel list: pause / resume / delete (IPC `jarvis:schedules*`, event `ev:jarvisSchedules`). | `main/jarvis/schedules.ts` (pure), `scheduleService.ts`, `jarvisWiring.ts` (`deliver`); `shared/jarvisSchedule.ts`; `renderer/jarvis/JarvisSchedules.tsx` | `schedules.test.ts`, `jarvisTools.test.ts`; e2e `e2e-jarvis.cjs` (tools + list UI), `e2e-jarvis-real.cjs` (a real run 2 min ahead) |
| JRV-7 | Undo | Shipped | Ask Jarvis ("undo that") → `undo_last_action`; the Undo button in the panel header | In-memory stack (last 20, this run) of inverses recorded by sleep (→ wake), wake (→ sleep, or close for a reopen), close (→ reopen), create_session (→ close), rename, set_status, move_to_group (old group + position), set_notes, set_keep_awake, create_group (→ delete), schedule_add (→ remove), schedule_remove (→ add back). One step per call, newest first; says what it undid and what is next; a gone target is reported, not thrown. Removals and worktree creation are not undoable. | `main/jarvis/jarvisTools.ts` (`pushUndo`, `undoLast`); IPC `jarvis:undo`; `renderer/jarvis/JarvisPanel.tsx` | `jarvisTools.test.ts`; e2e `e2e-jarvis.cjs` |
| JRV-8 | Voice | Shipped | Panel header: mic button (talk), speaker toggle (read replies aloud) | Talk: main runs Windows' offline recognizer (System.Speech dictation through PowerShell, no cloud) for one sentence (8 s initial silence, 30 s max), then sends the words to Jarvis through the `send_prompt` sender; the panel shows "Heard: …"; the mic button stops listening; logged as `voice`. Language = the recognizers Windows has installed (en-US by default); a missing recognizer or blocked microphone gets a plain message. Read aloud: on a Jarvis (Claude engine) Stop hook main sends the reply from the transcript (`ev:jarvisReply`); the main window speaks it with the system voices when the toggle is on (`sessiondeck.jarvis.speak.v1`), as plain words (`speakableText`: no markdown/code, ≤1200 chars). Not for an OpenCode Jarvis (no transcript). Test seam `SESSIONDECK_VOICE_WAV` = recognize a WAV instead of the mic. | `main/jarvis/voice.ts`, `jarvisWiring.ts` (`voiceCommand`, `onHookEvent`); `renderer/jarvis/JarvisPanel.tsx`, `JarvisSpeaker.tsx`, `jarvisLogic.ts` | `voice.test.ts`, `jarvisLogic.test.ts`; e2e `e2e-jarvis-voice.cjs` |
| JRV-5 | Jarvis engine + model | Shipped | Settings > Agents "Jarvis engine", "Jarvis OpenCode model", "Jarvis model (Claude)" | `jarvis.agent` (`claude` default \| `opencode`, D54), `jarvis.opencodeModel` (provider/model, empty = OpenCode default), `jarvis.model` (Claude `--model`, default `sonnet`; letters/digits/`._:[]-` only since it reaches cmd.exe). OpenCode Jarvis gets `mcp.sessiondeck` (type remote, Bearer header) + `instructions: [system-prompt.md]` merged into its `OPENCODE_CONFIG_CONTENT` (`LaunchExtras.opencodeConfig`; verified OpenCode 2.1.4 calls the tools). Changing the engine or the OpenCode model replaces Jarvis with a new conversation on the next open; the Claude model applies at Jarvis's next start. **D79:** switching the Jarvis OpenCode MODEL keeps the conversation (`-s`); only switching the ENGINE starts a new one. An OpenCode Jarvis's finished reply reaches the panel and read-aloud like a Claude one (read from `opencode session export`). | `shared/types.ts` (`JarvisSettings`), `main/store/settings.ts`; `renderer/settings/AgentsSection.tsx` | `settings.test.ts`; e2e `e2e-jarvis.cjs` |
| JRV-8 | Watch mode + task plans (D80) | Shipped | Settings > Agents > Jarvis: "Watch the fleet" (`jarvis.watchEnabled`, `watchEveryMinutes` 1..120, default 10) and "Task plans" (`jarvis.plansEnabled`), both OFF by default. **Watch:** a timer (`jarvis/watchService.ts`) hands Jarvis ONE `[Watch]` message with the fleet digest when a session waits for an ANSWER (a permission or a question; a finished turn's unread bell is not urgent and is not reported) 3+ min or is working with no state change 20+ min; each episode once; the first check runs as soon as the switch is turned on (then every N minutes); the message stays under the 4000-character prompt limit; it is only delivered to a Jarvis that is already open (a timer never creates, wakes-from-nothing or replaces Jarvis; nothing is remembered while it cannot be told); nothing is read or sent when nothing needs attention; Jarvis may answer only obvious, harmless questions, otherwise tells the user. **Plans:** `plan_create` (goal + up to 8 steps, each in an existing session or a NEW Claude/OpenCode session, `depends_on`, `{{stepId}}` pastes an earlier step's answer), `plan_status`, `plan_cancel`; at most 3 plans and 3 steps running at once; a step times out after 30 min (counted from the call; judged only after its prompt was typed); a session that is closed, stopped or put to sleep fails its step; a finished turn's unread bell does NOT count as "waiting"; pasted answers are cut so a prompt stays under 4000 characters; the `[Plan finished]` message is capped under 4000 characters; a failed step skips its dependents; when a plan ends Jarvis gets a `[Plan finished]` message. Plans are in memory only (a restart forgets them); turning the toggle off cancels running plans (sessions already working are left alone). | `jarvis/watchService.ts`, `planTypes.ts`, `planService.ts`, `planTools.ts`, `digestTools.ts` (`collectWatchRows`, `planPhaseOf`), `jarvisWiring.ts`, `renderer/settings/AgentsSection.tsx` | unit tests per file; `e2e-jarvis-plans.cjs` |

---

## 3. Cross-cutting maps

### 3.1 IPC invokes (renderer → main)

| Channel (`IPC.*`) | Feature | Handler |
|---|---|---|
| `store:get` | Bootstrap | `ipcHandlers` |
| `session:create` | SES-1 | `sessionController` |
| `session:rename` | SES-2 | `reducers.renameSession` |
| `session:setStatus` | SES-3 | `reducers.setSessionStatus` |
| `session:move` | SES-5 | `reducers.moveSession` |
| `session:remove` | SES-8 | `sessionController` |
| `session:close` | SES-6 | `sessionController` |
| `session:reopen` | SES-7 | `sessionController` |
| `session:setKeepAwake` | SES-10 | `reducers.setKeepAwake` |
| `session:setNotes` / `session:setChecklist` | NTS-1/2 | `sessionNotes` |
| `session:fork` / `conversation:search` | SES-18 / SES-19 | `sessionController.forkSession`, `conversationSearch.search` |
| `preset:save` / `preset:remove` | SES-16 | `presets.upsertPreset`, `presets.removePreset` |
| `session:setQueue` / `session:sendQueuedNow` | SES-15 | `sessionNotes.setSessionQueue`, `promptQueue.sendNow` |
| `session:setActive` | SES-13 | `activeSessions` |
| `jarvis:open` / `jarvis:reset` / `jarvis:confirmReply` | JRV-1 / JRV-4 | `jarvisWiring` |
| `jarvis:uiReply` | JRV-10 | `jarvisWiring` (commandId, ok, text ≤ 20000) |
| `jarvis:schedulesGet` / `jarvis:scheduleRemove` / `jarvis:scheduleSetEnabled` | JRV-6 | `scheduleService` |
| `jarvis:undo` | JRV-7 | `jarvisTools.undoLast` |
| `jarvis:voice` / `jarvis:voiceCancel` | JRV-8 | `jarvisWiring.voiceCommand`, `voice.cancel` |
| `session:sleep` | SES-9 | `sessionController` |
| `group:create` / `group:rename` / `group:remove` / `group:setCollapsed` / `group:reorder` | SES-4 | `reducers` |
| `status:upsert` / `status:remove` / `status:reorder` | SES-3 | `reducers` |
| `pty:write` / `pty:resize` / `pty:restart` / `pty:replay` | TRM-1/2/9/11 | `PtyManager` |
| `attention:clear` / `attention:markUnread` | ATT-2/3 | `AttentionManager` |
| `app:userActivity` | AUT-4 | `SleepScheduler`, `userPresence` |
| `settings:setSound` | ATT-5 | `settings` |
| `dialog:pickFolder` / `dialog:pickSoundFile` | SES-1 / ATT-5 | `dialog` |
| `settings:update` | SET-1/2 | `settingsValidation` |
| `app:loginItemGet` / `app:loginItemSet` | WIN-4 | `loginItem` |
| `link:resolve` / `link:open` | TRM-5 | `LinkService` |
| `file:viewRead` / `file:viewDetach` | TRM-13 | `readFileView` (main/preview), `openFileViewer` window |
| `file:viewStat` | TRM-13 | `statFileView` (live reload poll) |
| `file:viewRange` | TRM-13 | `readPdfRange` (byte range of a big PDF, D75) |
| `dialog:pickViewFile` | TRM-13 | open-file dialog for the palette's Preview file... |
| `opencode:infoGet` / `opencode:recheck` | AGT-2 | `capabilities.ts` (`getOpencodeInfo`, `recheckOpencode`) |
| `app:quit` | WIN-3 | `quitState` |
| `usage:get` / `usage:refresh` | USE-2/4 | `UsageService`, `usageRefresh` |
| `workers:get` | WRK-3/4 | `WorkerHub` |
| `timeline:get` / `away:getLast` | TML-1/6 | `timelineService`, `featureWiring` |
| `quota:autopilotGet` / `quota:sleepIdle` / `quota:wake` | USE-7/8/9 | `autopilot` |
| `repo:*` / `worktree:*` | COD-2..9, COD-12..16 (D60: `worktree:branchStatus`, `worktree:commit`, `worktree:push`, `worktree:createPr`, `worktree:merge`, `worktree:removalInfo`; `worktree:remove` takes `WorktreeRemoveOptions` and returns `WorktreeRemoveResult`) | `codeWiring` + `codeGitOps` |
| `window:getState` / `window:popOutCode` / `window:dockCode` | COD-10 / WIN-2 | `windowRegistry` |

### 3.2 IPC events (main → renderer)

| Event | Payload | Feature |
|---|---|---|
| `ev:store` | full `StoreData` | Every store change |
| `ev:runtime` | one `RuntimeState` | Run/attention/activity/sleeping/RC |
| `ev:ptyData` | `(id, data, seq)` | TRM-1 |
| `ev:usage` | `UsageState` | USE-2 |
| `ev:sound` | `(sessionId, SoundEvent)` | ATT-5/11 |
| `ev:focusSession` | session id | WIN-5 |
| `ev:quota` | `QuotaAlert` | USE-6 |
| `ev:workers` | full `WorkerInfo[]` | WRK-3/4 |
| `ev:timeline` | session id | TML-4 |
| `ev:awaySummary` | non-empty `AwaySummary` | TML-6 |
| `ev:quotaAutopilot` | `QuotaAutopilotState` | USE-9 |
| `ev:worktreeChanges` | `WorktreeChanges` | COD-9 |
| `ev:windowState` | `WindowState` | COD-10 / WIN-2 |
| `ev:jarvisConfirm` | `JarvisConfirmRequest` (main window only) | JRV-4 |
| `ev:jarvisUi` | `JarvisUiCommand` (the window of the command's mode) | JRV-10 |
| `ev:jarvisSchedules` | `JarvisSchedule[]` | JRV-6 |
| `ev:jarvisReply` | reply text (Claude-engine Jarvis turn) | JRV-8 |

### 3.3 localStorage keys

| Key | Owner | Meaning |
|---|---|---|
| `sessiondeck-open-tabs` (+`.code`) | TAB-1 | Open tab ids + active tab |
| `sessiondeck.split.v1` (+`.code`) | TRM-7 | Split direction, panes, sizes |
| `sessiondeck.sidePanelWidth.v1` | TRM-13 | Width of the right side panel (280-1000 px) |
| `sessiondeck.fileview.zoom.v1` | TRM-13 | Text zoom of the file viewer (70-200%) |
| `sessiondeck.view.v1` (+`.code`) | TAB-4 | `terminal` \| `grid` \| `hub` |
| `sessiondeck.notes.open.v1` (+`.code`) | TAB-5 | Side panel open |
| `sessiondeck.sidepanel.tab.v1` (+`.code`) | TAB-5 | Chosen side-panel tab |
| `sessiondeck.mode.v1` | COD-1 | Last main-window mode |
| `sessiondeck.usage.v1` | USE-3 | Cached account usage |
| `sessiondeck.usage.consent.v1` | USE-4 | First-use refresh consent |
| `sessiondeck.usage.history.v1` | USE-6 | Pace history |
| `sessiondeck.sound.v1` | ATT-5 | Per-event sound choices, volume |
| `sessiondeck-sound-enabled` | ATT-5 | Master sound toggle |
| `sessiondeck-sidebar-open` | NAV | Sidebar visibility |
| `sessiondeck-sidebar-groupby` | NAV-3 | `groups` \| `status` |
| `sessiondeck-sidebar-closed-collapsed` | NAV-5 | Closed section collapsed |
| `sessiondeck-sidebar-status-collapsed` | NAV-3 | Collapsed status sections |
| `sessiondeck-sidebar-show-workspaces` | NAV-4 | Workspace buckets on/off |
| `sessiondeck-sidebar-workspace-collapsed` | NAV-4 | Collapsed workspaces per group+folder |
| `sessiondeck.sort.v1` (+`.code`) | NAV-12 | Session sort: `manual` \| `attention` \| `recent` \| `newest` \| `name` (D61) |
| `sessiondeck.sidebarWidth.v1` | NAV-13 | Sessions sidebar width in px (220-640), both modes |

> `.code` suffix is added by `storageKeyFor(base, 'code')`; Ops keeps the historical key. Do not invent new suffixes.

### 3.4 Disk files (`<userData>`)

| File | Feature | Notes |
|---|---|---|
| `sessiondeck-store.json` | SET-3 | Sessions (incl. notes, checklist, queue, `lastActiveAt` D61), groups, statuses, settings, repos, worktrees, presets |
| `sessiondeck-store.json.bak` | SET-3 | Best-effort copy after a successful load |
| `sessiondeck-timeline.json` | TML-3 | Turns (200/session, 30 days) + last sleep per session |
| `quota-markers.json` | USE-5 | Alert markers per window instance |
| `quota-autopilot.json` | USE-7/8 | Held sessions + reset time |
| `resume-on-launch.json` | SES-17 | Ids of the sessions running at quit/crash (`{version:1, ids}`) |
| `jarvis/` | JRV-1/2/3 | Jarvis's folder: `mcp.json` (port + token, rewritten each run), `system-prompt.md`, `actions.log`, `schedules.json` (D54) |
| `sessiondeck-attention/sessiondeck-worker-plugin/` | WRK-1 | Worker plugin package (package.json + index.mjs) |
| `sessiondeck-attention/sessiondeck-opencode-plugin/` | AGT-2 | OpenCode session plugin package (package.json + index.mjs) |
| `sessiondeck-attention/` | ATT-1 | Private hook settings / status |
| `main-errors.log` | WIN-6 | Uncaught main errors |
| `window-events.log` | WIN-6 | Window lifecycle |

### 3.5 Shortcuts

| Keys | Action | Where it works | Feature |
|---|---|---|---|
| `Ctrl+Shift+N` | New session | Anywhere except dialogs/text inputs; xterm lets it bubble | SES-1 |
| `Ctrl+N` | New session | Outside the terminal only (readline keeps next-history) | SES-1 |
| `F2` | Rename session/group | Sidebar / Code card | SES-2 |
| `Ctrl+W` | Close active tab | Outside the terminal only | TAB-3 |
| `Ctrl+Shift+W` | Close active tab | Anywhere | TAB-3 |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab | Anywhere | TAB-3 |
| `Ctrl+K` | Command palette | Outside terminal and text inputs | PAL-1 |
| `Ctrl+Shift+K` | Command palette | Anywhere except over a dialog | PAL-1 |
| `Ctrl+Shift+J` | Open / close the Jarvis panel | Anywhere, both modes, except over a dialog (plain `Ctrl+J` stays a newline for Claude) | JRV-1 |
| `Ctrl+C` / `Ctrl+Shift+C` / `Ctrl+V` | Copy / copy / paste | Terminal | TRM-3 |
| `Ctrl+Shift+F` | Find in the terminal (visible pane) | Terminal / grid view | TRM-12 |
| `↑` / `↓`, `Enter`, `Delete` | Sidebar navigation | Sidebar focused | NAV-9 |
| `Ctrl+click` / `Shift+click` | Toggle / range-select sessions (without opening) | Sidebar cards / Hub cards | NAV-11 |
| `Esc` | Clear the bulk selection | Sidebar / Hub, unless a dialog, menu, input or terminal has focus | NAV-11 |
| `←` / `→` or `↑` / `↓`, `Enter` | Resize / equalise a split divider | Divider focused | TRM-7 |

### 3.6 Settings keys

| Key | Default | Feature |
|---|---|---|
| `autoStatus.enabled` | `true` | AUT-1 |
| `autoStatus.working` / `.needsInput` / `.finished` | `working` / `waiting` / `review` | AUT-1 |
| `tray.closeToTray` | `true` | ATT-9 |
| `tray.desktopNotifications` | `true` | ATT-7 |
| `tray.notifyOnlyWhenUnfocused` | `true` | ATT-7 |
| `quota.enabled` | `true` | USE-5 |
| `quota.warnAtPercent` / `.criticalAtPercent` | `80` / `95` | USE-5 |
| `quota.notifyOnReset` | `true` | USE-5 |
| `quota.criticalAction` | `sleep` (was `ask`, migrated once) | USE-7 / USE-11 |
| `quota.resetAction` | `wake` (was `ask`, migrated once) | USE-8 / USE-11 |
| `quota.continueOnWake` | `true` (was `false`, migrated once) | USE-8 / USE-11 |
| `quota.showOpencodeGo` | `true` | USE-12 |
| `sleep.enabled` / `.afterMinutes` | `false` / `30` | AUT-2 |
| `sleep.allEnabled` / `.allAfterMinutes` | `false` / `60` | AUT-3 |
| `agents.defaultAgent` | `claude` | SES-1 / AGT-2 |
| `agents.opencodeModel` | `''` | AGT-2 |
| `hub.scrollToBusiest` | `true` | HUB-6 |
| `launch.resumeRunning` | `true` | SES-17 |
| `jarvis.model` | `sonnet` | JRV-5 |
| `jarvis.agent` / `jarvis.opencodeModel` | `claude` / `''` | JRV-5 |
| `away.enabled` / `.afterMinutes` | `true` / `15` | TML-5 |
| `code.worktreesRoot` | `''` (home default) | COD-5 |
| `code.shell` | `powershell` | AGT-3 |
| `code.autoTrustWorktrees` | `false` | COD-11 |
| `reminder.enabled` / `.afterMinutes` | `true` / `10` | ATT-12 |

### 3.7 e2e script → feature

| Script | Feature(s) | Scope |
|---|---|---|
| `e2e.cjs` | SES-1/2/3, TRM-10, ATT-1 | Smoke: window, create/rename/status, real Claude PTY, hooks → attention, colours, close |
| `e2e-close.cjs` | SES-6/7/8 | Close / reopen / instant reopen / remove |
| `e2e-jarvis.cjs` | JRV-1..5 | MCP endpoint (token, every tool), wait/last answer/usage/away tools, Code tools on a temp git repo (add, list, create worktree, changes, remove with Yes), tools on Shell sessions, ambiguity, in-app Yes/No, action log, the panel (Ctrl+Shift+J, tab-bar button, Ops + Code, mode switch, close keeps size, never a tab), palette, settings, reset |
| `e2e-spaces.cjs` | SEC / JRV-2 | Data folder and session folder WITH SPACES (a user name like "John Smith"): a Claude session and Jarvis start, `/mcp` shows SessionDeck's tools; `EXE=` runs it on the packaged build |
| `e2e-jarvis-voice.cjs` | JRV-8 | WAV made by Windows TTS → recognized ("list my sessions") → sent to an OpenCode Jarvis; a Stop hook + temp-config transcript → spoken as plain words only with the toggle on |
| `e2e-code-git.cjs` | COD-12..16, JRV-12 (D60) | Temp repo with a GitHub remote whose pushes go to a local bare repo (`pushInsteadOf`): ticks, untick one file, Ctrl+Enter commit, ↑1, Push after the confirm, the unticked file stays unticked, Create PR pushes and "opens" the compare URL (written to a file), Merge into main, Jarvis `commit_worktree` + `branch_status` (80 tools), Remove worktree with "delete from disk" warns about the unmerged commit, deletes folder and branch, repository folder untouched |
| `e2e-jarvis-tuning.cjs` | JRV-13 (D71) | The five tuning tools over Jarvis's MCP endpoint: PC info matches this PC, terminal / GPU / sidebar / panel settings change the real window and files, limits and bad values refused, autoStatus by status name |
| `e2e-opencode-jarvis.cjs` | JRV-3, AGT-2 (D79) | A real OpenCode TUI answers "pong" (paid flash model, the free one is often out of quota); `get_last_answer` returns it from the export, `search_conversations` finds it, `fleet_digest` lists it with `reply: pong`; `set_session_model` refuses a flag-looking model and a shell session, switches a live session without changing its conversation id, undo puts the model back; `fork_session` copies the conversation (different id, last answer still pong); the "ask" permission option is stored. Deletes the OpenCode conversations it made |
| `e2e-jarvis-plans.cjs` | JRV-8 (D80) | Both features OFF by default; `plan_create` refuses while off and says where to turn it on; interval 0 refused; switching on stores the values; bad plans refused (unknown session, cycle, a {{placeholder}} that is not a dependency, session + new_session); a real two-step plan runs A then B in two shell sessions and ends `done`; turning plans off cancels a running plan; `plan_cancel` on a finished plan says so. Uses shell sessions only; the real-agent path is `e2e-jarvis-plans-agents.cjs`, watch is `e2e-jarvis-watch.cjs` |
| `e2e-jarvis-plans-agents.cjs` | JRV-8 (D80) | Task plans with REAL OpenCode sessions (paid flash model, 40 checks): a step that creates a session answers and the plan ends `done`; a two-step plan pastes `{{a}}` and the existing session's answer is its own new turn, not the stale one; parallel steps start together; a bad folder fails the step and skips its dependent; `plan_cancel` and turning the toggle off stop later steps and leave the running session alone; a prompt queued behind a running turn never ends with the earlier turn's answer. Deletes its OpenCode conversations |
| `e2e-jarvis-watch.cjs` | JRV-8 (D80) | Watch mode in the real app with the limits shortened by `SESSIONDECK_WATCH_WAITING_MS` / `SESSIONDECK_WATCH_STUCK_MS` (about 8 minutes): OFF reports nothing; ON with Jarvis not open creates/delivers nothing; once Jarvis is open ONE `[Watch]` message (read from its OpenCode conversation) names the waiting session and carries the instruction line; the same episode and an unanswered question whose bell was only cleared are not repeated; a finished-turn bell is not reported; a new episode is; OFF stops the checks |
| `e2e-jarvis-settings-ui.cjs` | JRV-8 (D80) | Settings > Agents by real clicks: both switches OFF by default, the minutes field appears only when watch is on, bad values (0, 121, 2.5, abc, empty) show the message and store nothing, 25 + Enter / 30 + blur store, outside changes update the open field, a restart keeps the values, Space toggles, no renderer errors (41 checks) |
| `e2e-cursor.cjs` | AGT (D81) | Cursor agent in the built app with a fake `cursor-agent` that runs hooks.json like Cursor: create (model), argv `--force --model`, hooks.json merge keeps foreign hooks and never duplicates, working/finished from hooks, `get_last_answer`, chat id stored, sleep/wake resumes with `--resume`, fork refused, plan step done, missing CLI error, real `~/.cursor` untouched, real-binary flag smoke when installed (32 checks) |
| `e2e-cursor-jarvis.cjs` | AGT/JRV (D81) | Jarvis controls a Cursor session like Claude/OpenCode ones (fake `cursor-agent`, 79 checks): send_prompt now/queue/to a sleeping or closed session (`--resume`), wait, get_last_answer, read_screen, press_keys, queue tools, rename, status, groups, notes, checklist, keep-awake, sleep/wake/close/reopen/restart keeping the chat id, fleet_digest, terminal_search, broadcast, bulk, plans with `{{id}}`, `set_session_model` (restart with `--model`+`--resume`, bad names refused, empty clears), fork refused, real `~/.cursor` untouched |
| `e2e-tab-changes.cjs` | TAB-7 (D82) | Code mode by real right-clicks: the tab menu has View changes for a worktree session and not for an Ops one, it opens the panel on Changes (also from another tab and from the grid), lists changed files with +/-, a file click shows the diff, the panel widens to 520 once and keeps a saved width after a reload, no renderer errors, real ~/.claude and ~/.cursor untouched (42 checks, incl. a sleeping session and the sidebar menu) |
| `e2e-changes-detach.cjs` | COD-17 (D83) | The detach button opens a second window with only the changes UI (no app shell, no annotations): list + the first file's diff at once, click another file, one window per worktree (a second click adds none), a second worktree gets its own, refresh shows a new file, the side panel keeps working, closing frees the slot, no console errors, real ~/.claude and ~/.cursor untouched (46 checks) |
| `e2e-sort.cjs` | NAV-12 (D61) | Shell sessions: each sort in the sidebar, a typed line sets `lastActiveAt`, the hover pin and re-sort on leave, ↓ follows the sort, sleeping last under Needs attention, a reorder drag refused with the hint, the Hub follows, Code mode has its own sort inside a worktree, the sort and `lastActiveAt` survive a restart |
| `e2e-jarvis-app.cjs` | JRV-11 (D58) | The D58 tools over the real MCP endpoint: sounds saved in the window, sidebar search, group by and sort (D61), next tab, terminal search bar and match count, a file path typed into a shell, a missing link refused, start-on-login status, quit asks (Cancel), a changed file's diff then preview in the Changes panel, Code tree collapse + undo, restart_jarvis fresh. Worktrees in the temp folder |
| `e2e-jarvis-control.cjs` | JRV-9 / JRV-10 | Every D55 tool over the real MCP endpoint with shell sessions: views, grid, split, sidebar, side panel, dialogs, zoom, mode switch (and back by itself), settings + validation + undo, queue, checklist, groups, statuses, presets, bulk, read/unread, costs, the Yes/No on a removal |
| `e2e-jarvis-opencode.cjs` | JRV-5 | Real OpenCode, free model: Jarvis on OpenCode creates a session through the tools; switching back gives one new Claude Jarvis |
| `e2e-jarvis-real.cjs` | JRV-1/3/4/6 | Real Claude (2 prompts + 1 schedule): plain-words create + sleep, remove with the in-app Yes, a one-time schedule 2 min ahead really runs |
| `e2e-resume.cjs` | SES-12 | Kill + relaunch, same conversation |
| `e2e-dialogs.cjs` | SES-1/2, SET-1 | New Session + Statuses dialogs through real input; unsafe args rejected |
| `e2e-robust.cjs` | SEC-1, SET-3 | Late/bogus IPC, malformed create, save on quit |
| `e2e-busy-close.cjs` | SES-14 / SEC-4 | Busy session close leaves no process |
| `e2e-queue.cjs` | SES-15 | Queue tab, Stop → typed + Enter, idle send, guard, Send now, chip, restart (fake claude) |
| `e2e-broadcast.cjs` | NAV-11 / SES-15 | Bulk Prompt: Ctrl+click 3 sessions, dialog split, idle sent now, busy after Stop, Shell skipped (fake claude) |
| `e2e-presets.cjs` | SES-16 | Save as preset, menu fills the form, palette one-step start, restart, delete (fake claude) |
| `e2e-resume-launch.cjs` | SES-17 | Running resumed with --resume on launch, closed/sleeping not, crash keeps the list, Settings switch off (fake claude) |
| `e2e-costs.cjs` | TML-7 / HUB-5 | Seeded multi-day timeline + a live turn: tiles, chart, tooltip, table, row opens session, Activity strip, Hub total opens the report |
| `e2e-fork-search-real.cjs` | SES-18 / SES-19 | REAL Claude: codeword turn, palette search + highlight + open, right-click fork remembers it, parent untouched, no-conversation fork refused |
| `e2e-queue-real.cjs` | SES-15 | A real Claude turn finishes and the queued prompt is submitted and answered |
| `e2e-bell.cjs` | ATT-2/3/4, SES-13 | Bell on card/tab/Hub, mark read/unread, real background turn |
| `e2e-attentionnav.cjs` | ATT-13 | Ctrl+Shift+Down / Up walk the sessions with a bell (terminal focused, none reaches the terminal), viewed ones lose the bell, nothing waiting / a dialog open does nothing |
| `e2e-sidebarwidth.cjs` | NAV-13 | Drag the edge (live, limits, terminal follows), arrows / Home / End, double-click reset, survives a quit and restart, hide / show keeps the width |
| `e2e-reminder.cjs` | ATT-12, ATT-5, ATT-7 | Settings > Sound, a real 1-minute repeat, read stops it, on-screen silent, off stops it |
| `e2e-hub.cjs` | HUB-1/2/3, ATT-5, SET-1 | Hub columns, drag status, settings, sound pipeline |
| `e2e-hubscroll.cjs` | HUB-6 | Busiest-column scroll |
| `e2e-bulk.cjs` | NAV-11, HUB-3 | Real Ctrl/Shift/Esc selection, bulk sleep/status/group in the sidebar and Hub, DnD regression |
| `e2e-trust.cjs` | COD-11 | Fake `claude` on PATH: default OFF, Settings switch, fresh worktree answered exactly once |
| `e2e-g1.cjs` | AUT-1, TRM-7, ATT-9, SET-1 | Auto status, split, settings, close-to-tray |
| `e2e-notes-usage.cjs` | NTS-1/2, USE-2 | Notes/checklist across restart + real usage |
| `e2e-usage-refresh.cjs` | USE-4 | Consent, one real endpoint request |
| `e2e-usage-both.cjs` | USE-1/2/3/12, AGT-2 | Multi-provider bars: Claude alone → + Go (labeled groups, Month), settings toggle off/on, unusable Go payload; real Go endpoint skipped (no Go login on this machine) |
| `e2e-away.cjs` | TML-1..6 | Activity, away dialog, palette action, restart, out-of-order late Stop/cost |
| `e2e-timeline-prompt.cjs` | TML-1/4/6, AGT-2, USE-2 | OpenCode plugin bodies: prompt → timeline/Activity/away, context % → chip + Hub card |
| `e2e-autopilot.cjs` | USE-7/8/9/10 | Critical sleep (5-hour and weekly), reset wake, automatic mode, weekly reset inside the dedup window |
| `e2e-handsfree.cjs` | USE-11 (+ USE-7/8) | Fresh defaults, old-store boot migration, hands-off critical sleep, no-action reset wake + "continue" into a real TUI, failure-free notices, ask-mode still exists |
| `e2e-sleep.cjs` | SES-9 / AUT-2 / SES-13 | Manual sleep/wake + idle timer + two-window on-screen protection (real pop out, dock) |
| `e2e-sleepall.cjs` | AUT-3/4 | Real switch, key postpones, all sleep, Keep awake |
| `e2e-sleepbell.cjs` | SES-9 / ATT-2 | Sleep keeps the bell |
| `e2e-keepawake.cjs` | SES-10 | Flag persists, badge, context menu |
| `e2e-remote.cjs` | AGT-4 | RC detection, badge, dialog checkbox |
| `e2e-opencode.cjs` | AGT-2 | Real OpenCode launch, hooks, sleep/wake, model |
| `e2e-opencode-workers.cjs` | WRK-1..4 / AGT-2 | Real OpenCode parent; child worker tabs; child events never touch the parent |
| `e2e-codemode.cjs` | COD-1..10 | Real git repo/worktree, Shell, Changes, pop-out, restart |
| `e2e-worktree-sources.cjs` | COD-4 (D57) | Real dialog: same name twice → -2 branch and folder, Existing branch (busy one refused with its folder), Repo folder once, its badge, Remove keeps the repo |
| `e2e-workspaces.cjs` | NAV-4 | Workspace headers, collapse, toggle, prefilled folder |
| `e2e-foldertabs.cjs` | TAB-2 | Per-folder tab bar |
| `e2e-palette.cjs` | PAL-1..4 | Real keys, filtering, jump, actions |
| `e2e-paste.cjs` | TRM-3/4 | Right-click pastes once in both UIs ("Copy / paste" mode), and the menu's Paste pastes once in Claude's fullscreen UI (D59) |
| `e2e-termmenu.cjs` | TRM-3 (D59) | Real right-clicks: the menu and its rows, Paste once, Select All + Copy, Copy Folder Path, Find, Escape (focus back, nothing sent to the program), Split Right + Close Pane, Clear Screen, "Copy / paste" mode and Ctrl+right-click |
| `e2e-imagepaste.cjs` | TRM-4 | Image paste + file drop |
| `e2e-links.cjs` | TRM-5 | Link hover targets |
| `e2e-fileview.cjs` | TRM-13 | Real Shell session: click each path (md, png, csv, xlsx with 2 sheet tabs, docx) -> Preview tab content; drag-resize and saved width; Detach opens a second window with the file; Close returns to Notes |
| `e2e-fileview2.cjs` | TRM-13 (D74) | Jarvis `preview_file` opens files; live reload (edit, delete, restore); UTF-16 text; header buttons and Copy path; find (30 of 30) and text zoom; image zoom; a 250-row csv (paging, sort); drop a file on the side panel (CDP drag); the palette item; Settings > Agents' OpenCode row and Re-check |
| `e2e-fileview3.cjs` | TRM-13 (D74) | Code mode: a temp repo + worktree with a changed .md, a new .csv and a .bin; the Changes list gives the first two an eye button (not the .bin) and clicking it previews the file from its absolute worktree path |
| `e2e-fileview-types.cjs` | TRM-13 (D75) | One section per type the user mentioned, with realistic files made at run time: Markdown (list, task list, code, table, link, script safety, relative image, remote image blocked, missing image marked, relative link followed), six image formats + svg (inert) + ico, Word (styles, numbering, table, hyperlink; docm, dotx), Excel (shared strings, date style, formula, boolean, merged, hidden sheet; xlsm; old .xls refused), CSV/TSV (comma, semicolon with decimal commas, pipe, tab, BOM, windows-1252), a 2-page PDF drawn on canvases and a broken one, text kinds, unsupported types |
| `e2e-fileview-spaces.cjs` | TRM-5/13 (D75) | A Shell session in a folder with files named like the user's (spaces, Vietnamese letters, a folder with a space): five printed lines (four absolute spaced paths, one relative) are each clicked and open their file in the Preview |
| `e2e-fileview-bigpdf.cjs` | TRM-13 (D75) | A 60 MB, 12-page PDF made at run time: main says streamed with no bytes, a range returns the header, a range over 8 MB and a non-PDF are refused, the first page draws and has ink, the page count is right, scrolling to the end shows 12 / 12 and far pages are not all kept |
| `e2e-fileview-menu.cjs` | TRM-3/13 (D76) | Real Shell session: right-click a file, a spaced path, a folder, a URL and plain text; the link rows (and their order, first) appear only on links, Open in Side Panel previews the file, Copy Path copies the absolute path, no stale rows after the pointer left a link |
| `e2e-fileview-edge.cjs` | TRM-13 (D77) | Hostile and broken files through Jarvis `preview_file`: empty/corrupt xlsx, docx, png, pdf, svg; a decompression bomb and a sparse-wide xlsx (the old out-of-memory crash) end in a clear message with the app alive; binary text, a 2.5 MB text, a 300k-row csv, a 500-column csv, a 3 MB single line; emoji and quote names; five quick requests (the last wins); a session removed mid-preview; Detach; the page logs no uncaught error |
| `e2e-termview.cjs` | TRM-12 | Real Ctrl+Shift+F keys, query/count/cycling/Esc, built scrollbar rule (plus zoom + scrollback) |
| `e2e-checklist-draft.cjs` | NTS-5 | Draft survives session switch |
| `e2e-workers.cjs` | WRK-1..4 | Real plugin → hook → hub → tabs |
| `e2e-lastfolder.cjs` | SES-1 | Last folder remembered |
| `e2e-visual.cjs` | UI review | Screenshots of every state |
| `e2e-packaged.cjs` | Packaging | Packaged exe smoke |

---

## 4. Change recipes

The step-by-step checklists (new IPC call, setting, store field, main service, UI, view, Jarvis tool, agent or launch argument) live in `docs/IMPLEMENTATION.md` §3, together with the test standard (§5) and the definition of done (§8). When a recipe there is wrong or missing, fix that file in the same change.

---

## 5. Invariants (do not break)

1. **One xterm per session.** Panes/cells hide, never unmount. Split, grid and tab switching share the workspace registry; the Jarvis panel owns its own single pane. A hidden terminal keeps its size.
2. **Split stays at 4 panes** (`MAX_PANES = 4`); grid is a separate layout with its own max (6).
3. **No duplicate session in visible panes/cells.** Picking an already-visible session moves it.
4. **Closed sessions cannot be used** until reopened; they have no PTY.
5. **Shell sessions are never auto-slept** (idle, sleep-all, quota).
6. **Keep awake and Remote Control sessions are never slept** by any automatic rule.
7. **Busy / needs-input sessions are never interrupted** by quota autopilot.
8. **Only `Stop` and `Notification` hooks ping.** The idle-output detector is intentionally a no-op.
9. **The on-screen session is recorded but never pings** (sound/flash/desktop notice), and reminders never repeat for it.
10. **Sleeping keeps the bell** (D27); closing/removing forgets it.
11. **Manual usage refresh only**; the endpoint is never polled; the OAuth token stays in main and is never logged, stored or sent over IPC.
12. **The store is never overwritten on a read error**; invalid JSON is quarantined, locked files abort startup.
13. **All IPC is validated in main**; malformed or late calls must not wedge the main process.
14. **Kill the whole process tree** on close/remove/quit.
15. **Per-mode storage**: Ops keeps the historical keys; Code appends `.code`. Never mix them.
16. **A session belongs to Code iff it has `worktreeId`.**
17. **Claude sessions always run yolo** unless the user already passed a permission flag.
18. **Tests never touch the user's real Claude/OpenCode config** (W11); use a temp user-data dir and a temp `--settings` file.
19. **Docs stay current** (`docs/IMPLEMENTATION.md` §6): a decision updates `DECISIONS.md`; a shipped feature updates this file and `HANDOFF.md`; a new file/folder updates `CODEMAP.md`; a new gotcha updates `LESSONS.md`.
20. **Jarvis belongs to no mode** and there is only one: `dataForMode` filters it, `jarvis:open` is serialized in main, it is never a tab/card/needs-you item, and main counts it as always on screen.
21. **Jarvis tools never fork logic**: every tool calls the same controller/store/service path as the UI; Jarvis never targets itself; destructive tools confirm in the app; reversible ones record an undo step; every action is logged.
22. **The MCP server is local and private**: 127.0.0.1, random port, per-run Bearer token, only the Jarvis session gets its config; the user's `~/.claude` and global OpenCode config are never changed.
23. **Keys are separate writes**: text, Enter and menu keys sent to a TUI go as separate writes with a pause (trust answer, queue, Jarvis).

---

## 6. Known gaps and not-built features

| Item | Status | Detail |
|---|---|---|
| Auto-update | Deferred | Not started. |
| Interactive OpenCode worker terminal | Deferred | Phase 2 idea (`opencode serve` + `attach`); worker tabs stay read-only. |
| Light theme | Deferred | Dark only. |
| Sound / taskbar flash human verification | Gap | Code paths tested; not heard/seen by a human. |
| Real-mouse drag and drop | Gap | Pure logic tested; HTML5 DnD events not simulated. |
| Packaged installer freshness | Shipped (2026-11-01) | `release/SessionDeck-Setup-0.0.3.exe` built from `84bf042` (everything through D54); `e2e:packaged` 15/15, `e2e-spaces` 4/4 on the exe. Unsigned; version not bumped. Rebuild only on request (W09). |
| Code signing | Deferred | SmartScreen warns on install. |
| OpenCode Go usage, real endpoint | Gap | Tested with fakes only (no Go connection on the dev machine). |
| Jarvis voice languages | Gap | Only the speech recognizers Windows has installed (en-US, zh-CN on the dev PC). |
| Jarvis on OpenCode | Gap (by design) | No transcript: no read-aloud, `get_last_answer` falls back to the screen. |
| Jarvis schedules while the app is closed | Gap (by design) | Skipped; a run more than 15 min late is skipped. |
| Jarvis undo across restarts | Gap (by design) | In memory, last 20, this run; removals are final. |
| Autopilot limit wording | Gap | `USAGE_LIMIT_PATTERNS` may need additions once seen in the wild. |
| Claude trust-folder prompt | Shipped (opt-in) | COD-11: Settings > Code `code.autoTrustWorktrees`, off by default, answers fresh worktree Claude sessions only. |

---

*Last updated: 2026-11-08. Keep the matrices and the maps in sync with the code; when in doubt, read the module named in the `Code` column.*
