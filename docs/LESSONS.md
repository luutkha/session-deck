# SessionDeck lessons

Things that cost time once. Read before touching the area. Add an entry when a bug's cause was not obvious.

## Claude Code inside the app
- **Fullscreen UI grabs the mouse.** In `tui: fullscreen`, Claude turns on mouse reporting (`?1000h ?1002h ?1003h ?1006h`) and pastes a reported right-click by itself. Anything SessionDeck does with a mouse button must stop xterm from reporting it (see D21, `isRightButton`). Claude may switch fullscreen on by itself, so assume it can be on.
- **Test sessions use the user's real `~/.claude`.** Slash commands persist (`/tui fullscreen` wrote settings.json). For a per-session setting pass `claudeArgs: ['--settings', <temp json file>]`; inline JSON is rejected by the arg validator.
- **Trust prompt per git root.** A folder Claude has not seen as a git root asks "Yes, I trust this folder / No, exit" with **No** preselected. E2E scripts press Down before Enter (`scripts/e2e.cjs`).
- **`NO_COLOR` from the launcher** made sessions monochrome; the pty env strips it.
- **A session never prompted has no conversation.** Resuming it fails; it gets a fresh Claude id instead (`shouldRotateSessionId`).
- `CLAUDE_CODE_*` / `CLAUDECODE` env from a parent Claude must not leak into sessions; strip them when launching the app from a Claude terminal.

- **Attention used to be dropped for the session on screen.** Fine for pings, wrong for the bell: users watch a session ask its question, switch away, and expect the bell to still be there. Focus now only decides pinging (`AttentionService`, `wireAttentionNotices`), never whether attention is recorded. In CDP e2e runs the window counts as focused, so on-screen behaviour is testable.

## OpenCode
- **Go plan cap is plan-wide** and in `--format json` mode OpenCode goes silent on it; only stderr logs show it.
- `opencode/<model>` (Zen) bills real money. Free: `opencode/big-pickle` and the `*-free` models.
- `OPENCODE_CONFIG_CONTENT` merges with a project's own `opencode.json` plugins. `opencode run --pure` disables plugins, so such workers are invisible to worker tabs.
- Quoting `--dir "…"` through `cmd /s /c` breaks OpenCode; use the process cwd.

## Electron / xterm / Windows
- `ready-to-show` did not fire with the hidden title bar; the window is shown explicitly.
- Radix `Slot` forwards `onContextMenu` into child props; components must accept and spread it.
- Typing into an exited session used to throw in main and freeze the app behind a native dialog; main logs errors to `<userData>/main-errors.log` instead.
- A hard kill loses localStorage writes Chromium has not committed; e2e restarts use `window.api.quitApp()`.
- electron-builder needs the winCodeSign cache seeded without symlinks (no Developer Mode).
- The background job cannot send real OS mouse input (`SetCursorPos`/`mouse_event` reach nothing); use CDP `Input.dispatchMouseEvent`.

## Tests and tooling
- Vitest cannot import files under the OS temp dir; create test dirs under `process.cwd()`. Turn fake timers on only after the dynamic import.
- Plugin events posted with parallel `fetch` arrive out of order; the worker plugin serializes posts.
- In this shell, heredocs/`sed` with backslashes or odd quotes get mangled; write files with the Write tool or a Python script file.
- A check that only proves "no crash" is not a test of the bug: the first e2e-paste passed while the real bug was present, because the bug needed fullscreen mode.
