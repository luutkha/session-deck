# Code map

Where things live. One line per folder, plus the files you usually need. Feature details (how a feature works, its e2e) are in `HANDOFF.md`; the feature tree + matrices (rules, code path, tests per feature) are in `docs/FEATURES.md`. Tests sit next to the code as `*.test.ts`.

## Contract (main <-> renderer), change additively and on purpose
- `src/shared/types.ts`: every shared shape (Session, RuntimeState, AppSettings + defaults, usage, workers).
- `src/shared/ipc.ts`: channel names (`IPC.*`) and the `Api` interface the renderer sees as `window.api`.
- `src/preload/index.ts`: implements `window.api` with `ipcRenderer`.

## Main process (`src/main/`)
- `index.ts`: startup wiring (window registry: main + popped-out Code window, events broadcast to both). Creates store, pty, attention, runtime, controller, schedulers, tray, IPC; shutdown order.
- `app/`: the core. `codeWiring.ts` (Code mode IPC: repos, worktrees, changes, diffs; pushes ev:worktreeChanges), `windowRegistry.ts` + `activeSessions.ts` (two windows, session on screen per window), `featureWiring.ts` (connects timeline, away summary and quota autopilot to store/runtime/usage/IPC), `userPresence.ts` (away detection from user input), `sessionController.ts` (start/close/reopen/sleep/hook events), `runtimeRegistry.ts` (live per-session state: run, attention, activity, sleeping), `ipcHandlers.ts` + `ipcValidation.ts` + `settingsValidation.ts` (every IPC entry is validated here), `startOptions.ts` / `claudeLaunch.ts` (how `claude` / `opencode` are launched — OpenCode sessions run `opencode --standalone [-s <id>]`, the model goes into the config content), `transcript.ts` (resume checks), `outputSignals.ts` (Remote Control and spinner read off the screen), `trustPrompt.ts` (opt-in detection/answer of Claude's folder-trust menu), `window.ts`, `trayWiring.ts`, `closeToTray.ts`, `loginItem.ts`, `paths.ts`, `errorLog.ts`, `navigation.ts` (same-document check for `will-navigate`).
- `store/`: persisted data. `SessionStore.ts`, `reducers.ts` (pure updates), `codeReducers.ts` + `codePersistence.ts` (repos, worktrees), `persistence.ts` (load/save, drops invalid values), `settings.ts` (settings validation), `sessionNotes.ts`.
- `pty/`: terminals. `PtyManager.ts` (node-pty ConPTY), `RingBuffer.ts` (replay), `treeKiller.ts` (kills the whole process tree), `launch.ts`.
- `attention/`: who needs the user. `HookServer.ts` (local HTTP server for Claude hooks, statusLine, worker events; token-checked), `claudeSettings.ts` (the private `--settings` file), `AttentionManager.ts` (reasons + priority), `AttentionService.ts`, `Notifier.ts`, `IdleDetector.ts`.
- `automation/`: auto status from hook activity.
- `sleep/`: `sleepPolicy.ts` (per-session idle rule), `sleepAllPolicy.ts` (sleep everything when the app is idle), `SleepScheduler.ts` (30 s tick, user input).
- `quota/`: 80/95% plan alerts (`quotaGuard.ts`), markers file, notices, delivery (`quotaWiring.ts`), and the autopilot (`autopilot.ts` service, `autopilotOps.ts` actions, `autopilotPolicy.ts` pure rules, `autopilotTimer.ts` reset timer, `autopilotContinue.ts` typing "continue", `autopilotStore.ts` state file, `continueFailedNotice.ts` "SessionDeck needs you" text for D33 failures). Hands-off defaults `sleep`/`wake`/`continue` live in `shared/types.ts`, and the one-time old-defaults migration is `store/settings.ts → upgradeLegacyQuotaFields`.
- `usage/`: statusLine parsing, `UsageService.ts`, manual refresh through the OAuth usage endpoint (`oauthUsage.ts`, token stays in main).
- `git/`: Code mode git service, always `execFile('git')`: `repoInfo.ts` (repo root, branches), `branchName.ts` (git-safe names), `worktreeCreate.ts` (`git worktree add -b`), `worktreeChanges.ts` + `worktreeParse.ts` + `untrackedCount.ts` (changes vs merge-base), `worktreeFileDiff.ts` (one file's diff, only for listed paths), `previewRead.ts` (rendered preview of one worktree file: image base64 / markdown text, path resolved + realpath-checked inside the worktree).
- `timeline/`: per-session turn log (`timelineService.ts`, `timelineState.ts` pure updates, `timelineFile.ts` persistence) and `awaySummary.ts` (pure "While you were away" builder).
- `notify/`: desktop notifications. `tray/`: tray icon and menu.
- `links/`: resolves and opens URLs and paths clicked in the terminal.
- `opencode/`: the plugins injected into OpenCode sessions: `pluginEnv.ts` merges any number of SessionDeck plugin paths into `OPENCODE_CONFIG_CONTENT` (`applyConfigPatch` merges extra top-level keys like `model`; both plugins report their pid as `proc` so the app can tell the owner apart from child workers), `writePlugin.ts` writes the plugin PACKAGE directories (`sessiondeck-opencode-plugin/`, package.json `main` → index.mjs — OpenCode v2 loads configured plugins from package directories only) and removes the legacy single-file plugins. `workers/`: read-only tabs for `opencode` processes started from Claude, Shell or OpenCode sessions (`WorkerHub.ts` with the owner-process handshake, plugin sources).

## Renderer (`src/renderer/`)
- `App.tsx`: window shell (store, usage, mode, focus requests, quota toast; sound and away summary in the main window only).
- `mode/`: Ops | Code (D31). `ModeWorkspace.tsx` (one mode's whole layout, mounted per mode), `useWorkspaceNav.ts` (tabs/split/view per mode), `useWorkspaceCommands.ts` (dialogs, palette, shortcut), `WorkspaceDialogs.tsx`, `ModeTitleBar.tsx` + `ModeSwitch.tsx`, `useUiMode.ts` (stored mode, pop out / dock), `modeLogic.ts` (filter by mode, mode-scoped storage keys).
- `state/`: `useSessionStore.ts` (store + runtime from main, `actions`), `selectors.ts` (grouping, workspaces, filters), `multiSelect.ts` + `useMultiSelect.ts` (bulk-selection rules, shared by the sidebar and the Hub), `formatTime.ts`.
- `Sidebar/`: session list, groups, workspaces, status view, Closed section, context menus, New session dialog (`dialogLogic.ts`).
- `shell/`: tab bar, status bar, title bar, empty state, tab shortcuts, user-activity reporter.
- `Terminal/`: xterm panes, split workspace, keymap (paste, right click), terminal search (Ctrl+Shift+F), link detection, file drop.
- `split/`: split layout logic. `hub/`: Hub board by status. `notes/`: notes and checklist panel. `components/BulkActionBar.tsx`: the floating bar shared by the sidebar and the Hub.
- `attention/`: bell icon, Needs you list. `palette/`: command palette (Ctrl+K / Ctrl+Shift+K).
- `code/`: Code mode UI. `sidebar/` (repo > worktree > sessions tree, `codeTree.ts` pure), `dialogs/` (New worktree, New session in a worktree), `changes/` (Changes panel, `parseUnifiedDiff.ts`, `DiffView`, `useWorktreeChanges` + `useWorktreeChangeCounts`, per-line diff comments `annotations.ts` sent to the session via ptyWrite, rich previews: Diff | Preview toggle, `preview.ts` + `PreviewView.tsx` + `MarkdownView.tsx` + `useWorktreeFilePreview.ts`).
- `timeline/`: Activity tab (`ActivityList`, `useTimeline`), "While you were away" dialog (`AwayDialog`, `useAwaySummary`), formatting (`timelineFormat.ts`), side-panel tab pref.
- `settings/`: Settings dialog and its sections. `sound/`: built-in and custom sounds. `usage/`: usage chips, quota toast with autopilot buttons (`QuotaToast*`, `quotaToastLogic.ts`, `quotaActions.ts`), held-for-reset chip (`QuotaHeldChip`, `useQuotaAutopilot`).
- `workers/`: OpenCode worker tabs. `grid/`: the grid view (D32) — `gridLogic.ts` (presets, cells, swap/overflow maths, persist format), `useGridLayout.ts` (reducer + per-mode storage), `GridView.tsx` + `GridCellHeader.tsx` (interactive terminal cells, session picker). `components/ui/`: shadcn/Orca primitives (dialog, command, select...). `styles/`: Orca theme tokens.

## Scripts (`scripts/`)
- `e2e-lib.cjs`: launches the built app with a temp user-data dir and drives it over CDP (`evaluate`, `send`); `stopOpencodeService()` stops a stale OpenCode background service so cold-spawned children inherit the run's env.
- `run-e2e-detached.cjs`: runs an e2e script DETACHED (`detached: true`, own process group, log `scripts/<name>-last.log`) so an OpenCode server restart in the driving agent's session cannot abort the run; `vitest-full.cjs`: full unit suite via the same launcher.
- `e2e-<feature>.cjs`: one real-app suite per feature (list and purpose in `HANDOFF.md`; many have `npm run e2e:<name>`).
- `smoke-*.cjs`: manual checks with real Claude / OpenCode. `probe-*.cjs`: one-off investigations. `make-icons.cjs`, `patch-node-pty.mjs`: build helpers.

## Reference
- `reference/orca/`: Orca's source (MIT). Copy its components and look from here; keep the attribution header.
