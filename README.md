# SessionDeck

A desktop app for running and managing many [Claude Code](https://claude.com/claude-code) sessions side by side. The look follows [Orca](https://www.onorca.dev/) (MIT); the feature set is deliberately narrow.

## Features

- **Sessions in one click**: create a Claude Code session in a folder (Ctrl+Shift+N from anywhere, Ctrl+N outside the terminal); each session is a real terminal (xterm.js + WebGL, node-pty/ConPTY) that feels native.
- **Rename** a session or group inline (double-click or F2).
- **Statuses you define**: assign your own statuses (name + color) per session; group or filter by status.
- **Attention alerts**: sound, taskbar flash and a pulsing indicator when a session finishes or needs permission (Claude Code hooks, with an idle-output fallback).
- **Groups**: create, rename, reorder, drag sessions between groups; group the list by Group or by Status.
- **Hub**: a board view with one column per status (plus "No status"); drag a card to another column to change its status, click it to open the session.
- **Settings**: customize the notification sound per event (needs permission / finished / waiting / terminal bell): 6 built-in synthesized sounds, your own audio file, volume, Test button; configure statuses (add, rename, recolor, reorder, delete; the order is the Hub column order).
- **Usage in the status bar**: your Claude plan usage (5-hour and weekly windows, with reset countdowns) and, for the active session, its model, context-window fill and cost. Live updates come from Claude Code's own statusLine after every turn (no credentials); a **reload button** on the bars fetches fresh numbers on demand, Orca-style, from Anthropic's usage endpoint using the Claude login token on this machine (explicit one-time consent first).
- **Notes and checklist per session**: a right-side panel with a work-in-progress checklist and free-text notes (autosaved); progress shows as "✓ 2/5" on sidebar and Hub cards.
- **Tabs + Closed**: open sessions are tabs. Closing a tab stops the session and moves it to a collapsed **Closed** section, from where you can resume the same conversation later.
- **Conversations survive restarts**: each session keeps its own Claude conversation (`--session-id` / `--resume`); after relaunching, selecting a session resumes it.

## Run

```bash
npm install      # also rebuilds node-pty for Electron
npm run dev      # development
npm run build && npx electron .   # run the production build
```

Requires Node 22+, Windows (primary target), and the `claude` CLI on PATH.

## Test

| Command | What it covers |
|---|---|
| `npm test` | unit tests (Vitest) |
| `npm run typecheck` | strict TypeScript, main + renderer |
| `npm run e2e` | drives the real built app over CDP: create/rename/status, real `claude` in a PTY, hooks to attention, colors, window shown, close |
| `npm run e2e:close` | close / reopen / instant reopen / remove |
| `npm run e2e:dialogs` | New session / Statuses dialogs through real mouse and keyboard, unsafe args rejected |
| `npm run e2e:robust` | late or bogus IPC does not freeze the main process, malformed createSession rejected, last change saved on graceful quit |
| `npm run e2e:hub` | Hub columns, drag a card between statuses, Settings (statuses add/reorder, sound Test plays through WebAudio), main attention event reaches the renderer sound player |
| `npm run e2e:busyclose` | closing a BUSY session (Claude running a shell command) leaves no process behind (checks the OS process tree) |
| `npm run e2e:notes` | notes + checklist through the UI and across a restart, and REAL plan usage / model / context / cost from a live Claude turn (sends one tiny prompt) |
| `npm run e2e:usage-refresh` | the reload button: consent dialog (Cancel = no request), then ONE real request to Anthropic's usage endpoint with the local Claude login |
| `npm run e2e:resume` | kills the app, relaunches it, checks the same conversation returns |
| `npm run e2e:codemode` | Code mode: real New worktree dialog, git branch + linked worktree on disk, Shell in the worktree, Changes + diff, pop out/dock, restart |
| `npm run e2e:workers` | OpenCode worker tabs from Claude sessions: real plugin file -> hook server -> hub -> read-only tab |
| `npm run e2e:annotate` | diff annotations (Code mode): comment on a diff line, restart (draft survives), send the comments into the real session terminal; disabled for Shell and sleeping sessions |
| `npm run e2e:preview` | rich previews (Code mode): Diff \| Preview toggle — sanitized markdown, image data URL, truncation note, traversal refused |
| `npm run e2e:grid` | grid view (D32): Grid ▾ presets, cell pickers (swap on duplicate), preset shrink/restore, typing lands in the cell, restart restores |
| `npm run e2e:termview` | terminal comfort: Ctrl+=/Ctrl+0/Ctrl+wheel zoom (pty width shrinks live), Settings > Terminal scrollback, restart keeps the zoom |
| `npm run e2e:tab-working` | tab working indicator: spinner while a hook-driven turn runs, bell wins after Stop, dot returns when cleared |
| `npm run e2e:timeline-prompt` | OpenCode parity: the plugin's prompt + statusline bodies reach the timeline, Activity tab, away summary, usage chip and Hub card |
| `npm run e2e:opencode` | real `opencode` on a free model: TUI, hooks/status, sleep + wake with `-s`, image paste, no self worker-tab |
| `npm run e2e:opencode-workers` | worker tabs of an OpenCode session: child events build a tab, child session-plugin events never touch the parent |
| `npm run e2e:handsfree` | hands-off quota autopilot (D33): fresh hands-off defaults, old-store boot migration, critical level sleeps with no toast, reset wakes + types "continue" into a real Claude TUI that was cut off by the limit; ask-mode still exists (runs one real "continue" turn) |
| `node scripts/e2e-visual.cjs` | screenshots every UI state into `scripts/visual/` for visual review |

## Layout

`src/main` (store, pty, attention, app wiring) · `src/preload` · `src/renderer` (Sidebar, shell/tab bar, Terminal, state, `components/ui` shadcn primitives) · `src/shared` (the frozen IPC contract) · `reference/orca` (MIT reference copy used for the design) · `DESIGN.md` · `HANDOFF.md`.

Window lifecycle events go to `<userData>/window-events.log` (first place to look if the window does not appear) and unexpected main-process errors to `<userData>/main-errors.log`.

## Credits

UI components and design tokens adapted from [stablyai/orca](https://github.com/stablyai/orca), MIT, Copyright (c) 2026 Lovecast Inc. See `THIRD_PARTY_NOTICES.md`.
