# SessionDeck lessons

Things that cost time once. Read before touching the area. Add an entry when a bug's cause was not obvious.

## Claude Code inside the app
- **Fullscreen UI grabs the mouse.** In `tui: fullscreen`, Claude turns on mouse reporting (`?1000h ?1002h ?1003h ?1006h`) and pastes a reported right-click by itself. Anything SessionDeck does with a mouse button must stop xterm from reporting it (see D21, `isRightButton`). Claude may switch fullscreen on by itself, so assume it can be on.
- **Test sessions use the user's real `~/.claude`.** Slash commands persist (`/tui fullscreen` wrote settings.json). For a per-session setting pass `claudeArgs: ['--settings', <temp json file>]`; inline JSON is rejected by the arg validator.
- **Trust prompt per git root.** A folder Claude has not seen as a git root asks "Yes, I trust this folder / No, exit" with **No** preselected. E2E scripts press Down before Enter (`scripts/e2e.cjs`).
- **Never send a blind Enter to a starting Claude TUI.** In `e2e-handsfree.cjs`, "dismiss anything else with its default option" pressed Enter while the trust dialog had not rendered yet; the CR was buffered and confirmed "No, exit" — Claude quit, every later write went nowhere, and the replay buffer froze on the dialog forever. Only press keys on a DETECTED dialog; wait otherwise. (New Claude versions also show a second "Bypass Permissions" dialog — detect it the same way.)
- **Claude TUI replay text is not reliably spaced.** Redraws overlap in the pty replay, and a dialog may appear in the tail only as a space-collapsed copy (`Quicksafetycheck:...No,exit`). `strip()` alone is not enough for detection — collapse whitespace and match on the collapsed text (`flat.includes('No,exit')`), and check the footer first (`bypasspermissionson`) so dismissed-dialog history in the buffer is not mistaken for a live dialog.
- **`NO_COLOR` from the launcher** made sessions monochrome; the pty env strips it.
- **A session never prompted has no conversation.** Resuming it fails; it gets a fresh Claude id instead (`shouldRotateSessionId`).
- `CLAUDE_CODE_*` / `CLAUDECODE` env from a parent Claude must not leak into sessions; strip them when launching the app from a Claude terminal.

- **Attention used to be dropped for the session on screen.** Fine for pings, wrong for the bell: users watch a session ask its question, switch away, and expect the bell to still be there. Focus now only decides pinging (`AttentionService`, `wireAttentionNotices`), never whether attention is recorded. In CDP e2e runs the window counts as focused, so on-screen behaviour is testable.

## OpenCode
- **Go plan cap is plan-wide** and in `--format json` mode OpenCode goes silent on it; only stderr logs show it.
- `opencode/<model>` (Zen) bills real money. Free: `opencode/big-pickle` and the `*-free` models.
- `OPENCODE_CONFIG_CONTENT` merges with a project's own `opencode.json` plugins. `opencode run --pure` disables plugins, so such workers are invisible to worker tabs.
- **The injected config is inherited by child processes too.** When a session gets several plugin entries, the parent opencode AND every opencode it spawns load all of them. Identify the parent by the first process that reports (`proc` = `String(process.pid)`; the worker plugin posts `hello` at initialization and loads first), and filter child session-plugin events by proc before attention/status/usage. Reset the owner when the pty starts, not on exit (an exit event can arrive after the new process already registered). See D19 and `WorkerHub.ownerProcs`.
- Quoting `--dir "…"` through `cmd /s /c` breaks OpenCode; use the process cwd.
- **The TUI CLI has no `--model` flag.** `opencode --standalone --model x/y` prints help and exits instantly ("ShowHelp: Help requested" — and the pty "TUI started" checks can pass vacuously against the help text). The model travels in the OPENCODE_CONFIG_CONTENT value as the top-level `model: "provider/model"` key; `-s`/`--session` IS a valid global flag.
- **A TUI that attaches to the shared background service never sees per-process plugin env.** The service reads its own user-global config; only `--standalone` (private server) honors the injected `OPENCODE_CONFIG_CONTENT`. Cold-started children inherit the caller's env; a warm service does not. `opencode service stop` is best effort: other opencode clients (an agent session, for instance) respawn the service instantly.

## Electron / xterm / Windows
- `ready-to-show` did not fire with the hidden title bar; the window is shown explicitly.
- Radix `Slot` forwards `onContextMenu` into child props; components must accept and spread it.
- Typing into an exited session used to throw in main and freeze the app behind a native dialog; main logs errors to `<userData>/main-errors.log` instead.
- A hard kill loses localStorage writes Chromium has not committed; e2e restarts use `window.api.quitApp()`.
- electron-builder needs the winCodeSign cache seeded without symlinks (no Developer Mode).
- The background job cannot send real OS mouse input (`SetCursorPos`/`mouse_event` reach nothing); use CDP `Input.dispatchMouseEvent`.

## Storage
- **A `readFile` error is not corruption.** Treating every error as bad JSON renamed the store and returned an empty one, which the next debounced save wrote over the real file. Only `JSON.parse` / shape failures may be quarantined; EPERM/EBUSY/EIO must stop startup with the file untouched. Keep a `.bak` from the last successful load.
- **A fixed `.tmp` name plus async saves can race.** A timer write and a `flush()` could write the same temp file at once. Serialize saves and use a unique temp name per write.
- **Windows can throw EPERM on the atomic rename when saves overlap or an indexer/AV holds the target for a moment.** `saveStoreFile` now serializes all saves through one in-process chain and retries the rename on EPERM/EBUSY/EACCES (3 tries); the parallel full suite hit this once in `persistence.test.ts` and it is a real transient, not just test noise.

## Tests and tooling
- Vitest cannot import files under the OS temp dir; create test dirs under `process.cwd()`. Turn fake timers on only after the dynamic import.
- **ptyWrite control chars through CDP evaluates.** Data goes `node source → JSON.stringify → browser eval`: pass REAL control characters in the Node source (`'\x1b[B'`, JSON.stringify re-escapes them as `\u001b`) — a doubly-escaped `'\x1b[B'` reaches the pty as the literal text `\x1b[B`, which the TUI does not treat as a key. The reference scripts embed the escape in the evaluate template instead; both work, mixing them breaks.
- A test that "skips" with an early `return` is a false pass. Use `context.skip()` so the report shows it. Likewise, a helper that reads `process.env` by default makes tests depend on the shell that runs them; pass the value explicitly.
- Plugin events posted with parallel `fetch` arrive out of order; the worker plugin serializes posts.
- In this shell, heredocs/`sed` with backslashes or odd quotes get mangled; write files with the Write tool or a Python script file.
- A check that only proves "no crash" is not a test of the bug: the first e2e-paste passed while the real bug was present, because the bug needed fullscreen mode.

- **2026-10-22 · Palette e2e "failed" twice; the app was right.** The palette (Radix dialog) fades out, so "closed" must be awaited, not read right after Enter. Closing also returns focus to the element focused before (usually the terminal), where plain Ctrl+K is deliberately ignored: blurring right after Enter loses that race. Use Ctrl+Shift+K in tests after an action.
- **2026-10-22 · `deepseek-v4-flash` returned "Unexpected server error" for every call** (even a one-word probe), so the batch fell back to `claude-haiku-5-5`. Probe with a one-word `oc-run` before blaming a brief.
- **2026-10-22 · A quota reset is invisible while everything sleeps.** The quota guard only evaluates when a statusLine arrives, and a sleeping session sends none. The autopilot therefore runs its own timer at resets_at.
- **2026-10-22 · Resumed Claude sessions redraw old screen text.** A usage-limit message from an earlier turn can reappear after `--resume`; screen signals that start actions must be armed by a prompt submitted in the running process.
- **2026-10-22 · The sidebar is an `<aside>` too.** `document.querySelector('aside')` in an e2e found the sidebar, not the notes panel; select by aria-label or data attributes.
- **2026-10-22 · E2E with fake plan usage needs sessions that report no usage.** Real Claude sessions send real rate limits through the statusLine and overwrite fake numbers; idle OpenCode sessions do not.
- **2026-10-22 · A plan cap can hit in the middle of a wave.** The Go cap hit after ~$1.5 in one day while two renderer workers were half done; `oc-batch` failed over to deepseek, which was capped too. Files on disk were usable; the orchestrator finished the rest. Check `opencode stats --days 1` before a second wave on a busy day.
- **2026-10-22 · Data that changes outside SessionDeck needs a pull.** Worktree change counts only refreshed on a Claude Stop hook; Shell sessions and editors have no hook, so the counts stayed empty. Main now broadcasts every changed recompute and the sidebar polls slowly.
