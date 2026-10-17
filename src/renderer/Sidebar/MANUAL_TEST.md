# Sidebar — manual test checklist

Run the app (`npm run dev`) with at least two groups (G1, G2) and three sessions
across them plus at least one ungrouped session. Tick each item only when it
behaves exactly as described.

## Header & errors

- [ ] **New session.** Click "+ New session" with nothing selected: a new session
  is created (grouped or ungrouped as the app decides) and it appears in the list.
- [ ] **New group.** Click "+ Group": a group named "New group" appears at the
  end of the group list with its name already in an inline rename box, text
  selected.
- [ ] **Error banner.** Force a failure (e.g. act while the backend is
  unavailable): a red banner appears at the top; the `×` dismiss button clears
  it.

## Groups

- [ ] **Collapse/expand.** Click the caret on G1: its sessions hide, the caret
  flips, and `aria-expanded` on the group flips. Click again: sessions return.
- [ ] **Rename via double-click.** Double-click the G1 header name, type a new
  name, press Enter: the header shows the new name.
- [ ] **Rename via F2.** Focus the G1 header (Tab or click), press F2, rename,
  Enter: works the same.
- [ ] **Rename cancel.** Start a rename, press Esc: the old name is kept.
- [ ] **Rename empty name (Enter).** Clear the name and press Enter: an error
  "Name required" shows under the input and the editor stays open; the name is
  not changed.
- [ ] **Rename empty name (blur).** Clear the name and click elsewhere: the edit
  is cancelled (the editor closes) and the old name is kept — the field does not
  grab focus back or stay stuck on the row.
- [ ] **Rename unchanged.** Open a rename, add only leading/trailing whitespace,
  Enter: nothing is committed (no network call, name unchanged).
- [ ] **Delete group via context menu.** Right-click the G1 header → "Delete
  group": an in-app confirm dialog appears (NOT a native dialog) with focus on
  Cancel and `role="alertdialog"`. Tab is trapped inside the dialog, Esc cancels,
  clicking the backdrop cancels; Cancel keeps the group. Remove deletes it and
  its sessions become ungrouped (visible under the "Ungrouped" label). After
  closing, focus returns to where it was.
- [ ] **Group context menu items.** Right-click a header: Rename, New session in
  this group, Delete group. "New session in this group" creates a session inside
  that group.
- [ ] **Group actions button.** Hover a header: the "⋯" button appears; clicking
  it opens the same menu anchored to the button.

## Sessions

- [ ] **Select.** Click a session row: active session switches, the row is
  highlighted, `aria-selected="true"`.
- [ ] **Rename via double-click / F2.** Double-click a row, or focus the list and
  press F2 with that session active: inline editor appears. Enter commits, Esc
  cancels, Enter on an empty name keeps the editor open with an error, and
  blurring an empty name cancels the edit (old name kept).
- [ ] **Subtitle.** Each row shows the last path segment of its `cwd` in muted
  text.
- [ ] **Status dot.** A session with a status shows a filled dot in that status
  color; one without a status shows a hollow ring.
- [ ] **Exited badge.** A session whose process exited shows a small "exited"
  badge and a muted name.

## Status context menu

- [ ] **Set status.** Right-click a row → Set status: submenu lists every status
  with its colored dot plus "None". Choosing one updates the row's dot and the
  filter counts. "None" clears the status.
- [ ] **Move to group.** Right-click a row → Move to group: lists every group,
  "No group", and "New group...". Choosing a group moves the session to the end
  of that group; "No group" moves it to ungrouped; "New group..." creates a group
  (starting an inline rename) and moves the session into it.
- [ ] **Remove session.** Right-click a row → Remove session: in-app confirm
  appears with focus on Cancel, Tab trapped, Esc cancels; Cancel keeps it, Remove
  deletes it.

## Drag and drop

- [ ] **Session between groups.** Drag a session onto another group's header:
  the header shows a highlight ring and the session moves to the end of that
  group.
- [ ] **Session reorder.** Drag a session onto another session (upper half =
  insert before, lower half = insert after): a thin accent line shows the target
  position and dropping reorders correctly.
- [ ] **Session to ungrouped.** Drag a session from a group onto the "Ungrouped"
  area (or the hint area when empty): it moves out of the group and appears under
  Ungrouped.
- [ ] **Group reorder.** Drag a group header onto another group header (upper
  half = before, lower half = after): a line shows the insert position and the
  groups reorder.
- [ ] **No-op drags.** Dragging a session onto its own position, or a group onto
  its own position, does nothing (no duplicate, no flicker).
- [ ] **Drop indicator clears.** After dropping, or dragging out of the sidebar,
  all drop lines/rings disappear.

## Filter chips

- [ ] **Single filter.** Click a status chip: only sessions with that status
  remain; the chip is highlighted and `aria-pressed="true"`.
- [ ] **Multi-select.** Click a second chip: sessions of either status show.
- [ ] **None chip.** Click "None": sessions without a status show.
- [ ] **Clear.** Click all selected chips off: the full list returns.
- [ ] **Counts.** Each chip shows the total count for its status (including
  None); counts reflect the unfiltered store.

## Status editor

- [ ] **Color persists.** Open Statuses, pick a new color for a status via the
  color swatch: the swatch keeps the new color (it is not silently reverted) and
  the session dots/filter chips update.
- [ ] **Name + color commit together.** Edit a status name and change its color:
  blurring the name commits both fields; the row keeps both values.
- [ ] **Invalid draft shown.** Clear a status name and click the color swatch: an
  error appears on that row and the draft (typed name + picked color) stays
  visible rather than being lost.
- [ ] **Upsert rejection.** If the backend rejects an update, the error shows on
  the row and the typed draft is not cleared.

## Attention

- [ ] **Pulse.** Trigger an attention state (permission prompt / finished turn /
  quiet-after-activity) for a session: a pulsing colored dot plus a bell glyph
  appears on its row, colored by reason (permission amber, done green, idle
  blue). Its `aria-label` reads like "Needs attention: permission".
- [ ] **Reduced motion.** With OS "reduce motion" enabled, the dot does not pulse
  but is still visible.

## Keyboard navigation

- [ ] **Arrow navigation.** Focus the list (Tab into it), press ArrowDown/
  ArrowUp: selection moves through the visible sessions in order, skipping
  sessions inside collapsed groups.
- [ ] **Enter.** Press Enter: the active session is selected.
- [ ] **F2.** Press F2: the active session starts inline rename.
- [ ] **Delete.** Press Delete on a session: the in-app confirm appears.
- [ ] **Ctrl+N (window-level).** With focus anywhere in the app, press Ctrl+N: a
  new session is created. Works while the terminal is focused too. It does
  nothing while an inline rename input (or any text field) is focused — the
  half-typed value is not blurred or committed — and nothing while a modal dialog
  is open.

## Context menu edge cases

- [ ] **Near the right/bottom screen edge.** Right-click a row near the
  bottom-right corner: the menu stays fully on screen (clamped), never cut off.
- [ ] **Large submenu.** Open "Set status" near the right edge: the submenu opens
  to the side and remains visible.
- [ ] **Keyboard menu nav.** With a menu open: ArrowUp/ArrowDown move the
  highlight (skipping disabled items), ArrowRight opens a submenu, Enter
  activates, Esc closes, clicking outside closes.
- [ ] **Submenu key isolation.** Open "Set status", press ArrowDown several
  times: only the submenu highlight moves (the parent item also stays put), and
  focus stays inside the submenu. ArrowLeft closes only the submenu and returns
  focus to the "Set status" parent item. Esc closes the submenu first; a second
  Esc closes the whole menu.
- [ ] **Disabled/danger styling.** "Remove session" / "Delete group" render in
  the danger color.

## Accessibility smoke

- [ ] **Roles.** The list container is `role="tree"`, group sections are
  `role="group"` (their caret button carries `aria-expanded`), session rows are
  `role="treeitem"` with `aria-selected`.
- [ ] **Labels.** Every icon-only button (caret, group `⋯`, error `×`, filter
  chips via pressed state) has an accessible name.
- [ ] **Focus ring.** Tabbing through the sidebar shows a visible focus ring on
  the list, headers, and buttons.
