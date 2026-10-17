# Notes panel — manual test checklist

Open the Notes panel for a session (`NotesPanel`) and tick each item only when it
behaves exactly as described.

## Panel chrome

- [ ] **Right panel.** The panel is 320px wide, full height, bordered on its left
      edge, and sits on the card surface.
- [ ] **Header.** Shows a notebook icon, "Notes", the truncated session name, and
      a close (X) button with `aria-label="Close notes"`.
- [ ] **Close.** Clicking X closes the panel; the selected session is unchanged.
- [ ] **Empty state.** A session with no notes and no steps shows "No steps yet."
      and an empty Notes textarea; the whole panel scrolls comfortably.

## Checklist

- [ ] **Add.** Type in "Add a step and press Enter" and press Enter: the step
      appears, the input clears, and focus stays in the input for the next entry.
      Pressing Enter with only whitespace does nothing.
- [ ] **Ignore empty.** Repeated Enter with an empty input never adds rows.
- [ ] **Progress.** "done of total" and the thin progress bar update as items are
      toggled. All items done → the bar turns the success color.
- [ ] **Toggle.** Clicking a checkbox strikes an item through and mutes it;
      clicking again restores it (counter follows).
- [ ] **Inline edit.** Click an item's text: an input appears pre-selected.
      Enter commits, Esc cancels and restores the old text, clicking away
      commits. Clearing the text and committing deletes the row.
- [ ] **Move.** Hover a row to reveal up/down arrows. Up/down reorder; the ends
      disable the corresponding arrow. All buttons carry readable labels.
- [ ] **Delete.** The trash button removes a row immediately (no confirm).
- [ ] **Clear completed.** When at least one item is done a ghost "Clear
      completed" button appears and removes only the done rows.
- [ ] **100 limit.** Rapidly adding 100 steps stops accepting new ones (no
      crash); toggling/deleting keeps working.
- [ ] **Long text.** A 300+ char step is trimmed to 300 on save.

## Notes textarea

- [ ] **Autosave.** Type and wait ~600ms: the store persists the text (no
      keystroke is lost). Blurring saves immediately.
- [ ] **Counter.** "n / 20000" ticks live while typing; within 2000 chars of the
      limit it turns destructive red. Very long paste is clamped to 20000.
- [ ] **Switch away.** Type without waiting, then switch sessions: the text is
      saved for the session you left.
- [ ] **Switch back.** Reopen the panel for that session: your notes and the
      checklist are still there.
- [ ] **External change.** Value changed elsewhere reappears in the panel.

## Save failures

- [ ] **Error surfacing.** If the backend rejects a save, a red `role="alert"`
      message appears in the panel, the typed value stays, and the next
      successful action clears the error.

## Sidebar / Hub chips

- [ ] **Checklist chip.** A session card in the sidebar and Hub shows "✓ 2/5"
      (check-square icon) that turns the success color when fully complete;
      tooltip reads "2 of 5 steps done".
- [ ] **Notes chip.** Sessions with notes show a small notebook icon; tooltip
      reads "Has notes".
- [ ] **Nothing to show.** A session with neither notes nor steps shows no chip.