# SessionDeck

A Windows desktop app for running and managing many [Claude Code](https://claude.com/claude-code), OpenCode and shell sessions side by side, with **Jarvis**, an AI session that controls the app for you. The look follows [Orca](https://www.onorca.dev/) (MIT).

## Features

**Sessions**
- Each session is a real terminal (xterm.js WebGL + node-pty/ConPTY). Create one with Ctrl+Shift+N from anywhere.
- Every session keeps its own conversation, which comes back after a restart. Sessions that were running when you quit start again on launch.
- Organize sessions with names, groups, workspaces by folder, and your own statuses (name + colour). Group the list by group or by status, and sort it: manual (drag), needs attention, last active, newest, or name.
- Close a session (it keeps its conversation and can be reopened), sleep and wake it, keep it awake, or fork a Claude conversation.
- Presets save a New Session form for one-click starts.
- The prompt queue sends the next prompt when the current turn finishes. Bulk-select sessions to sleep, wake, set a status, move, or send one prompt to all of them.

**Seeing what matters**
- An Orca-style attention bell and a "Needs you" list, with sounds you choose and desktop notices. The alert repeats while a session stays unread.
- A Hub board by status, a grid of live terminals, split panes, tabs per folder, a command palette (Ctrl+K / Ctrl+Shift+K) and terminal search (Ctrl+Shift+F).
- Right-click in a terminal for Orca's menu: Copy, Select All, Paste, Find, Fork, Split, Close Pane, Copy Folder Path, Clear Screen. Prefer instant copy/paste? Settings > Terminal > Right-click.
- Click a file path in a terminal to preview it in the right side panel: Markdown (with its relative images and links), text, images (including SVG), CSV, Excel (.xlsx), Word (.docx) and PDF. The panel is resizable, and Detach opens the file in its own window (Ctrl+click opens it in its default app). The preview reloads when the file changes, has find, zoom, sortable paged tables and Copy path / Open / Show in Explorer buttons; you can also drop a file on the panel, use the palette's Preview file..., or ask Jarvis.
- The status bar shows plan usage for Claude and OpenCode Go, plus the active session's model, context fill and cost.
- A per-session timeline, "While you were away", a cost report, and search across past conversations.
- A quota autopilot sleeps idle sessions at the limit, wakes them at the reset, and types "continue" for you.

**Code mode**
- Add git repos and create worktrees, each with its sessions (Claude, OpenCode or a plain shell). Start a worktree from a new branch (a taken name becomes name-2), from a branch you already have, or use the repository folder itself.
- A Changes panel with diffs per file. Comment on diff lines and send the comments to the agent. Rendered Markdown and image previews.
- Commit the files you tick, push, open a pull request (GitHub CLI, or the GitHub/GitLab/Bitbucket page in your browser), merge a worktree into its base, and delete a finished worktree's folder and branch.
- Code mode can pop out into its own window.

**Jarvis** (Ctrl+Shift+J, or the Jarvis button in the tab bar)
- A right-side panel over every session, in both modes. Ask in plain words: create, close, sleep, wake, restart or fork sessions; send prompts and wait for results; read a session's screen or last answer; manage groups, statuses and notes; create worktrees; check usage. It controls the whole app: what is on screen (mode, Hub, grid, split, sidebar, side panel, dialogs, zoom), settings, prompt queues, checklists, presets, bulk actions, the quota autopilot, costs, diffs and review comments.
- Also the rest of the app: sounds, the sidebar list and Code tree, a changed file's diff or preview on screen, terminal search, tabs, files and images into a session, links in a terminal, the window (hide, start on login, quit after asking) and restarting itself.
- Removals ask you first in the app. An Undo button reverts Jarvis's last actions.
- Scheduled instructions, e.g. "every weekday at 9:00, wake API and run the tests".
- Voice: a mic button (Windows speech recognition, offline) and replies read aloud.
- Runs on Claude (Sonnet by default) or on OpenCode with cheaper or free models (Settings > Agents).

## Run

```bash
npm install          # also rebuilds node-pty for Electron
npm run dev          # development
npm run preview      # run the production build
npm run dist         # installer in release/ (unsigned)
```

Requires Node 22+, Windows (primary target) and the `claude` CLI on PATH, logged in. The `opencode` CLI is optional (OpenCode sessions, Jarvis on OpenCode).

## Test

| Command | What it covers |
|---|---|
| `npm test` | unit tests (Vitest) |
| `npm run typecheck` | strict TypeScript, main + renderer |
| `npx electron-vite build` then `node scripts/e2e-<name>.cjs` | one real-app suite per feature, driven over CDP with a temp profile |
| `npm run e2e` | smoke: window, create/rename/status, real `claude` in a PTY, hooks → attention, close |
| `npm run e2e:jarvis` | Jarvis: MCP tool server, tools on real sessions, confirm dialog, panel in Ops and Code, schedules, undo |
| `npm run e2e:code-git` | Code mode commit, push, PR, merge, delete from disk (D60) |
| `npm run e2e:sort` | Sort sessions in the sidebar, Code tree and Hub (D61) |
| `npm run e2e:worktree-sources` | Code mode workspaces (D57): taken name gets -2, existing branch, repo folder |
| `npm run e2e:termmenu` | The terminal right-click menu (D59): rows, paste once, copy, find, split, close pane, clear, the copy/paste choice |
| `npm run e2e:jarvis-app` | Jarvis's D58 tools: sounds, sidebar list, tabs, terminal search, files, links, window, Code tree, file on screen |
| `npm run e2e:jarvis-control` | Jarvis controls the whole app (D55): screen, settings, queue, checklist, groups, statuses, presets, bulk |
| `npm run e2e:packaged` | the packaged app (`release/win-unpacked`), including Jarvis |
| `npm run e2e:spaces` | the app and Jarvis with paths that contain spaces |

Every suite and what it proves: `docs/FEATURES.md` §3.7. Suites named `*-real`, plus `e2e`, `e2e:bell` and `e2e:notes`, send a few tiny prompts to a real Claude (a little of your plan). How changes are built and verified: `docs/IMPLEMENTATION.md`.

## Layout

- **Code:** `src/main` (Electron main: store, pty, attention, agents, Code mode, Jarvis), `src/preload`, `src/renderer` (React UI), `src/shared` (the IPC contract and shared helpers).
- **Scripts:** `scripts` (e2e suites and helpers), `reference/orca` (MIT reference copy used for the design).
- **Docs:** `CLAUDE.md` and `AGENTS.md` (agent entry points), `HANDOFF.md` (current state), `docs/` (decisions, features, implementation standard, code map, lessons).

Window lifecycle events go to `<userData>/window-events.log` (the first place to look if the window does not appear). Unexpected main-process errors go to `<userData>/main-errors.log`. Jarvis's actions go to `<userData>/jarvis/actions.log`.

## Credits

UI components and design tokens adapted from [stablyai/orca](https://github.com/stablyai/orca), MIT, Copyright (c) 2026 Lovecast Inc. See `THIRD_PARTY_NOTICES.md`.
