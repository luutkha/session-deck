# Grid view — manual test (D32)

1. Tab bar → **Grid ▾** → `2x2`: the terminal area becomes four cells; every cell shows "Pick a session" (nothing auto-fills).
2. Click a cell's header → pick a session: it appears with a real terminal (type into it — the agent reacts). Picking a second session in another cell shows both live.
3. Pick a session that is ALREADY in another cell → the two cells SWAP (never two cells with the same session).
4. Change the preset: `2x2 → 3x2` keeps the assignments and adds empty cells; `3x2 → 1x1` keeps the first cell and hides the others; back to `3x2` restores them (the overflow is memory-only).
5. Click a cell → its header dot/ring marks focus and typing goes to that cell only. Escape/other cells keep their scrollback when refocused.
6. Sidebar: click another session while in the grid → its tab opens and, if it has a cell, the cell is focused; the grid stays on screen.
7. Ops and Code each remember their own grid (`sessiondeck.grid.v1` / `…v1.code`): set them differently and switch modes.
8. Quit through the app (tray → Quit) and relaunch: the preset and cell assignments come back.
9. Close a session from the sidebar: its cell empties and shows the picker again (no crash, other cells keep running).
10. Empty the whole grid (× on each header): five healthy empty cells, the pickers still offer every open session.
