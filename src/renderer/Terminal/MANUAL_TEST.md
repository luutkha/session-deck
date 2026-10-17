# Terminal view — manual test checklist

Run the app (`npm run dev`) with at least two sessions (A and B) in folders where
you can run shell commands. Tick each item only when it behaves exactly as
described.

## Rendering & performance

- [ ] **Rapid output stays smooth.** In session A, `cat` a very large file
  (e.g. `type` a multi-MB log, or `Get-Content` in a loop). Output streams
  without visible lag, tearing, or the UI freezing; scrolling during the burst
  is responsive.
- [ ] **Crisp text.** Glyphs are sharp (WebGL renderer), font is Cascadia
  Code/Mono at 14px, block cursor blinks.
- [ ] **No scroll animation.** During the burst, output does not "rubber-band";
  smooth scrolling is off.

## Sizing

- [ ] **Resize window.** Drag the window smaller/larger: the terminal reflows
  to the new cols/rows (run `echo $env:COLUMNS x $env:LINES` or resize while a
  full-screen app like `htop`/`less` is open — it redraws correctly).
- [ ] **Resize is reported to the pty.** After resizing, a full-screen TUI
  (e.g. `vim`, `less`) fills exactly the visible area — no dead bands or
  wrapped prompts.
- [ ] **Hidden pane never fits to zero.** Switch to B, resize the window,
  switch back to A: A is correctly sized for the new window (no 1-column or
  collapsed layout).

## Session switching & scrollback

- [ ] **Scrollback survives switching.** In A, produce output, scroll up,
  switch to B, back to A: scroll position and history are intact.
- [ ] **Scrollback is 10k lines.** Produce >10k lines (`1..20000 | %{ $_ }`),
  scroll to the very top: the earliest lines were dropped, the newest ~10k
  remain.
- [ ] **Background sessions keep running.** Start a long-running command in A,
  switch to B, wait, switch back: A's output continued while hidden and no
  chunks are missing or duplicated (e.g. numbered output has no gaps/repeats).

## Reattach (reload)

- [ ] **Reload the window** (Ctrl+R in dev) with output already in A: the
  terminal repopulates from the replay buffer, and live output afterwards
  continues exactly once (no duplicated tail).

## Input, copy, paste

- [ ] **Typing** goes to the pty immediately (no lag); arrows/Home/End work in
  readline-style prompts.
- [ ] **Ctrl+C with a selection copies** and clears the selection (does NOT
  send ^C).
- [ ] **Ctrl+C without a selection sends SIGINT** (interrupts the running
  command).
- [ ] **Ctrl+Shift+C copies** the selection.
- [ ] **Ctrl+V and Ctrl+Shift+V paste.** Paste a multi-line block (3+ lines
  with indentation) into an editor (`vim`, `nano`, or `python` REPL):
  lines arrive complete, indentation preserved, no bracketed-paste mangling.
- [ ] **Right-click copies when there is a selection, pastes otherwise.**
- [ ] **Ctrl+Backspace** deletes the previous word in the shell.
- [ ] **Shift+Enter** reaches the app unchanged (no copy/paste interference).
- [ ] **Ctrl+N, F2, Ctrl+Tab still trigger the app shortcuts** while the
  terminal is focused (new session / rename / next session).

## Unicode

- [ ] **Emoji width.** Print emoji (e.g. `echo "🚀✨👍"`): each occupies two
  cells, cursor positions correctly after them, no overlap or stray cells.
- [ ] **CJK width.** Print CJK text (`echo "你好世界"`): characters are
  double-width and aligned; box-drawing and wide chars in TUIs render cleanly.

## Links

- [ ] **Clickable links.** Print a URL (`echo "https://example.com"`),
  Ctrl+click (or click) it: it opens in the system browser, not inside the
  app window.

## WebGL fallback

- [ ] **Context loss falls back to DOM rendering.** Open DevTools, create
  pressure on WebGL contexts (or run with `--disable-gpu` once): the terminal
  keeps rendering and accepting input; an error is logged in DevTools, no
  crash, no blank pane.

## Exit & restart

- [ ] **Exit overlay.** In A, run `exit`. An overlay appears at the bottom:
  "Process exited (code 0)" with a Restart button. The terminal content above
  is still readable and scrollable.
- [ ] **Non-zero exit code.** Run a command that exits with code 3
  (`cmd /c exit 3`): the overlay shows "code 3".
- [ ] **Restart.** Click Restart: the screen clears, a fresh shell starts,
  typing works, and output is not duplicated. Resize still works afterwards.

## Attention

- [ ] **Typing clears attention.** Trigger an attention state (if wired),
  then focus the session and type: the attention indicator clears. Switching
  to the session also clears it.
