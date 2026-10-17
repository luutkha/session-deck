# Manual Test Checklist

Run `npm run dev` and verify each item. Mark with `[x]` when verified.

## 1. Create Session
- [ ] Click "+ New session" or press Ctrl+N
- [ ] Folder picker opens; select a valid directory
- [ ] New session appears in sidebar with default name (directory name)
- [ ] Session becomes active; terminal shows Claude prompt
- [ ] Terminal is interactive (type `echo hello` → see output)

## 2. Rename Session
- [ ] Right-click session → "Rename" (or press F2)
- [ ] Edit name; press Enter
- [ ] Sidebar updates with new name
- [ ] Persists after app restart

## 3. Assign Status
- [ ] Right-click session → "Set status" → pick a status (e.g., "Working")
- [ ] Colored status badge appears on session row
- [ ] Status filter in header filters by status
- [ ] Status persists after app restart

## 4. Attention: Sound + Taskbar Flash
- [ ] Create two sessions (A and B)
- [ ] Make A active; start a long-running command in A (e.g., `sleep 10`)
- [ ] Switch to B (click B in sidebar)
- [ ] Wait for A to complete (or trigger permission prompt in A via Claude)
- [ ] Verify: system beep sounds AND taskbar flashes for SessionDeck window
- [ ] Click SessionDeck window → flash stops
- [ ] Toggle "Sound" in statusbar → beep disabled/enabled
- [ ] Sound preference persists after app restart (localStorage)

## 5. Groups (Create/Rename/Move/Delete)
- [ ] Click "+ Group" → new group appears with default name
- [ ] Rename group (right-click → Rename)
- [ ] Drag session into group
- [ ] Drag session out of group (becomes ungrouped)
- [ ] Collapse/expand group (chevron)
- [ ] Delete group (right-click → Delete) → sessions become ungrouped
- [ ] Group order persists after app restart

## 6. Terminal Quality (Resize, Scrollback, Paste)
- [ ] Resize window → terminal reflows correctly (no garbled text)
- [ ] Scroll up → scrollback preserved
- [ ] Switch to another session and back → scrollback preserved
- [ ] Paste multi-line text (Ctrl+Shift+V) → all lines sent to PTY
- [ ] Restart exited session (click "Restart" button) → fresh terminal, scrollback cleared, new session starts

## 7. Quit and Relaunch Restores List
- [ ] Create 3 sessions in 2 groups with different statuses
- [ ] Quit app (Ctrl+Q or close window)
- [ ] Relaunch `npm run dev`
- [ ] All 3 sessions appear in sidebar with correct groups, names, statuses
- [ ] Sessions show "Exited" with Restart button (not auto-started)
- [ ] Click Restart → session runs again

## Notes
- If any item fails, note the step and observed behavior.
- For attention testing: use `claude -p "long task"` or a script that triggers idle/permission.
- The store file is at `%APPDATA%/sessiondeck-store.json` (Windows) or `~/Library/Application Support/sessiondeck-store.json` (macOS) or `~/.config/sessiondeck-store.json` (Linux).