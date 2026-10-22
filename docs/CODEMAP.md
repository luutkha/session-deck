# Code map

Where things live. One line per folder, plus the files you usually need. Feature details (how a feature works, its e2e) are in `HANDOFF.md`. Tests sit next to the code as `*.test.ts`.

## Contract (main <-> renderer), change additively and on purpose
- `src/shared/types.ts`: every shared shape (Session, RuntimeState, AppSettings + defaults, usage, workers).
- `src/shared/ipc.ts`: channel names (`IPC.*`) and the `Api` interface the renderer sees as `window.api`.
- `src/preload/index.ts`: implements `window.api` with `ipcRenderer`.

## Main process (`src/main/`)
- `index.ts`: startup wiring. Creates store, pty, attention, runtime, controller, schedulers, tray, IPC; shutdown order.
- `app/`: the core. `sessionController.ts` (start/close/reopen/sleep/hook events), `runtimeRegistry.ts` (live per-session state: run, attention, activity, sleeping), `ipcHandlers.ts` + `ipcValidation.ts` + `settingsValidation.ts` (every IPC entry is validated here), `startOptions.ts` / `claudeLaunch.ts` (how `claude` / `opencode` are launched), `transcript.ts` (resume checks), `outputSignals.ts` (Remote Control and spinner read off the screen), `window.ts`, `trayWiring.ts`, `closeToTray.ts`, `loginItem.ts`, `paths.ts`, `errorLog.ts`.
- `store/`: persisted data. `SessionStore.ts`, `reducers.ts` (pure updates), `persistence.ts` (load/save, drops invalid values), `settings.ts` (settings validation), `sessionNotes.ts`.
- `pty/`: terminals. `PtyManager.ts` (node-pty ConPTY), `RingBuffer.ts` (replay), `treeKiller.ts` (kills the whole process tree), `launch.ts`.
- `attention/`: who needs the user. `HookServer.ts` (local HTTP server for Claude hooks, statusLine, worker events; token-checked), `claudeSettings.ts` (the private `--settings` file), `AttentionManager.ts` (reasons + priority), `AttentionService.ts`, `Notifier.ts`, `IdleDetector.ts`.
- `automation/`: auto status from hook activity.
- `sleep/`: `sleepPolicy.ts` (per-session idle rule), `sleepAllPolicy.ts` (sleep everything when the app is idle), `SleepScheduler.ts` (30 s tick, user input).
- `quota/`: 80/95% plan alerts, markers file, notices.
- `usage/`: statusLine parsing, `UsageService.ts`, manual refresh through the OAuth usage endpoint (`oauthUsage.ts`, token stays in main).
- `notify/`: desktop notifications. `tray/`: tray icon and menu.
- `links/`: resolves and opens URLs and paths clicked in the terminal.
- `opencode/`: the plugin injected into OpenCode sessions. `workers/`: read-only tabs for `opencode` processes started from Claude sessions (`WorkerHub.ts`, plugin source).

## Renderer (`src/renderer/`)
- `App.tsx`: top-level layout and wiring (views, dialogs, shortcuts, palette).
- `state/`: `useSessionStore.ts` (store + runtime from main, `actions`), `selectors.ts` (grouping, workspaces, filters), `formatTime.ts`.
- `Sidebar/`: session list, groups, workspaces, status view, Closed section, context menus, New session dialog (`dialogLogic.ts`).
- `shell/`: tab bar, status bar, title bar, empty state, tab shortcuts, user-activity reporter.
- `Terminal/`: xterm panes, split workspace, keymap (paste, right click), link detection, file drop.
- `split/`: split layout logic. `hub/`: Hub board by status. `notes/`: notes and checklist panel.
- `attention/`: bell icon, Needs you list. `palette/`: command palette (Ctrl+K / Ctrl+Shift+K).
- `settings/`: Settings dialog and its sections. `sound/`: built-in and custom sounds. `usage/`: usage chips, quota toast.
- `workers/`: OpenCode worker tabs. `components/ui/`: shadcn/Orca primitives (dialog, command, select...). `styles/`: Orca theme tokens.

## Scripts (`scripts/`)
- `e2e-lib.cjs`: launches the built app with a temp user-data dir and drives it over CDP (`evaluate`, `send`).
- `e2e-<feature>.cjs`: one real-app suite per feature (list and purpose in `HANDOFF.md`; many have `npm run e2e:<name>`).
- `smoke-*.cjs`: manual checks with real Claude / OpenCode. `probe-*.cjs`: one-off investigations. `make-icons.cjs`, `patch-node-pty.mjs`: build helpers.

## Reference
- `reference/orca/`: Orca's source (MIT). Copy its components and look from here; keep the attribution header.
