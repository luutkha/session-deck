# Sidebar dialogs — manual test checklist

Run `npm run dev` and exercise both dialogs from the sidebar. Tick each item only
when it behaves exactly as described.

## Modal basics (both dialogs)

- [ ] **Focus moves in.** Opening a dialog puts focus on its first input
      (Folder in New session; nothing focusable-first in Status editor means the
      dialog itself or the close button is reachable by Tab).
- [ ] **Focus is trapped.** Tab from the last focusable element wraps to the
      first; Shift+Tab from the first wraps to the last. Focus never lands on
      the sidebar/terminal behind the backdrop.
- [ ] **Esc closes.** Press Esc anywhere in the dialog → dialog closes, no
      other side effect (no session created / no status removed).
- [ ] **Backdrop click closes.** Click the dimmed area *outside* the dialog box
      → closes. Click *inside* the dialog (fields, padding) → stays open.
- [ ] **Close (×) button works** and behaves like Esc.
- [ ] **Focus returns.** After closing, keyboard focus is back on the element
      that opened the dialog (e.g. the "New session" button).

## New session dialog

- [ ] **Create disabled initially.** "Create session" is disabled while
      Folder is empty or whitespace.
- [ ] **Browse...** opens the native folder picker; picking a folder fills the
      Folder field and enables Create. Cancelling the picker changes nothing.
- [ ] **Enter submits.** Pressing Enter in any text field creates the session
      (or shows an error) — it does not submit twice.
- [ ] **Name placeholder** shows the last folder segment (e.g. `project` for
      `C:\work\project\`) and is optional — leaving it empty uses the derived
      name.
- [ ] **Name too long error.** 101 characters → inline error "Name too long",
      dialog stays open, no session created.
- [ ] **Empty folder error.** Type spaces only in Folder and submit (via Enter
      with the button state forced by editing) → "Folder required".
- [ ] **Bad args error.** Put `a&b` or `"x y"` in Extra claude args → error
      `Unsupported characters in argument: ...`, dialog stays open. Allowed
      sample `--model opus` succeeds.
- [ ] **Group select.** Shows "No group", every group, then "New group...".
      Selecting "New group..." reveals a text field inline.
- [ ] **New group flow.** Choose "New group...", type a name, Create session →
      group exists in the sidebar *and* the new session is inside it.
- [ ] **Empty new-group name** shows "Group name required" and creates nothing.
- [ ] **Status select.** "None" plus every status; the created session gets
      the chosen status (visible as the dot in the row).
- [ ] **Action failure.** If the store rejects (e.g. duplicate/bad input on the
      main side), the message is shown in the dialog, the dialog stays open,
      and no `onCreated` close happens.
- [ ] **Success closes.** On success the dialog closes and the new session is
      selected/visible.

## Orca layout (New session + delete confirm)

- [ ] **Header.** New session shows title "New session" and the muted line
      "Start a Claude Code session in a folder."
- [ ] **Folder row.** Input and an outline "Browse..." button with a folder icon
      sit on one row; the Browse button is disabled while creating.
- [ ] **Error placement.** Validation or store errors appear as red text
      (destructive token) directly above the footer, with role alert; the
      dialog stays open.
- [ ] **Group and Status selects** use the Orca select popover. Group shows
      "No group", each group, "New group..."; choosing "New group..." reveals
      the "New group name" field. Status shows "None" and each status with its
      color dot (same dot as the session badge).
- [ ] **Extra args hint** is muted, 11px, under the field, and lists the allowed
      characters.
- [ ] **Footer.** Outline "Cancel" and primary "Create session" (right aligned).
- [ ] **Escape / X / backdrop** close New session without creating anything.
- [ ] **Delete confirm (Remove session / Delete).** Title and muted message are
      shown; footer has outline "Cancel" and a red destructive button with a
      trash icon.
- [ ] **Confirm focus.** Opening the confirm puts focus on "Cancel", so Enter
      cancels and Tab moves to the destructive button.
- [ ] **Confirm Escape** cancels; the session/group is not removed.
- [ ] **Confirm focus returns** to the element that opened it (context menu
      trigger or card) after cancel or confirm.

## Status editor

- [ ] **Lists statuses** with color swatch, name and Delete per row.
- [ ] **Add status.** Click "Add status" → a row "New status" with grey
      `#9e9e9e` appears immediately (persisted — close and reopen to confirm).
- [ ] **Recolor.** Click a swatch, pick a color → the swatch and the sidebar
      status dot update without closing the dialog.
- [ ] **Rename.** Edit a name and Tab/click away → new name persists (check
      after reopen). Enter does not need to commit; blur does.
- [ ] **Name errors inline.** Clear a name and blur → "Name required" shown on
      that row; 101 chars → "Name too long". The stored status is unchanged.
- [ ] **Delete needs two clicks.** First Delete click shows the warning
      "Sessions with this status will have no status" on that row; clicking
      Delete again removes the status. "Cancel" dismisses the confirmation.
- [ ] **Sessions lose the status** after delete: previously assigned sessions
      show no status dot (they do not error).
- [ ] **Close button / Esc / backdrop** all close the editor; changes made are
      already saved (no "unsaved changes" prompt expected).

## Theme sanity

- [ ] Controls use the Orca dark tokens (popover surface, input border, primary
      button, destructive red); no old blue `#0e639c` buttons remain in the
      New session or confirm dialogs.
- [ ] Keyboard focus shows a visible blue `:focus-visible` ring on buttons and
      fields; scrollbars are thin and dark.
