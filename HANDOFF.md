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

- **D67 many sessions, round 3**: renderer applies runtime events in 100 ms batches and memoizes tabs (40 sessions, 62 events/s: 95% -> 62% busy, 32 -> 124 fps); git runs at most 4 processes at once and fresh reads wait for a post-request run; bench has agent-event/profile modes. **D68:** Auto effects switch to Reduced while 10+ sessions are busy (back at 6): 15 events/s 57% -> 39% busy. Not pushed.
- **D66 stuck terminal modes**: right-click > Reset Terminal Modes (leaves a stuck alternate screen / mouse reporting; erases nothing). Cause of the VM report (no scrollback or selection in new/reopened Claude sessions) is a hypothesis, not confirmed there. `e2e-resetmodes` 6/6. Not pushed.
- **D65 many sessions, round 2**: store broadcasts coalesced (40 ms) + structural sharing in the renderer, and a cap of 12 live terminals (least recently shown hidden pane is disposed, rebuilt from the replay buffer). 40 sessions: DOM nodes 4,943 -> 2,860, Electron CPU 63-89% -> 50%; `e2e-livepanes` 7/7; 3,635 unit tests. Not pushed.
- D87 (2026-11-25): performance round 4 (review by four read-only OpenCode sessions, then four waves): minified renderer 3.15 -> 1.62 MB, package `app.asar` 91 -> 14 MB, pty buffers freed, one git status per Changes scan + poll-only 4 s cache (`allowCached`), memoized rows, chunked diff mount, bounded transcript caches. CPU benchmarks show only small gains (noise +-10 points); not done and why: DECISIONS D87. Benchmarks: `scripts/bench-sessions.cjs`, `scripts/bench-startup.cjs`.
- D86 (2026-11-25): discard file/hunk, viewed marks + badges (sidebar row, tab), session tags, Settings > Diagnostics, detached Changes windows restored at start, palette actions, Jarvis tags/changes tools. e2e `e2e:changes-actions`. Unbuilt ideas: docs/BACKLOG.md. Flake hunt fixed 1 app bug (statusLine trailing update) and ~35 e2e scripts (cleanup, counts, window detection). Jarvis has 94 tools.
- D85 (2026-11-24): Changes panel review helpers: next/previous file (Alt+Down/Up), flat/tree toggle, inline/side-by-side diff (detached window); `e2e:changes-files` (52 checks) covers odd file kinds + Claude/OpenCode/Cursor sessions. Not built: open in editor at the line (done: D89). e2e-grid flake hardened (flushStorageData on quit), root cause unproven.
- D84 (2026-11-24): detached Changes window gets a **Dock back** button (shows the Changes tab in the app, closes the window) and remembers its position/size per worktree (`changes-windows.json`); e2e `e2e:changes-detach` now 63 checks.
- D83 (2026-11-24): the Changes panel detaches into its own window (header button; one per worktree, max 8; list left + diff right; polling, no annotations); e2e `e2e:changes-detach` (46 checks).
- D82 (2026-11-24): session tab OR Code-sidebar session right-click > **View changes** (worktree sessions): opens the side panel on Changes (file list + click a file for its diff), widens it once to 520 px; e2e `e2e:tab-changes` (42 checks).
- D81 (2026-11-24): Cursor CLI is a third agent (`cursor`): launch `cursor-agent --force --trust [--model m] [--resume chatId]`, Jarvis controls it like the other agents (79-check e2e, `set_session_model` works, empty = default model), hooks bridge into `~/.cursor/hooks.json`, last reply for Jarvis/plans from the `afterAgentResponse` hook (memory only), UI badge `CU`. Unverified: hook env inheritance in the real logged-in CLI; no fork, search or quota yet.
- **D80 Jarvis watch mode + task plans** (both opt-in, OFF by default, Settings > Agents > Jarvis): a timer tells Jarvis when a session waits 3+ min or looks stuck 20+ min; `plan_create/plan_status/plan_cancel` run a goal as steps across sessions. Known limits: plans live in memory (a restart forgets them); a step on a SHELL session is judged done 20 s after its prompt with answer "(no answer was found)" (no conversation to read); the e2e uses OpenCode (paid flash model) for the real-agent paths, a plan step on a real CLAUDE session was not run (same code path, different agent); a prompt that was only queued behind a running turn can make a step look finished from the earlier turn.
- **D79 Jarvis + OpenCode**: `fleet_digest`; OpenCode answer text/search/panel reply via `session export`; id recovery (per-project list); plugin-health badge; usage-limit detection; opt-in "ask" permissions; `set_session_model`; copy-style fork. Not built: the `opencode serve` API path. Known limits: the OpenCode export of a turn that failed holds an error and no text (free-quota errors), so the answer falls back to the screen; an OpenCode copy-fork whose SessionDeck session cannot be created or started has its imported conversation deleted again (best effort, `deleteOrphanCopy`); id recovery adopts only a single candidate (several = a notice, nothing adopted).
- **D78 leftovers**: detached viewer windows capped at 8 (oldest is focused). Excel error cells stay blank (the library drops them); palette Preview file is hidden without a session, by design.
- **D77 bug hunt** (user: "double check everything, make sure all new feature have no bug"): four read-only OpenCode reviews + a real-app stress test (`e2e-fileview-edge` 49/49). Fixed: an out-of-memory crash from tiny hostile xlsx/docx files (worker + zip guard), find offset after a dotted I, link underline offsets for wide characters, PDF zoom direction, side panel width, misleading "no longer exists", dead-session previews, `preview_file` on a missing file, a CSV delimiter tie, Settings row stuck on Checking, damaged image label, error wording. Left as is (judged by design or cosmetic): negative link cache 5 s, UTF-16 without BOM that is all CJK, Excel error cells (#DIV/0!) show blank, DPR change on a PDF page, no cap on detached viewer windows, palette Preview file with no session does nothing. Worker not tested in a PACKAGED build (falls back to in-process parsing if it cannot start).
- **D76 right-click a path** (user request): the terminal menu gets link rows on top (Open in Side Panel, Open in Default App, Show in Explorer, Copy Path; folders and URLs have their own); `e2e-fileview-menu` 13/13 in the real app, `e2e-termmenu` 16/16 unchanged, 4,104 unit tests.
- **D75 PDF + every file type checked** (user feedback: a PDF click opened the browser). PDFs render in the viewer (pdf.js legacy build); SVG/ICO/AVIF, .xlsm/.docm/.dotx, CSV delimiter detection (`;` `|` tab), Markdown relative images and links added after testing each type with realistic files; `e2e-fileview-types` 57/57, `e2e-fileview` 19/19, `e2e-fileview2` 24/24, `e2e-fileview3` 8/8 in the real app, 4,038 unit tests. Not done: legacy `.xls`/`.doc` (the user chose to leave them: they open in the default app), text selection/find inside a PDF. Follow-up the same day (user: a PDF click "open directly the file"): unquoted paths with spaces / accents (e.g. `Báo cáo tháng 10.pdf`, `docs/Báo cáo.md`) were never links; fixed, `e2e-fileview-spaces` 9/9. Big PDFs: the 30 MB cap is gone, a PDF up to 1 GB is read by byte range (`e2e-fileview-bigpdf` 11/11); a refused file keeps its Open / Reveal / Copy buttons.
- **D74 viewer enhancements + OpenCode probe** (live reload, header buttons, UTF-16 text, find + zoom, table sort/paging/widths, preview from a drop / the palette / a Changes row / Jarvis `preview_file`, OpenCode version and Re-check in Settings > Agents; `e2e-fileview` 19/19, `e2e-fileview2` 24/24, `e2e-fileview3` 8/8 (the Changes-row eye button) in the real app). Not done: per-session preview with history (the preview still belongs to the window, not to a session).
- **D73 file viewer in the side panel**: a plain click on a path in a terminal opens a **Preview** tab (md, text, image, csv, xlsx, docx), the panel resizes by dragging its left edge, Detach opens the file in its own window; Ctrl+click opens the default app. New deps `mammoth`, `read-excel-file` (and `jszip` for tests). `e2e-fileview` 19/19 in the real app. Not done: paths outside terminals, .xls/.pdf. Built by OpenCode (the free model hit its quota, `-flash` fallback). Also D72 (OpenCode launch works on any OpenCode version: `--standalone` only when `opencode --help` lists it).
- **D63 no-GPU support**: software rendering is detected (feature status + window WebGL probe), remembered, and the next start runs with the GPU process off; Auto renderer = DOM without a GPU; reduced effects; Settings > Terminal > Graphics. Emulated no-GPU (20 sessions): CPU 1,263% -> 65%, 28 -> 146 fps; `e2e-gpumode` 14/14; 3,597 unit tests. Not tried on a real GPU-less VM. **D64:** the first run on a GPU-less PC restarts itself once with the GPU off (`e2e-gpumode` 18/18). Not pushed.
- **D62 performance round (many sessions)**: pty output batching + O(1) ring buffer, WebGL only for visible panes, hidden panes queue output, memoized session rows, shared clock, store save max wait, throttled worker snapshots (bench: 20 sessions, pty messages 680/s -> 183/s, renderer busy 35% -> 13%, DOM nodes 130k -> 2.5k; `e2e-hiddenpane` 5/5; 3,523 unit tests). Not pushed.
- **D61 sort sessions** (Sort button in the sidebar header, Ops and Code: Manual, Needs attention, Last active, Newest, Name A–Z; Hub follows; saved `lastActiveAt`; `e2e-sort` 20/20, `e2e-jarvis-app` 23/23, `e2e-bulk` 18/18, `e2e-workspaces` 9/9, `e2e-codemode` 34/34, `e2e-hub` 12/12, `e2e-hubscroll` 7/7, 3,393 unit tests). Not pushed.
- **D60 Code mode commit / push / PR / merge / delete from disk** (Changes panel: ticks per uncommitted file, commit box, branch line with Push / Create PR / Merge; Remove worktree… can delete folder and branch; Jarvis 80 tools; `e2e-code-git` 29/29 three runs in a row, `e2e-jarvis` 60/60, `e2e-jarvis-control` 33/33, `e2e-jarvis-app` 23/23, `e2e-codemode` 34/34, `e2e-worktree-sources` 10/10, `e2e-annotate` 13/13, 3,447 unit tests). Not pushed. Fixed on the way: background `git status` no longer takes `index.lock` (`GIT_OPTIONAL_LOCKS=0`); an empty folder left by a half-done `git worktree remove` is cleaned up.
- **Shipped through D59** (terminal right-click menu like Orca, with a Settings choice for the old quick copy/paste, `c031425`; `e2e-termmenu` 16/16, `e2e-paste` 4/4, `e2e-imagepaste` 3/3, `e2e-termview` 15/15, `e2e-g1` 14/14, `e2e-grid` 15/15, 3,366 unit tests). Not pushed.
- **D58** (Jarvis controls every part of the app: 10 more tools, 75 in all; `e2e-jarvis-app` 21/21, `e2e-jarvis-control` 33/33, `e2e-jarvis` 60/60, 3,358 unit tests). Not pushed.
- **D57** (D56: Code mode stays git-only; D57: worktrees like Orca — auto-suffix, existing branch, repo folder; `e2e-worktree-sources` 10/10, 3,343 unit tests).
- **D55** (exit grid, tab bar for running and awake sessions only, Jarvis controls the whole app: 65 tools). Pushed.
- **D55 verification (dev build):** 3,329 unit tests (203 files), both typechecks clean, `e2e-jarvis-control` 33/33 (new), `e2e-jarvis` 60/60, `e2e-grid` 15/15, `e2e-foldertabs` 6/6, `e2e-annotate` 13/13, `e2e-codemode` 34/34. The installer was not rebuilt (still `84bf042`).
- **Move to Code (D88):** right-click entry on Ops cards too (`e2e:move-to-code` 25/25); palette "Move to Code mode: repo / worktree" moves an Ops session into a worktree (same card, fresh conversation; `e2e:move-to-code` 22/22; also "new worktree…" in the palette; Jarvis tool `move_session_to_code` with undo, 95 tools). Not in an installer yet (0.0.9 predates it).
- **Installer:** `release/SessionDeck-Setup-0.0.9.exe` (86.6 MB), built 2026-11-26 from the D87 performance round (minified renderer, slimmer package, shared git scans, memoized rows, chunked diff); version bumped from 0.0.8 on the user's request ("it is ver 9"). Unsigned (SmartScreen warns: "More info" -> "Run anyway"). Installing over an existing copy replaces it and keeps the user's data. `e2e:packaged` 15/15. Older: 0.0.8 (D62-D64).
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
| Code mode | Commit, push, PR, merge and delete-from-disk exist (D60); Pull button (fetch + fast-forward only; "behind" is as of the last fetch otherwise), no PR without a GitHub/GitLab/Bitbucket remote, gh only for GitHub. Claude still asks "trust this folder" once per new worktree unless Settings > Code opts in (D43). |
| OpenCode | Worker tabs are read-only; `opencode --pure` processes are invisible to them. |
| Grid | No visual-regression screenshot state yet (`e2e:grid` covers behaviour). |
| Jarvis | **Voice:** recognition languages are the ones Windows has installed (en-US, zh-CN on the dev PC). **Reading aloud and `get_last_answer`:** both engines since D79 (OpenCode reads `opencode session export`; falls back to the screen when the export has no text, e.g. the free model's quota error). **Schedules:** need the app running; a run more than 15 minutes late is skipped. **Undo:** in memory (last 20, this run), removals are final. **Switching engine:** starts a new Jarvis conversation (switching only the OpenCode model keeps it). |
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
| 2026-11-20 | Viewer enhancements (live reload, find, zoom, tables, more ways to open) + OpenCode version in Settings | D74 | this commit |
| 2026-11-20 | File viewer in the side panel: click a terminal path, Preview tab (md, image, csv, xlsx, docx), resizable, detachable; OpenCode `--standalone` feature-detected | D72, D73 | this commit |
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
