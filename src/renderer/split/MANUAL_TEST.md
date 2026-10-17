# Split panes — manual test

Prerequisite: open at least three sessions (tabs) in the main area. All steps expect no console errors.

## Split right / down
1. With one session active, open the `Split view` dropdown in the tab bar (Columns2 icon).
2. "Split right" → the active session and the most recently used other session appear side by side; both have a 6px slim header (status dot + name + remove button); the active pane has a 1px primary ring.
3. "Split down" → panes stack vertically instead.
4. Once split, the direction stays for any further split (`Split right`/`Split down` while already split only adds panes, keeping the current direction).
5. Add panes until 4 are visible; then "Split right"/"Split down" are disabled and no fifth pane opens.

## Drag divider
6. Drag the 1px line between two panes. The panes resize live; each pane's content refits and the pty gets a resize (the running program sees the new size).
7. Drag far past an edge: the moved pane stops at 15% of the container and cannot be collapsed to zero.

## Double-click equalize
8. Double-click a divider → all visible panes get equal width/height.
9. Keyboard: Tab to a divider (focus), press Enter → equalize.

## Keyboard resize
10. Focus a divider, press ArrowLeft / ArrowRight (row) or ArrowUp / ArrowDown (column) → the divider moves by 2% per press, clamped at 15%.

## Close pane
11. Click the "Remove from split" button in a pane header → that pane disappears, remaining panes renormalize; closing down to one pane removes all headers and dividers (looks exactly like the single-session terminal).
12. Attempting to remove the active pane keeps it visible (the active session always has a pane).

## Tab click replaces the active pane
13. In a 2-pane split, click a tab that is NOT visible → the active pane switches to that session (pane count unchanged), the clicked tab becomes active.
14. Click a tab that IS visible → layout unchanged, that pane is focused.

## Restart
15. Exit a session's process → its pane shows the "Process exited" overlay with Restart (also when split). Click Restart → fresh screen, replay reapplied, history from before the restart is gone as today.

## 4-pane limit
16. Persisted layouts with more than 4 panes or unknown/closed session ids are repaired on load: unknown ids dropped, active session forced visible, sizes re-equalized.

## Hidden sessions keep scrollback
17. Split, scroll a pane's terminal, switch it out of the split (remove pane, or click another tab) and bring it back (split again with that session) → its scrollback and rendering are intact (xterm stayed mounted).

## Persistence
18. Arrange a split, reload the window → the same layout, direction and sizes come back. Corrupt `sessiondeck.split.v1` in localStorage → app falls back to a single pane without errors.

## Accessibility / reduced motion
19. Dividers are reachable by keyboard with `role="separator"` and an "Resize panes" label; header close button is labelled "Remove from split"; split button is labelled "Split view"; tabs visible in a split show an "Open in split view" indicator.
20. With OS "reduce motion" on, no pulse/transition animations are required for the layout to work.
