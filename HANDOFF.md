# SessionDeck handoff

Current state of the product and the code, in one page. Updated 2026-11-08.

Where the details live:
- **What the user decided:** `docs/DECISIONS.md` (D01–D61, working rules W01–W13).
- **Every feature (rules, code path, tests):** `docs/FEATURES.md`.
- **How to build a change:** `docs/IMPLEMENTATION.md`.
- **Which file does what:** `docs/CODEMAP.md`.
- **Gotchas already paid for:** `docs/LESSONS.md`.
- **Look (Orca):** `DESIGN.md`. Run/test: `README.md`.

---

## 1. State

- **D63 no-GPU support**: software rendering is detected (feature status + window WebGL probe), remembered, and the next start runs with the GPU process off; Auto renderer = DOM without a GPU; reduced effects; Settings > Terminal > Graphics. Emulated no-GPU (20 sessions): CPU 1,263% -> 65%, 28 -> 146 fps; `e2e-gpumode` 14/14; 3,597 unit tests. Not tried on a real GPU-less VM. **D64:** the first run on a GPU-less PC restarts itself once with the GPU off (`e2e-gpumode` 18/18). Not pushed.
- **D62 performance round (many sessions)**: pty output batching + O(1) ring buffer, WebGL only for visible panes, hidden panes queue output, memoized session rows, shared clock, store save max wait, throttled worker snapshots (bench: 20 sessions, pty messages 680/s -> 183/s, renderer busy 35% -> 13%, DOM nodes 130k -> 2.5k; `e2e-hiddenpane` 5/5; 3,523 unit tests). Not pushed.
- **D61 sort sessions** (Sort button in the sidebar header, Ops and Code: Manual, Needs attention, Last active, Newest, Name A–Z; Hub follows; saved `lastActiveAt`; `e2e-sort` 20/20, `e2e-jarvis-app` 23/23, `e2e-bulk` 18/18, `e2e-workspaces` 9/9, `e2e-codemode` 34/34, `e2e-hub` 12/12, `e2e-hubscroll` 7/7, 3,393 unit tests). Not pushed.
- **D60 Code mode commit / push / PR / merge / delete from disk** (Changes panel: ticks per uncommitted file, commit box, branch line with Push / Create PR / Merge; Remove worktree… can delete folder and branch; Jarvis 80 tools; `e2e-code-git` 29/29 three runs in a row, `e2e-jarvis` 60/60, `e2e-jarvis-control` 33/33, `e2e-jarvis-app` 23/23, `e2e-codemode` 34/34, `e2e-worktree-sources` 10/10, `e2e-annotate` 13/13, 3,447 unit tests). Not pushed. Fixed on the way: background `git status` no longer takes `index.lock` (`GIT_OPTIONAL_LOCKS=0`); an empty folder left by a half-done `git worktree remove` is cleaned up.
- **Shipped through D59** (terminal right-click menu like Orca, with a Settings choice for the old quick copy/paste, `c031425`; `e2e-termmenu` 16/16, `e2e-paste` 4/4, `e2e-imagepaste` 3/3, `e2e-termview` 15/15, `e2e-g1` 14/14, `e2e-grid` 15/15, 3,366 unit tests). Not pushed.
- **D58** (Jarvis controls every part of the app: 10 more tools, 75 in all; `e2e-jarvis-app` 21/21, `e2e-jarvis-control` 33/33, `e2e-jarvis` 60/60, 3,358 unit tests). Not pushed.
- **D57** (D56: Code mode stays git-only; D57: worktrees like Orca — auto-suffix, existing branch, repo folder; `e2e-worktree-sources` 10/10, 3,343 unit tests).
- **D55** (exit grid, tab bar for running and awake sessions only, Jarvis controls the whole app: 65 tools). Pushed.
- **D55 verification (dev build):** 3,329 unit tests (203 files), both typechecks clean, `e2e-jarvis-control` 33/33 (new), `e2e-jarvis` 60/60, `e2e-grid` 15/15, `e2e-foldertabs` 6/6, `e2e-annotate` 13/13, `e2e-codemode` 34/34. The installer was not rebuilt (still `84bf042`).
- **Installer:** `release/SessionDeck-Setup-0.0.8.exe`, built 2026-11-13 (D62 performance, D63 no-GPU support, D64 first-run restart; version bumped from 0.0.7). Unsigned (SmartScreen warns: "More info" -> "Run anyway"). Installing over an existing copy replaces it and keeps the user's data. `e2e:packaged` 15/15; the packaged exe detects a real GPU as hardware and `--disable-gpu` as software. Older: 0.0.6 (D60 + D61).
- **Verification baseline at the 0.0.3 build (`84bf042`):** 3,299 unit tests (202 files), both typechecks clean, `e2e:packaged` 15/15 (includes Jarvis's tool server and headless screen rendering), `e2e-spaces` 4/4 on the dev build and on the packaged exe, every Jarvis suite green (`e2e-jarvis` 60, `e2e-jarvis-real` 12, `e2e-jarvis-opencode` 5, `e2e-jarvis-voice` 10), and the regression list in the `84bf042` commit message.

---

## 2. What the app is

An Electron desktop app (Windows first) that runs many Claude Code, OpenCode and shell sessions as real terminals, with an Orca look (D02). Two modes:
- **Ops** (D01): sessions in folders, grouped.
- **Code** (D31): git repos, worktrees, the sessions in them, and a changes panel.

**Jarvis** (D53/D54) is an AI session in a right-side panel that controls the app through a local MCP tool server.

Feature domains (IDs in `FEATURES.md`):

| Domain | In short |
|---|---|
| SES sessions | create/rename/status/move, close & reopen, sleep & wake, keep awake, restart, conversation resume, resume on launch (D50), prompt queue (D47), presets (D49), fork (D52), conversation search (D52) |
| TRM terminal | xterm WebGL + node-pty ConPTY, copy/paste/right-click rules (D21), image paste and file drop, links (D12), split panes, grid with Exit grid (D32/D55), zoom/scrollback, search (D41) |
| NAV sidebar | groups, workspaces by folder (D20), group-by status, search/filter, sort (D61), keyboard, bulk select + actions incl. broadcast prompt (D42/D48) |
| ATT attention | Stop/Notification hooks only (D11), Orca bell + Needs you (D22), sounds (D05), desktop notices, repeat while unread (D44), on-screen = every window (D40) |
| HUB / TAB / PAL | Hub board by status (D05/D24), tabs per folder, only running and awake sessions (D18/D55), working spinner, command palette (D28) |
| NTS / TML | notes + checklist (D06/D17), timeline + "While you were away" (D29/D38), cost over time (D51) |
| USE quota | plan bars for Claude + OpenCode Go (D37), manual refresh (D07), quota guard, hands-off autopilot (D30/D33/D39) |
| AUT sleep | auto status (D08), idle sleep (D14), sleep everything when idle (D26) |
| AGT agents | Claude (always yolo, D10), OpenCode (D15, plugin via `OPENCODE_CONFIG_CONTENT`, `--standalone`), Shell (Code mode), worker tabs (D19) |
| COD Code mode | repos, worktrees, Shell, Changes + diff, annotations (D34), previews (D35), pop-out window, opt-in trust answer (D43) |
| JRV Jarvis | right-side panel (Ctrl+Shift+J, tab-bar button), 65 MCP tools that reach the whole app incl. the screen (D55), confirm for destructive tools, schedules, undo, Claude or OpenCode engine, voice (talk + read aloud) |
| WIN / SET / SEC | tray, close-to-tray, login item, logs; validated store/settings; validated IPC, token-checked local servers, process-tree kill |

---

## 3. Known gaps and limits (current)

| Area | Gap |
|---|---|
| Release | Unsigned installer, version 0.0.6 (bumped by hand on request); no auto-update (D25 deferred). |
| Look | Dark theme only. |
| Human checks | Sound and taskbar flash are verified through code paths and fakes, not by ear/eye; real-mouse drag-and-drop is covered by pure logic, not simulated drag events. |
| Quota | `USAGE_LIMIT_PATTERNS` may need new wording (the first real match per process is logged). The OpenCode Go usage path is tested with fakes only (no Go connection on the dev machine). |
| Code mode | Commit, push, PR, merge and delete-from-disk exist (D60); no fetch/pull button ("behind" is as of the last fetch), no PR without a GitHub/GitLab/Bitbucket remote, gh only for GitHub. Claude still asks "trust this folder" once per new worktree unless Settings > Code opts in (D43). |
| OpenCode | Worker tabs are read-only; `opencode --pure` processes are invisible to them. |
| Grid | No visual-regression screenshot state yet (`e2e:grid` covers behaviour). |
| Jarvis | **Voice:** recognition languages are the ones Windows has installed (en-US, zh-CN on the dev PC). **Reading aloud and `get_last_answer`:** Claude engine only; an OpenCode Jarvis falls back to the screen. **Schedules:** need the app running; a run more than 15 minutes late is skipped. **Undo:** in memory (last 20, this run), removals are final. **Switching engine:** starts a new Jarvis conversation. |
| Tests | Real-Claude suites can time out late in a long batch; rerun alone (LESSONS). The clipboard can be unavailable in this environment: paste suites print SKIP for that probe. |

---

## 4. Working on it

- **Process and checklists:** `docs/IMPLEMENTATION.md`.
- **Commands:**
  - Unit tests: `npx vitest run`.
  - Typechecks: `npx tsc --noEmit -p tsconfig.node.json` and `-p tsconfig.web.json`.
  - Build: `npx electron-vite build`, then e2e with `node scripts/e2e-<name>.cjs`.
  - Run the app: `npm run preview`.
  - Installer: `npm run dist`, only when asked.
- **Relaunching the user's app after a change:** stop the running `electron.exe .` tree (`taskkill /T /F`), then start `npm run preview` again.
- **Test isolation:** e2e runs use a temp user-data dir and their own CDP port. A real-Claude suite uses the user's plan quota; prefer OpenCode free models when the agent does not matter.
- **Rollback point:** tag `baseline-2026-10-17`. Every feature is its own commit.

---

## 5. History (newest first)

| Date | Round | Decisions | Key commits |
|---|---|---|---|
| 2026-11-08 | Code mode commit, push, PR (gh or browser), merge into base, delete a worktree from disk; Jarvis git tools | D60 | `c166179` |
| 2026-11-08 | Sort sessions: Manual, Needs attention, Last active, Newest, Name A–Z (sidebar, Code tree, Hub) | D61 | `aa774be` |
| 2026-11-04 | Terminal right-click menu like Orca (Copy, Select All, Paste, Find, Fork, Split, Close Pane, Copy Folder Path, Clear Screen); Settings choice for quick copy/paste | D59 | `c031425` |
| 2026-11-04 | Jarvis controls every part of the app: sounds, sidebar list, Code tree, file on screen, terminal search, tabs, files into a session, links, the window, its own restart | D58 | `13b2dbf` |
| 2026-11-03 | Code mode worktrees like Orca: auto-suffix, existing branch, repo folder; non-git folders skipped | D56–D57 | `cf4c13c` |
| 2026-11-03 | Exit grid, tab bar only for running and awake sessions, Jarvis controls the whole app (30 new tools, screen commands) | D55 | `82c7a64`, `7a76138` |
| 2026-11-01 | Jarvis round 2: wait/answer/usage/away tools, Code tools, schedules, undo, OpenCode engine, voice, packaged + spaces checks; fix: idle-reminder blocked the prompt queue | D54 | `028114e` … `84bf042`, fix `b75d256` |
| 2026-11-01 | Jarvis: MCP tool server, tools, confirm, panel over every session in both modes; fix: trust answer as two keys | D53 | `a8eb8e8`, `02d790d` |
| 2026-10-31 | Prompt queue, broadcast, presets, resume on launch, cost over time, fork + search; installer for hands-on testing | D46–D52 | `f891ae3` … `8e7c1ed` |
| 2026-10-31 | Code review round 3 (no behaviour change except rename) | D45 | `1448209` … `7de72f7` |
| 2026-10-27 | Opt-in trust answer, exit codes, reminder escalation | D43–D44 | `49aa4f5`, `a597099` |
| 2026-10-26 | Grid, terminal comfort, tab spinner, OpenCode parity, Go quota bars, terminal search, bulk actions | D32, D36–D42 | `8b719f5` … `ca573a0` |
| 2026-10-25 | OpenCode v2 plugins + worker handshake, hands-off autopilot, annotations, previews, store durability | D33–D35 | `0a70afd` … `bb41700` |
| 2026-10-22 | Sleep everything, palette, timeline + away, quota autopilot, Code mode; installer 0.0.3 | D26–D31 | `854bcd9` … `be9be09` |
| 2026-10-19 | Attention bell, last folder, Hub busiest column | D22–D24 | `b6fc444` … `d141c3a` |
| 2026-10-17 | Links, image paste, sleep, OpenCode, Remote Control, worker tabs, workspaces; baseline tag | D10–D21 | `baseline-2026-10-17`, `b9b4754` … `7993292` |
| 2026-10-12/13 | v1: sessions, statuses, groups, attention, Orca UI, close/resume, Hub, sounds, usage, notes, auto status, quota guard, split panes, tray, first installer | D01–D09 | before the git baseline |

Per-feature implementation notes from these rounds are folded into `FEATURES.md` (rules, code paths, tests) and the commit messages. `git show <commit>` gives the full detail.
