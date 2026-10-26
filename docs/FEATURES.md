# SessionDeck feature reference

> **What this file is.** The complete feature inventory of SessionDeck, in tree + matrix form, built so an agent can go from "which feature?" to its rules, its code path and its tests in one lookup. It complements, and does not replace:
> - `docs/DECISIONS.md` — *why* a feature exists and what the user chose (D01–D32).
> - `HANDOFF.md` — the narrative state of each feature, including known gaps.
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
5. Use a **change recipe** (§4) for the common edits; respect the **invariants** (§5).

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
│   └── SES-14 Busy-close process-tree safety
├── TRM  Terminal & input
│   ├── TRM-1  xterm panes, WebGL, replay + sequence gate
│   ├── TRM-2  PTY write / resize
│   ├── TRM-3  Copy / paste / right-click
│   ├── TRM-4  Image paste and file drop
│   ├── TRM-5  Clickable links (URL / file / folder)
│   ├── TRM-6  Terminal bell
│   ├── TRM-7  Split panes (2–4)
│   ├── TRM-8  Grid view (up to 6)
│   ├── TRM-9  Exited overlay + restart
│   ├── TRM-10 Terminal colours (NO_COLOR)
│   ├── TRM-11 Scrollback / reattach replay
│   └── TRM-12 Terminal search (Ctrl+Shift+F)
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
│   └── NAV-10 Status view
├── ATT  Attention & alerts
│   ├── ATT-1  Claude hook pipeline
│   ├── ATT-2  Attention reasons and priority
│   ├── ATT-3  Bell UI (card / tab / Hub / header)
│   ├── ATT-4  Needs-you list
│   ├── ATT-5  Notification sounds
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
│   └── TAB-6  Worker tabs (see WRK)
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
│   └── TML-6  "While you were away" summary
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
│   └── COD-10 Pop-out Code window
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
| WRK | `renderer/workers/workerLogic.ts` | `main/workers/WorkerHub.ts` |
| SEC | — | `main/app/ipcValidation.ts`, `main/attention/HookServer.ts` |

---

## 2. Feature matrices

### 2.1 SES — Sessions & lifecycle

| ID | Feature | Status | Trigger / entry | Rules (must-know) | Code | Tests |
|---|---|---|---|---|---|---|
| SES-1 | Create session | Shipped | New Session dialog; `Ctrl+Shift+N` anywhere, `Ctrl+N` outside the terminal | Folder required and must be an existing directory (`validateCwd`); name optional, defaults to the folder's last segment (`defaultNameFromFolder`), 1–100 chars; group/status optional; agent `claude` \| `opencode` \| `shell`; Claude args are validated as safe CLI tokens; OpenCode model optional (≤200 chars, `A-Za-z0-9._:/@+-`); Remote Control checkbox appends `--remote-control` last; dialog opens in the last used folder. Main creates the store entry, then starts the PTY. | `renderer/Sidebar/dialogLogic.ts` → `buildCreateInput`, `initialFolder`; `main/app/startOptions.ts` → `buildStartOptions`; `main/app/sessionController.ts`; `main/store/reducers.ts` → `createSession` | `dialogLogic.test.ts`, `reducers.test.ts`, `sessionController.test.ts`, `startOptions.test.ts`; e2e `e2e.cjs`, `e2e:dialogs`, `e2e:lastfolder` |
| SES-2 | Rename session / group | Shipped | Double-click or `F2` on a card / group header | Inline editor; `Enter` commits, `Esc` cancels; trimmed; 1–100 chars; main re-validates. Group rename follows the same rule. | `renderer/Sidebar/InlineEdit.tsx`, `inlineEditValidation.ts`; `main/store/reducers.ts` → `renameSession`, `renameGroup` | `inlineEditValidation.test.ts`, `reducers.test.ts`; e2e `e2e.cjs` |
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
| SES-14 | Busy-close process-tree safety | Shipped | Close a session while a command runs | `taskkill /T /F` while the parent is alive; no orphan shell/dev-server survives; verified at OS level. | `main/pty/treeKiller.ts` | `treeKiller.test.ts`; e2e `e2e:busyclose` |

### 2.2 TRM — Terminal & input

| ID | Feature | Status | Trigger / entry | Rules (must-know) | Code | Tests |
|---|---|---|---|---|---|---|
| TRM-1 | xterm panes, WebGL, replay | Shipped | Any visible session | **One xterm instance per session**, mounted for the session's whole life, hidden via CSS when not visible (scrollback survives); WebGL with a DOM fallback on context loss; live data is one subscription dispatched by id; replay buffer + `seq` gate drops stale live chunks after a reattach. | `renderer/Terminal/useTerminalPanes.ts`, `paneFactory.ts`, `seqGate.ts`; `main/pty/RingBuffer.ts` | `seqGate.test.ts`, `terminalOptions.test.ts`, `RingBuffer.test.ts`, `pty.test.ts` |
| TRM-2 | PTY write / resize | Shipped | Typing, pane resize, split/grid layout | Renderer sends `pty:write` / `pty:resize`; initial geometry 120×30; `fit` is event-driven after layout changes; writing to a stopped session is rejected safely. | `renderer/Terminal/TerminalPane.tsx`; `main/pty/PtyManager.ts`; `main/app/startOptions.ts` (`INITIAL_COLS`, `INITIAL_ROWS`) | `PtyManager.test.ts`, `ipcValidation.test.ts`; e2e `e2e:robust` |
| TRM-3 | Copy / paste / right-click | Shipped | `Ctrl+C`, `Ctrl+Shift+C`, `Ctrl+V`, right-click | `Ctrl+C` with a selection copies, without one sends `^C`; `Ctrl+Shift+C` always copies; `Ctrl+V` / `Ctrl+Shift+V` paste; right-click copies the selection else pastes; the right mouse button is **never** reported to the program (Claude's fullscreen mouse mode would paste it twice). | `renderer/Terminal/keymap.ts` → `decideKeyAction`, `isRightButton`, `decideContextMenuAction` | `keymap.test.ts`; e2e `e2e:paste` |
| TRM-4 | Image paste and file drop | Shipped | Paste an image, drop files on a pane | Claude receives the image through its own paste path (Alt+V), OpenCode through Ctrl+V; dropped files paste their absolute paths; a double-paste guard ensures exactly one paste. | `renderer/Terminal/inputExtras.ts`, `dropPaths.ts`; `renderer/Terminal/paneFactory.ts` → `pasteOnce` | `dropPaths.test.ts`; e2e `e2e:imagepaste` |
| TRM-5 | Clickable links | Shipped | Hover/click a URL, file or folder in the terminal | Underlined only when the target exists (relative paths resolved against the session cwd); click opens (URL → browser, file → default app, folder → Explorer); `Shift+click` reveals; executables/scripts are only revealed; UNC paths rejected; main re-resolves and never trusts the renderer. | `main/links/LinkService.ts`, `linkText.ts`; `renderer/Terminal/links/detectLinks.ts`, `linkCache.ts` | `LinkService.test.ts`, `linkText.test.ts`, `detectLinks.test.ts`, `linkCache.test.ts`; e2e `e2e:links` |
| TRM-6 | Terminal bell | Shipped | Program emits BEL | Raises attention reason `bell` (priority 1); sound/flash follow the user's sound settings; the bell is silent for an `unread` flag. | `main/attention/AttentionService.ts`; `main/attention/AttentionManager.ts` | `AttentionManager.test.ts`, `AttentionService.test.ts`; e2e `e2e-bell` |
| TRM-7 | Split panes | Shipped | Tab bar split-right / split-down; divider drag / keyboard | 2–4 panes (`MAX_PANES = 4`), row or column; no duplicate sessions; sizes sum to 1, min fraction 0.15; drag or arrow keys resize, `Enter` equalises; layout persisted per mode (`sessiondeck.split.v1` / `.code`). | `renderer/split/splitLogic.ts` (pure), `useSplitLayout.ts`, `Terminal/TerminalWorkspace.tsx`, `SplitDivider.tsx` | `splitLogic.test.ts`, `useSplitLayout.test.ts`; e2e `e2e:g1` |
| TRM-8 | Grid view | Planned (D32) | View control "Grid ▾" (1x1, 2x1, 1x2, 2x2, 2x3, 3x2) | Every cell is a **fully interactive** terminal; max 6 cells; one session per cell (picking a visible session **moves** it); uniform cell sizes; empty cells show a picker with **no auto-fill**; open sessions only (Closed must be reopened); Ops and Code keep separate grids. Plan: `plan/grid-view.md`. | New `renderer/grid/*`; changes to `mode/viewPref.ts`, `useWorkspaceNav.ts`, `ModeWorkspace.tsx`, `TerminalWorkspace.tsx` | Planned: `gridLogic.test.ts`, `e2e-grid.cjs` |
| TRM-9 | Exited overlay + restart | Shipped | Process exits | Overlay shows the exit code; Restart starts a new process; no typing into an exited session (main rejects it). | `renderer/Terminal/TerminalPane.tsx`; `main/app/sessionController.ts` | `sessionController.test.ts`; e2e `e2e:robust` |
| TRM-10 | Terminal colours | Shipped | Any Claude session | The launcher strips inherited `NO_COLOR` so Claude keeps colour even when SessionDeck was started from a colourless shell. | `main/pty/launch.ts` | `launch.test.ts`; e2e `e2e.cjs` |
| TRM-11 | Scrollback / reattach replay | Shipped | Switch tabs, split, sleep/wake, app restart | Ring buffer replays recent output on reattach; `PtyReplay.seq` marks the last included chunk; hidden panes keep their xterm and scrollback. | `main/pty/RingBuffer.ts`; `renderer/Terminal/useTerminalPanes.ts`, `seqGate.ts` | `RingBuffer.test.ts`, `seqGate.test.ts` |
| TRM-12 | Terminal search | Shipped | `Ctrl+Shift+F` (terminal + grid view) | One `@xterm/addon-search` provider per pane; the bar searches the pane that was active when it opened (visible pane only, v1) and closes on a tab/view change. Typing highlights all matches and the active one; count shows `n/total` or "No matches"; `Enter` / `Shift+Enter` cycle; `Esc` closes, clears decorations and refocuses the terminal. Plain `Ctrl+F` still reaches the program. The scrollbar arrow buttons are hidden, thumb colours unchanged. | `renderer/Terminal/paneFactory.ts` → `searchAddon`; `useTerminalSearch.ts`; `searchLogic.ts`; `TerminalSearchBar.tsx`; `keymap.ts`; `Terminal.css` | `searchLogic.test.ts`, `keymap.test.ts`; e2e `e2e:termview` |

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
| TAB-2 | Per-folder tab bar | Shipped | Tab bar | Shows only open sessions sharing the active session's folder (`folderKey`); a lone session gets a bar of one; with no active session every tab shows. | `renderer/shell/projectTabs.ts` → `projectTabIds` | `projectTabs.test.ts`; e2e `e2e:foldertabs` |
| TAB-3 | Tab shortcuts | Shipped | Keyboard | `Ctrl+Tab` / `Ctrl+Shift+Tab` cycle; `Ctrl+W` closes the active tab **outside** the terminal only (readline keeps delete-word); `Ctrl+Shift+W` closes everywhere; dialogs and text inputs win. | `renderer/shell/openTabsLogic.ts` → `decideTabShortcut`; `useTabShortcuts.ts` | `openTabsLogic.test.ts`; e2e `e2e:palette` (shortcut context) |
| TAB-4 | Terminal \| Hub view | Shipped | Tab-bar view control, palette "Open Hub" | Per-mode persisted `MainView` (`sessiondeck.view.v1` / `.code`); switching view never destroys terminal state; a focus request may switch the view. Grid becomes the third value (TRM-8). | `renderer/mode/viewPref.ts`; `mode/useWorkspaceNav.ts`; `ModeWorkspace.tsx` | `viewPref.test.ts`, `modeLogic.test.ts` |
| TAB-5 | Notes \| Activity side panel | Shipped | Tab-bar panel toggle | Per-mode open/closed and per-mode selected tab (`sessiondeck.notes.open.v1`, `sessiondeck.sidepanel.tab.v1` + `.code`); Code sessions add a **Changes** tab; the chosen tab falls back to the first valid one. | `renderer/timeline/sidePanelTab.ts`; `renderer/notes/NotesPanel.tsx`; `mode/useWorkspaceNav.ts` | `sidePanelTab.test.ts`; e2e `e2e:notes`, `e2e:away` |
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

### 2.11 AGT — Agents

| ID | Feature | Status | Trigger / entry | Rules (must-know) | Code | Tests |
|---|---|---|---|---|---|---|
| AGT-1 | Claude Code | Shipped | Default agent | Always runs in yolo mode (`--dangerously-skip-permissions`) unless the user already passed a permission flag; gets the private hooks settings file; `--session-id` for a new conversation, `--resume` afterwards; a never-prompted session rotates to a fresh id on resume; `NO_COLOR` stripped. | `main/app/startOptions.ts`, `claudeLaunch.ts`; `main/pty/launch.ts` | `startOptions.test.ts`, `claudeLaunch.test.ts`, `launch.test.ts`; e2e `e2e.cjs`, `e2e:resume` |
| AGT-2 | OpenCode | Shipped | New Session agent dropdown, Settings > Agents default | Plugin package injected via `OPENCODE_CONFIG_CONTENT` (merged with the user's own value: plugins appended, `permission: {"*":"allow"}` merged, other fields kept; unparseable value left alone); reports busy/idle/permission/cost, the user's prompt text (v2 `session.inbox.enqueued` `item.payload.text`, v1 user-message parts; ≤200 chars, attached to that turn's `UserPromptSubmit`) and a context % (model catalog `limit.context` vs the LATEST `session.step.ended` prompt tokens = `input + cache.read + cache.write`; never cumulative totals; same catalog supplies the display name); resume with `opencode --standalone -s <id>`; the model travels in the config content `model` key (the TUI CLI has no `--model` flag — it prints help and exits); empty model = OpenCode default; no Claude args. `--standalone` (private server) so the per-process plugin env is honored. Also reports the OpenCode Go allowance (D37: v2 credential resolve → `https://opencode.ai/zen/go/v1/usage` → `source:'opencode-go'` statusline body, at setup + turn end, 5-min throttle, silent on any failure). | `main/opencode/pluginEnv.ts`, `pluginSource.ts`, `writePlugin.ts`; `main/app/startOptions.ts` → `buildOpencodeStartOptions` | `pluginEnv.test.ts`, `pluginSource.test.ts`, `writePlugin.test.ts`, `startOptions.test.ts`; e2e `e2e:opencode` (13 checks), `e2e:timeline-prompt` (9 checks), `e2e:usage-both` |
| AGT-3 | Shell | Shipped | New worktree dialog agent `shell`; Settings > Code shell | Plain `powershell` / `pwsh` / `cmd` (PowerShell gets `-NoLogo`); no hooks, no conversation, restarts fresh; **never auto-slept** by idle, sleep-all or quota; not part of Ops. | `main/app/startOptions.ts` → `buildShellStartOptions`; `renderer/mode/codeSettingsLogic.ts` | `startOptions.shell.test.ts`, `codeSettingsLogic.test.ts`; e2e `e2e:codemode` |
| AGT-4 | Remote Control | Shipped | New Session checkbox `--remote-control` | Detects the `/rc active` footer (`RuntimeState.remoteControl`), shows an RC badge, auto-marks Keep awake; a prompt from any source clears pending attention; a remotely answered question returns the card to working when the spinner reappears. | `main/app/outputSignals.ts`; `main/app/runtimeRegistry.ts`; `renderer/Sidebar/SessionContextMenu.tsx` | `outputSignals.test.ts`, `runtimeRegistry.remote.test.ts`; e2e `e2e:remote` |
| AGT-5 | Agent badge | Shipped | Card / Hub | Small badge for Claude / OpenCode / Shell so mixed lists are readable. | `renderer/components/AgentBadge.tsx` | `AgentBadge.test.ts` |

### 2.12 COD — Code mode (worktrees)

| ID | Feature | Status | Trigger / entry | Rules (must-know) | Code | Tests |
|---|---|---|---|---|---|---|
| COD-1 | Ops \| Code separation | Shipped | Mode switch in the sidebar title bar | A session is Code iff it has `worktreeId`; the store is filtered per mode; tabs, split, view, notes, side-panel tab and (future) grid are per mode; Code can pop out into its own window; a needs-you badge marks the other mode. | `renderer/mode/modeLogic.ts` → `sessionMode`, `dataForMode`, `modeStorageKeys`; `useUiMode.ts`, `ModeSwitch.tsx`, `ModeWorkspace.tsx` | `modeLogic.test.ts`; e2e `e2e:codemode` |
| COD-2 | Add repository | Shipped | Code sidebar "Add repository" | Resolves the **git top level**; plain folders, bare repos and linked worktrees are rejected; an already-added repo is returned as is; repos persist in `StoreData.repos`. | `main/git/repoInfo.ts` → `resolveRepoRoot`; `main/app/codeWiring.ts`; `renderer/code/sidebar/CodeSidebar.tsx` | `repoInfo.test.ts`, `codeWiring.test.ts`; e2e `e2e:codemode` |
| COD-3 | Repo tree | Shipped | Code sidebar | Repo > worktree > sessions; collapse state persisted; remove repo stops its sessions and forgets repo/worktrees (files and branches stay on disk). | `main/store/codeReducers.ts`; `renderer/code/sidebar/codeTree.ts` | `codeReducers.test.ts`, `codeTree.test.ts`; e2e `e2e:codemode` |
| COD-4 | Create worktree | Shipped | "New worktree" dialog | Name 1..`WORKTREE_NAME_MAX`; branch/folder derived git-safe (`branchNameFor`); base = current branch; agent Claude/OpenCode/Shell; `git worktree add -b`; the first session starts inside it; input `cwd` is ignored when `worktreeId` is given. | `main/git/branchName.ts`, `worktreeCreate.ts`; `main/app/codeWiring.ts`; `renderer/code/dialogs/worktreeDialogLogic.ts` | `branchName.test.ts`, `worktreeCreate.test.ts`, `worktreeDialogLogic.test.ts`; e2e `e2e:codemode` |
| COD-5 | Worktree location | Shipped | Settings > Code | Empty = `<home>/SessionDeck/worktrees/<repo>/<name>`; a set value must be absolute; the repo folder is the repo's folder name. | `main/git/worktreeCreate.ts` → `defaultWorktreesRoot`; `renderer/mode/codeSettingsLogic.ts` | `worktreeCreate.test.ts`, `codeSettingsLogic.test.ts`; e2e `e2e:codemode` |
| COD-6 | Remove worktree | Shipped | Worktree context menu | Stops and removes its sessions from SessionDeck and forgets the worktree; the folder and branch **stay on disk** (no git delete in v1). | `main/app/codeWiring.ts`; `renderer/code/sidebar/removeCopy.ts` | `codeWiring.test.ts`, `removeCopy.test.ts`; e2e `e2e:codemode` |
| COD-7 | Changes list | Shipped | Side panel > Changes (Code only) | Diff vs `merge-base(base, HEAD)` including committed, staged, unstaged and untracked; renamed/deleted/added kinds; additions/deletions; binary counts null; max 500 files (`truncated`); git errors returned as a readable `error`, not a crash. | `main/git/worktreeChanges.ts`, `worktreeParse.ts`, `untrackedCount.ts`; `renderer/code/changes/*` | `worktreeChanges.test.ts`, `worktreeParse.test.ts`, `untrackedCount.test.ts`, `changesState.test.ts`; e2e `e2e:codemode` |
| COD-8 | File diff | Shipped | Click a changed file | Unified diff for **one listed path only** (main re-validates); binary → `binary: true`, empty diff; cut at 512 KB (`truncated`); renderer parses hunks. | `main/git/worktreeFileDiff.ts`; `renderer/code/changes/parseUnifiedDiff.ts`, `DiffView.tsx` | `worktreeFileDiff.test.ts`, `parseUnifiedDiff.test.ts`; e2e `e2e:codemode` |
| COD-9 | Changes refresh cadence | Shipped | Continuous | Recompute 1.5 s after a Stop hook in that worktree, on open, every 10 s while the panel is visible, every 30 s for row counts; a changed result is pushed to all windows (`ev:worktreeChanges`) only when the content key differs. | `main/app/codeWiring.ts` → `CHANGES_AFTER_TURN_MS`, `changesKey`; `renderer/code/changes/useWorktreeChanges.ts` | `codeWiring.test.ts`, `changesLoad.test.ts`; e2e `e2e:codemode` |
| COD-10 | Pop-out Code window | Shipped | "Open Code in its own window" / "Move Code back" | Second BrowserWindow with `--sessiondeck-window=code`; `windowRole` fixes the renderer to Code; while popped out the main window shows Ops; docking returns Code to the main switch; focus requests route to the owning window. | `main/app/windowRegistry.ts`; `shared/ipc.ts` → `CODE_WINDOW_ARG`; `renderer/mode/useUiMode.ts` | `windowRegistry.test.ts`, `modeLogic.test.ts`; e2e `e2e:codemode` |

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
| WRK-4 | Worker tabs and view | Shipped | Claude session with workers | Read-only tabs; finished tabs close 2 min after ending unless being read; `×` only hides; selecting any session or the Hub leaves the worker view. | `renderer/workers/useWorkers.ts`, `WorkerTabs.tsx`, `WorkerView.tsx`, `workerLogic.ts` | `workerLogic.test.ts`; e2e `e2e:workers` |
| WRK-5 | Worker limitations | Gap | — | `opencode --pure` (no plugins) invisible; Claude sessions opened before the feature need a restart; workers started from an OpenCode session inside the app are not covered; no interactive worker terminal and no resume-from-tab (deferred). | — | See `HANDOFF.md` |

### 2.17 SEC — Robustness & security

| ID | Feature | Status | Trigger / entry | Rules (must-know) | Code | Tests |
|---|---|---|---|---|---|---|
| SEC-1 | IPC validation | Shipped | Every renderer → main call | Each handler validates ids/payloads (`assertId`, `assertBoolean`, `asCreateWorktreeInput`, …); malformed calls reject without wedging main; late IPC after a session stopped is safe. | `main/app/ipcValidation.ts`, `ipcHandlers.ts`, `codeWiring.ts` | `ipcValidation.test.ts`, `ipcValidation.code.test.ts`, `ipcValidation.notes.test.ts`; e2e `e2e:robust` |
| SEC-2 | Hook server token and caps | Shipped | Hooks / statusLine / workers | Local HTTP server; per-app token checked on every request; body caps (64 KB statusLine, 32 KB worker); oversized bodies drained, not backed up. | `main/attention/HookServer.ts` | `HookServer.test.ts`, `HookServer.route.test.ts`, `HookServer.statusLine.test.ts` |
| SEC-3 | Credentials stay in main | Shipped | Manual usage refresh | The Claude OAuth token is read and used only in main; never sent over IPC, stored or logged; errors and logs are asserted not to contain it. | `main/usage/oauthUsage.ts`, `usageRefresh.ts` | `oauthUsage.test.ts`, `usageRefresh.test.ts`; e2e `e2e:usage-refresh` |
| SEC-4 | Process-tree kill | Shipped | Close / remove / quit | Whole tree is killed while the parent is alive; no orphan dev servers. | `main/pty/treeKiller.ts` | `treeKiller.test.ts`; e2e `e2e:busyclose` |
| SEC-5 | Test isolation | Shipped | Any e2e / smoke test | Tests use a temp user-data dir and never change the user's real Claude/OpenCode config; never send state-changing slash commands into a test Claude session; use a temp `--settings` file (W11). | `scripts/e2e-lib.cjs` | e2e suites |

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
| `session:setActive` | SES-13 | `activeSessions` |
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
| `app:quit` | WIN-3 | `quitState` |
| `usage:get` / `usage:refresh` | USE-2/4 | `UsageService`, `usageRefresh` |
| `workers:get` | WRK-3/4 | `WorkerHub` |
| `timeline:get` / `away:getLast` | TML-1/6 | `timelineService`, `featureWiring` |
| `quota:autopilotGet` / `quota:sleepIdle` / `quota:wake` | USE-7/8/9 | `autopilot` |
| `repo:*` / `worktree:*` | COD-2..9 | `codeWiring` |
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

### 3.3 localStorage keys

| Key | Owner | Meaning |
|---|---|---|
| `sessiondeck-open-tabs` (+`.code`) | TAB-1 | Open tab ids + active tab |
| `sessiondeck.split.v1` (+`.code`) | TRM-7 | Split direction, panes, sizes |
| `sessiondeck.view.v1` (+`.code`) | TAB-4 | `terminal` \| `hub` (grid later) |
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

> `.code` suffix is added by `storageKeyFor(base, 'code')`; Ops keeps the historical key. Do not invent new suffixes.

### 3.4 Disk files (`<userData>`)

| File | Feature | Notes |
|---|---|---|
| `sessiondeck-store.json` | SET-3 | Sessions, groups, statuses, settings, repos, worktrees |
| `sessiondeck-store.json.bak` | SET-3 | Best-effort copy after a successful load |
| `sessiondeck-timeline.json` | TML-3 | Turns (200/session, 30 days) + last sleep per session |
| `quota-markers.json` | USE-5 | Alert markers per window instance |
| `quota-autopilot.json` | USE-7/8 | Held sessions + reset time |
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
| `Ctrl+C` / `Ctrl+Shift+C` / `Ctrl+V` | Copy / copy / paste | Terminal | TRM-3 |
| `Ctrl+Shift+F` | Find in the terminal (visible pane) | Terminal / grid view | TRM-12 |
| `↑` / `↓`, `Enter`, `Delete` | Sidebar navigation | Sidebar focused | NAV-9 |
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
| `away.enabled` / `.afterMinutes` | `true` / `15` | TML-5 |
| `code.worktreesRoot` | `''` (home default) | COD-5 |
| `code.shell` | `powershell` | AGT-3 |

### 3.7 e2e script → feature

| Script | Feature(s) | Scope |
|---|---|---|
| `e2e.cjs` | SES-1/2/3, TRM-10, ATT-1 | Smoke: window, create/rename/status, real Claude PTY, hooks → attention, colours, close |
| `e2e-close.cjs` | SES-6/7/8 | Close / reopen / instant reopen / remove |
| `e2e-resume.cjs` | SES-12 | Kill + relaunch, same conversation |
| `e2e-dialogs.cjs` | SES-1/2, SET-1 | New Session + Statuses dialogs through real input; unsafe args rejected |
| `e2e-robust.cjs` | SEC-1, SET-3 | Late/bogus IPC, malformed create, save on quit |
| `e2e-busy-close.cjs` | SES-14 / SEC-4 | Busy session close leaves no process |
| `e2e-bell.cjs` | ATT-2/3/4, SES-13 | Bell on card/tab/Hub, mark read/unread, real background turn |
| `e2e-hub.cjs` | HUB-1/2/3, ATT-5, SET-1 | Hub columns, drag status, settings, sound pipeline |
| `e2e-hubscroll.cjs` | HUB-6 | Busiest-column scroll |
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
| `e2e-workspaces.cjs` | NAV-4 | Workspace headers, collapse, toggle, prefilled folder |
| `e2e-foldertabs.cjs` | TAB-2 | Per-folder tab bar |
| `e2e-palette.cjs` | PAL-1..4 | Real keys, filtering, jump, actions |
| `e2e-paste.cjs` | TRM-3/4 | Right-click pastes once in both UIs |
| `e2e-imagepaste.cjs` | TRM-4 | Image paste + file drop |
| `e2e-links.cjs` | TRM-5 | Link hover targets |
| `e2e-termview.cjs` | TRM-12 | Real Ctrl+Shift+F keys, query/count/cycling/Esc, built scrollbar rule (plus zoom + scrollback) |
| `e2e-checklist-draft.cjs` | NTS-5 | Draft survives session switch |
| `e2e-workers.cjs` | WRK-1..4 | Real plugin → hook → hub → tabs |
| `e2e-lastfolder.cjs` | SES-1 | Last folder remembered |
| `e2e-visual.cjs` | UI review | Screenshots of every state |
| `e2e-packaged.cjs` | Packaging | Packaged exe smoke |

---

## 4. Change recipes

### 4.1 Add a setting

1. Add the field to the right `*Settings` interface in `src/shared/types.ts` and to `DEFAULT_APP_SETTINGS` (and `SettingsPatch`).
2. Validate it in `main/app/settingsValidation.ts` and `main/store/settings.ts` (clamps, allowed values, cross-field rules).
3. Add the control to the matching `renderer/settings/*Section.tsx`; write through `actions.updateSettings`.
4. Use the value in the owning module; never read `localStorage` for a real setting.
5. Unit-test validation + default merge; add/extend an e2e if it changes visible behaviour.
6. Document it in §3.6 and `HANDOFF.md`.

### 4.2 Add an IPC call

1. Add the channel to `IPC` and the method to `Api` in `src/shared/ipc.ts`.
2. Implement it in `src/preload/index.ts` with `ipcRenderer.invoke`.
3. Register and validate it in `main/app/ipcHandlers.ts` (or the feature wiring file) — validate ids and payloads; never trust the renderer.
4. Call it from a renderer action (`useSessionStore` / feature hook), not from a component directly when state must update.
5. Add a unit test for validation; add a real-app e2e if it changes user-visible behaviour.
6. Update §3.1 and `docs/CODEMAP.md` if a new file/folder appears.

### 4.3 Add a view

1. Extend `MainView` in `renderer/mode/viewPref.ts` (`parseView` must still fall back safely).
2. Add per-mode keys only if the view has its own persisted state (`modeStorageKeys`).
3. Add a pure logic module + tests first (mirror `splitLogic.ts`).
4. Add a hook (mirror `useSplitLayout.ts`) and render it from `ModeWorkspace.tsx`; keep one xterm registry per session (see TRM-1).
5. Add the control to the tab bar and a palette item; make focus requests land in the view.
6. Extend `e2e-visual.cjs` and add an e2e suite; update `HANDOFF.md` + `docs/CODEMAP.md`.

### 4.4 Add an agent

1. Extend `AgentKind` in `src/shared/types.ts` (and any badge/label map).
2. Add launch options in `main/app/startOptions.ts` (command, args, env, resume rule).
3. Add hook/attention integration if the agent can report state (`main/attention`, `main/opencode` pattern).
4. Add the dropdown option in `NewSessionDialog` and the default in Settings > Agents; validate its model/args in `dialogLogic.ts`.
5. Define sleep/restart behaviour (Shell-style never-sleep vs conversation resume).
6. Unit-test start options; add a real-agent e2e if the CLI is available; document limits.

### 4.5 Add a pure feature slice

1. Put rules in a `*Logic.ts` with no React/DOM/IPC.
2. Unit-test it in a sibling `*.test.ts` first.
3. Wrap it in a hook that owns persistence/IPC.
4. Render it with existing primitives; reuse the Orca look.
5. Add an e2e that drives the real app; take a screenshot for UI work.

---

## 5. Invariants (do not break)

1. **One xterm per session.** Panes/cells hide, never unmount. Split, grid (once built) and tab switching must share the same registry.
2. **Split stays at 4 panes** (`MAX_PANES = 4`); grid is a separate layout with its own max (6).
3. **No duplicate session in visible panes/cells.** Picking an already-visible session moves it.
4. **Closed sessions cannot be used** until reopened; they have no PTY.
5. **Shell sessions are never auto-slept** (idle, sleep-all, quota).
6. **Keep awake and Remote Control sessions are never slept** by any automatic rule.
7. **Busy / needs-input sessions are never interrupted** by quota autopilot.
8. **Only `Stop` and `Notification` hooks ping.** The idle-output detector is intentionally a no-op.
9. **The on-screen session is recorded but never pings** (sound/flash/desktop notice).
10. **Sleeping keeps the bell** (D27); closing/removing forgets it.
11. **Manual usage refresh only**; the endpoint is never polled; the OAuth token stays in main and is never logged, stored or sent over IPC.
12. **The store is never overwritten on a read error**; invalid JSON is quarantined, locked files abort startup.
13. **All IPC is validated in main**; malformed or late calls must not wedge the main process.
14. **Kill the whole process tree** on close/remove/quit.
15. **Per-mode storage**: Ops keeps the historical keys; Code appends `.code`. Never mix them.
16. **A session belongs to Code iff it has `worktreeId`.**
17. **Claude sessions always run yolo** unless the user already passed a permission flag.
18. **Tests never touch the user's real Claude/OpenCode config** (W11); use a temp user-data dir and a temp `--settings` file.
19. **Docs stay current**: a shipped feature updates `HANDOFF.md`; a decision updates `DECISIONS.md`; a new folder updates `CODEMAP.md`; a new gotcha updates `LESSONS.md`.

---

## 6. Known gaps and not-built features

| Item | Status | Detail |
|---|---|---|
| Grid view (1x1 … 3x2, 6 panes) | Planned (D32) | `plan/grid-view.md`, waiting for the user's "go". |
| Auto-update | Deferred | Not started. |
| Interactive OpenCode worker terminal | Deferred | Phase 2 idea (`opencode serve` + `attach`); worker tabs stay read-only. |
| Light theme | Deferred | Dark only. |
| Sound / taskbar flash human verification | Gap | Code paths tested; not heard/seen by a human. |
| Real-mouse drag and drop | Gap | Pure logic tested; HTML5 DnD events not simulated. |
| Packaged installer freshness | Gap | `release/SessionDeck-Setup-0.0.3.exe` is stale relative to current code; build only on request (W09). |
| Autopilot limit wording | Gap | `USAGE_LIMIT_PATTERNS` may need additions once seen in the wild. |
| Windows reserved worktree names | Gap | `con`, `nul`, … are not mapped. |
| Away summary across restart | Gap | Sleeps from before a restart are not known to the summary. |
| Timeline turn edges | Gap | A late Stop could end the next turn; late cost could count toward it. |
| Claude trust-folder prompt | Gap | Asks once per new worktree; not bypassed. |

---

*Last updated: 2026-10-25. Keep the matrices and the maps in sync with the code; when in doubt, read the module named in the `Code` column.*
