# Settings dialog — manual test checklist

Open the Settings dialog and tick each item only when it behaves exactly as
described. State changes apply immediately; there is no Save button. Esc, the
close (X) button, and clicking the backdrop all close the dialog.

## Layout & navigation

- [ ] **Wide dialog.** The settings dialog opens centered, noticeably wider than
      the statuses editor, with a rounded title bar.
- [ ] **Left nav.** The left column has six items in this order — "General"
      (sliders icon), "Agents" (bot icon), "Sound" (volume icon), "Automation"
      (wand icon), "Quota" (gauge icon) and "Statuses" (tags icon). The active
      item is highlighted with the accent background; the inactive ones are muted.
- [ ] **Switch sections.** Click "Statuses" while on General: the right pane
      swaps to the statuses list and the nav highlight moves. Clicking any other
      item swaps back.
- [ ] **Right pane scrolls.** With many statuses (8+), the right pane scrolls
      independently; the nav column stays put.
- [ ] **Close paths.** Press Esc, click the X, and click the backdrop — each
      closes the dialog.
- [ ] **Focus.** The dialog traps focus (Tab cycles inside, focus returns to the
      trigger after close).

## Sound section

- [ ] **Master switch.** The switch labeled "Play a sound when a session needs
      attention" toggles the attention sound on/off. Turning it off dims the
      rows below but does not disable the controls (volume slider and selects
      still work).
- [ ] **Volume.** The "Volume" slider shows a percentage that updates while
      dragging. At 0% the sound is silent; at 100% it is loudest.
- [ ] **Built-in sound.** For each row (Needs permission, Finished, Waiting for
      you, Terminal bell, Quota warning) opening the Select lists every built-in
      sound label, "Custom file...", and "None". Picking a built-in sound keeps
      that choice for the row.
- [ ] **Quota warning row.** The fifth row reads "Quota warning" with the
      description "Your Claude plan usage reached a warning level." and has the
      same Select, Test and custom-file controls as the other rows. Its default
      is "Bell". Changing it does not affect the other rows.
- [ ] **Test.** Clicking the play button on a row (e.g. "Test Needs permission
      sound") plays that row's chosen sound at the current volume. Each row's
      button has a distinct accessible name.
- [ ] **Custom file.** Choose "Custom file..." for a row: a file picker opens.
      After picking a file, that row shows the file's base name plus a
      "Change..." button; the Select now reads "Custom file...".
- [ ] **Change...** Click "Change..." on a file row: the picker reopens and the
      new file replaces the old one (name updates).
- [ ] **None.** Choose "None" for a row: testing that row is silent; the row's
      Select reads "None".
- [ ] **Per-reason independence.** Setting a custom file for "Finished" does not
      change "Needs permission".
- [ ] **Error surface.** If a sound action fails (e.g. an unreadable file was
      chosen), a red message with `role="alert"` appears under the rows; it
      clears on the next successful action.

## General section

- [ ] **Start on login.** "Start SessionDeck when I sign in to Windows" loads its
      state from the app on open. Toggling it updates the OS login item. In a dev
      (unpackaged) build the switch is disabled and the muted hint "Available in
      the installed app" shows below it.
- [ ] **Close to tray.** "Keep running in the tray when I close the window" is
      bound to `tray.closeToTray`. The helper text "Your sessions keep running.
      Quit from the tray menu or the button below." sits under it, and closing
      the window hides it to the tray when on.
- [ ] **Desktop notifications.** The "Desktop notifications" switch is bound to
      `tray.desktopNotifications`. "Only when SessionDeck is not the active
      window" is bound to `tray.notifyOnlyWhenUnfocused` and is disabled while
      notifications are off (turning notifications back on re-enables it).
- [ ] **Quit two clicks.** The destructive-styled "Quit SessionDeck" outline
      button does nothing destructive on the first click — it reveals "This stops
      all running sessions." with a Cancel link. A second click on the button
      quits the app; Cancel dismisses the warning.
- [ ] **Inline errors.** If any General change is rejected, a red `role="alert"`
      message appears at the bottom of the section; the next successful change
      clears it.

## Agents section

- [ ] **Default agent.** "Default agent for new sessions" is a segmented radio
      group with "Claude Code" and "OpenCode". Picking one persists
      `agents.defaultAgent` immediately and highlights the chosen segment.
- [ ] **Keyboard.** Tabbing to the group and pressing the arrow keys moves the
      selection between "Claude Code" and "OpenCode" (native radio behavior).
- [ ] **Default model.** "Default OpenCode model" is a text input prefilled from
      `agents.opencodeModel` with the placeholder "provider/model, e.g.
      opencode/deepseek-v4.1-flash-free". Blurring the field or pressing Enter
      saves the trimmed value.
- [ ] **Model validation.** Letters, digits and `. _ : / @ + -` only, at most 200
      characters. An invalid value shows a red inline `role="alert"` message and
      is NOT saved. An empty value is allowed and saves an empty string.
- [ ] **Helper text.** The muted line "Empty uses OpenCode's own default model.
      Used only for OpenCode sessions." shows below the input.
- [ ] **Inline errors.** A rejected save shows a red `role="alert"` message at
      the bottom of the section; the next successful change clears it.

## Automation section

- [ ] **Header & switch.** The section shows "Move a session to a status
      automatically when Claude's activity changes." and an "Automatic status"
      switch bound to `autoStatus.enabled`.
- [ ] **Three rows.** "While Claude is working", "When Claude needs permission or
      input" and "When Claude finishes" each open a Select listing "Don't change"
      plus every status as a color dot and name.
- [ ] **Disabled when off.** Turning "Automatic status" off dims the three rows
      and their Selects are disabled; turning it back on re-enables them.
- [ ] **Writes.** Picking a status for a row persists `autoStatus.working` /
      `needsInput` / `finished`; choosing "Don't change" stores `null`. The note
      "Applies to open sessions only; you can still change a status by hand."
      sits below the rows.
- [ ] **Inline errors.** A rejected change shows a red `role="alert"` message at
      the bottom of the section.

## Sleep idle sessions (in the Automation section)

- [ ] **Card.** Below the automatic-status rows a bordered card titled "Sleep idle
      sessions" holds a switch and a number input.
- [ ] **Switch.** The "Sleep idle sessions" switch is bound to `sleep.enabled`;
      toggling it persists immediately.
- [ ] **Minutes input.** "Sleep after (minutes)" is a number input (step 1) bound
      to `sleep.afterMinutes`, prefilled with 30. Entering a value outside 1–1440
      clamps it into range when saved; an empty or non-numeric value shows a red
      inline `role="alert"` message and is NOT saved.
- [ ] **Disabled when off.** The minutes input is dimmed and disabled while the
      switch is off; turning the switch on re-enables it.
- [ ] **Helper text.** The muted line "Stops the Claude process of a session that
      has been idle (no output, not working, not waiting for you) to free memory
      and CPU. Open it again and the same conversation resumes." shows below.

## Quota section

- [ ] **Master switch & reset switch.** "Warn me when my plan usage gets high" is
      bound to `quota.enabled`; "Tell me when a usage window resets" is bound to
      `quota.notifyOnReset`.
- [ ] **Threshold inputs.** "Warn at (%)" and "Critical at (%)" are number inputs
      (step 1) prefilled with 80 and 95. A valid edit saves immediately; the
      inputs are dimmed and disabled while the master switch is off.
- [ ] **Validation.** Warn must be a whole number 1–99; Critical a whole number
      2–100 that is greater than Warn. Invalid input shows a red inline
      `role="alert"` message under the field and is NOT sent (e.g. clearing a
      field, typing 100 in Warn, or setting Critical ≤ Warn).
- [ ] **Recovery.** Correcting an invalid field makes the pair valid and saves
      both values in one patch; the error clears.
- [ ] **Explanation.** The muted line "Alerts use the sound chosen under Sound >
      Quota warning and a desktop notification when enabled." shows below.

## Statuses section

- [ ] **Header.** The section shows "Statuses are the columns of the Hub and
      the groups of the sidebar. Their order here is the column order."
- [ ] **Rows.** Each status renders as a color swatch, editable name, preview
      badge, and delete button — same as the statuses editor. Two up/down
      buttons sit on the left of each row.
- [ ] **Reorder up/down.** Pressing the up arrow on the second status moves it
      above the first, and the sidebar/Hub column order updates. The down arrow
      moves it back.
- [ ] **Ends disabled.** The up arrow is disabled on the first row; the down
      arrow is disabled on the last row.
- [ ] **Accessible names.** The buttons read "Move <name> up" and "Move <name>
      down".
- [ ] **Rename & recolor.** Editing a name (blur to commit) and picking a new
      color persist; the preview badge and swatch update.
- [ ] **Delete two clicks.** First click on a row's trash shows the inline
      warning; a second click on the now-red trash deletes the status. A
      "Cancel" link dismisses the warning.
- [ ] **Add status.** "Add status" appends a new row named "New status"; repeat
      adds "New status 2", "New status 3", etc., skipping names already in use.
      Rename it to verify the row survives reorder.
- [ ] **Inline errors.** Clearing a row's name and blurring keeps the typed
      value visible with an inline error; the row is not reset.
- [ ] **Action errors.** If the backend rejects an upsert/delete/reorder, the
      error appears inline near the list and the draft stays visible.