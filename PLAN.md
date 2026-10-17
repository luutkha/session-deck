# SessionDeck: PLAN

Narrow desktop app to run and manage many Claude Code sessions. Windows first, cross-platform later.

## Requirements (user's six)
1. Create a Claude Code session in one action (pick folder, optional name, group) -> spawns `claude` in a PTY.
2. Rename a session inline (double-click / F2).
3. Monitor by user-assigned status: user-defined status list (name + color), user sets it per session; sidebar filter/badge by status.
4. Sound (+ taskbar flash + badge) when a session needs attention (permission prompt, question, finished turn).
5. Groups: create, rename, delete, reorder; move a session between groups (drag-drop + context menu); collapse/expand.
6. Terminal view as close to native as possible: xterm.js + WebGL renderer, node-pty (ConPTY), proper resize, unicode11, 10k scrollback, copy/paste, clickable links, font ligature-free monospace (Cascadia Code), no input lag, sessions keep running when not visible (one xterm per session, hidden not destroyed).

Out of scope v1: remote/SSH, git worktrees, mobile, diff view, auto status detection beyond attention.

## Stack
Electron + electron-vite + React + TypeScript (strict). node-pty, @xterm/xterm + addons (fit, webgl, unicode11, web-links, serialize). Vitest. No UI kit; plain CSS with CSS variables, dark theme. electron-builder later.

## Architecture
main (Node):
- `store/`      SessionStore: sessions, groups, statuses; JSON file in app.getPath('userData'); atomic write; immutable updates; pure reducers + thin IO wrapper.
- `pty/`        PtyManager: spawn/kill/resize/write per session; ring buffer (last ~1MB) for replay on reattach; emits data/exit.
- `attention/`  HookServer (127.0.0.1, random port, per-launch token) receives Claude Code hook events; `claudeSettings.ts` builds a `--settings` JSON with Notification + Stop hooks that POST to the server (does NOT touch user's global settings); IdleDetector fallback (output quiet >N s after activity); Notifier (sound, flashFrame, badge); attention flag cleared when the user focuses the session or types.
- `ipc.ts`      registers channels from shared contract; preload exposes typed `window.api`.
renderer (React):
- `Sidebar/`    groups tree, session rows (status dot, attention bell, name), inline rename, drag-drop, context menu, status picker, filter by status.
- `Terminal/`   TerminalHost keeps one xterm per session mounted, shows active one; WebGL addon with context-loss fallback; ResizeObserver -> fit -> pty.resize.
- `App.tsx`, `state/` (zustand-free: useReducer + context), theme CSS.
shared: `src/shared/types.ts`, `src/shared/ipc.ts` (channel names + payload types). THE CONTRACT. Workers must not change it; if wrong, report in OPEN QUESTIONS.

## Hook protocol
Env injected into each PTY: SESSIONDECK_SESSION_ID, SESSIONDECK_PORT, SESSIONDECK_TOKEN. `claude --settings '<json>'` hooks (Notification, Stop) run a command that POSTs `{event, sessionId}` to `http://127.0.0.1:$PORT/hook` with header `x-token`. Server validates token + known sessionId, rejects bodies >4KB.

## Milestones / task ownership (disjoint files)
M0 scaffold + contract (orchestrator + 1 worker)
M1 parallel: A store | B pty | C attention | D terminal view | E sidebar
M2 integration (wire IPC, App, persistence restore, packaging smoke) - 1 strong worker
M3 review (different model family) + fix pass + manual test checklist
Each module: tests first, 80%+ coverage on pure logic, immutable updates, files <400 lines.
