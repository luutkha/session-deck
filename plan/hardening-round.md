# Plan: Hardening round — six enhancements to existing features (no new features)

Status: proposed — waiting for "go" per workstream or as a round. No code changed yet.
Date: 2026-10-25
User request (2026-10-25): "i want plan for alls" — the six enhancement items from the recommendation list. Each workstream below is independently shippable; suggested order W1 → W2 → W5 are the batch of trust fixes, W3/W4/W6 are UI polish.

## W1 · Timeline correctness: turn boundaries and cost attribution

Fixes the documented, unfixed bugs: "a Stop arriving after the next prompt would end the new turn; cost arriving after the next prompt counts toward the new turn; the away summary does not know about sleeps from before a restart."

Root cause, verified in source: `startPrompt` unconditionally ends the running turn as
'finished' (`src/main/timeline/timelineService.ts:156-173`), and a later `Stop` ends whatever
turn is running at arrival (`onHook`, line 180-182). When the user submits a follow-up prompt
while Claude's earlier turn is still finishing, the late Stop and the cost statusLine update
land on the wrong turn.

Design — out-of-order events settle the turn they actually belong to:
- `startPrompt` no longer hard-finalises the previous turn silently: it finalises it but the
  state remembers the *superseded still-running* turn (`awaitingStop` ref in
  `timelineState.ts`, pure).
- A `Stop` ends the `awaitingStop` turn (if one exists) instead of the newest running turn;
  its `endedAt` becomes the Stop arrival.
- `refreshCost` attributes cost by delta: each turn stores its cost baseline (session cost at
  prompt time); a settle assigns `cost(at) − baseline` to the turn being settled, so a late
  cost update can never land on the wrong turn (`timelineState.ts` pure; unit tests cover both
  out-of-order bugs failing before / passing after).
- Away summary: sleeps are already recorded (`recordSleptAt`, kept across restarts in
  `timelineFile` — verify persistence round-trip); `awaySummary.ts` includes pre-restart sleep
  events when building the summary.
- Files: `src/main/timeline/timelineService.ts`, `timelineState.ts`, `awaySummary.ts` + tests; no contract change.
- E2E: extend `scripts/e2e-away.cjs` with a fake out-of-order Stop/cost pair through the statusLine/hook endpoints; restart branch already exists.

## W2 · Quota autopilot hardening (D30)

All scoped as hardening, no new UI:
- **Real wording capture**: when a `USAGE_LIMIT_PATTERNS` match fires, log the (ANSI-stripped) matching line once per process to `main-errors.log` (`outputSignals.ts` / `sessionController.ts:173` path). Feeds the "wording list needs additions" gap with real data at zero risk.
- **`continue` retry + notification**: on `scheduleContinue` give-up (`CONTINUE_MAX_WAIT_MS` expiry, `autopilotContinue.ts`), retry once after 60 s; a second failure produces the desktop notification + 'quota' sound ("could not continue — needs you") via `Notifier` wired in `featureWiring.ts`. If `hands-free-quota.md` lands first, this is that plan's §3.2 — skip duplicates.
- **Weekly window gets the critical policy**: today `onAlert` applies `criticalAction` (auto-sleep) only to five-hour alerts (verified: `autopilotOps.ts:243-247` passes other windows through). Weekly critical applies the same idle-sleep policy; weekly reset stays notification-only (no 7-day holds — complex state, out of scope).
- **Dedup audit**: `guardResetAlert`'s 30-min dedup must never swallow a *weekly* reset alert (they cross windows) — pure-test it.
- Files: `src/main/quota/*`, `src/main/app/outputSignals.ts` (or its caller), `featureWiring.ts` + tests.
- E2E: extend `scripts/e2e-autopilot.cjs`: fake weekly-critical usage → idle sessions slept without a click; late out-of-order alert → still notified.

## W3 · Terminal search + scrollbar cleanup

Enhances the original core feature ("smooth UI console view", D01):
- Add `@xterm/addon-search` (match version family of installed `@xterm/*` ^0.10-0.13 deps, `package.json:55-62`), one provider per pane, created where the other addons are (search the existing addon wiring in `src/renderer/Terminal/paneFactory.ts`).
- Shortcut: **Ctrl+Shift+F** (anywhere, matching the Ctrl+Shift+K palette precedent so the terminal keeps its readline keys); `Esc` closes, `Enter`/`Shift+Enter` cycle matches, match count shown in a small Orca-style overlay input (`Input` primitive, absolute bottom-right).
- Search operates on the visible pane's buffer; scrolls to the match, option to search all? — v1: visible pane only.
- Scrollbar: the two arrow buttons on the track come from default WebKit scrollbar styling in the `.xterm-viewport` (verify in devtools); hide with a scoped `::-webkit-scrollbar-button` rule in the terminal stylesheet, keeping the existing theme scrollbar colors.
- Files: `src/renderer/Terminal/*` (+ `keymap.ts` shortcut table), one CSS file.
- E2E: extend an existing terminal e2e or `scripts/e2e-links.cjs`-style script: open pane, real key presses open search, typed query highlights and jumps, count matches, `Esc` restores focus to the terminal.

## W4 · Bulk session actions

Multi-select in the sidebar (and Hub board rows):
- Pure logic first: `src/renderer/state/multiSelect.ts` — selection set reducers, Ctrl/Shift+click range rules, `Esc` clears; anchored to `flatSessionIds` order from `selectors.ts` (so filtered/collapsed states behave).
- Interaction: Ctrl+click toggles a card into the selection *without changing the active session*; Shift+click range-selects; plain click still selects-opens as today. A small floating action bar appears at the sidebar bottom (Orca card style): Sleep / Wake / Set status / Move to group / Close? — v1: Sleep, Wake (where applicable), Set status, Move group. Each maps onto the existing per-session action, applied in `flatSessionIds` order, with per-item try/catch reporting exactly like the one-at-a-time paths.
- Closed sessions excluded; selection pruned on removal (same pattern as annotation pruning in the other plan).
- Accessibility: multi-select stays keyboard-possible (palette list already exposes per-session actions for single items; bulk remains pointer-first, acceptable in v1).
- Files: `src/renderer/Sidebar/` (SessionCard click handler, action bar component), `src/renderer/hub/` (grid rows), `state/multiSelect.ts` + tests, `selectors.ts`.
- E2E: new `scripts/e2e-bulk.cjs`: real clicks select two sessions, bulk-sleep both, assert two `sleeping` states, Esc clears, drag-and-drop still works (D20 regression guard).

## W5 · Multi-window sleep/attention fix

Verified root cause (`src/main/index.ts:265-281`): `isSessionOnScreen` and the sleep scheduler's
`getActiveSessionId` both use `windows.focusedRole()` — a **single** role. A session visible in
the popped-out Code window is treated as asleep-able while the user is literally looking at it
(documented gap).
- Change both to the **on-screen set**: every open window contributes its on-screen session id
  (`activeSessions` already holds one per role, and `windowRegistry` knows both windows) —
  `isSessionOnScreen(id) = onScreenIds.has(id)`.
- Applies to: AttentionService/Notifier skip-list, `wireAttentionNotices`, sleep scheduler's
  spared id, sleep-all's spared id (sleepAllPolicy receives the set instead of one id — pure
  policy change + tests).
- Files: `src/main/index.ts`, `app/userPresence/featureWiring` call sites, `sleep/sleepAllPolicy.ts`, `sleepPolicy.ts` + tests.
- E2E: extend `scripts/e2e-sleep.cjs` / `e2e-sleepall.cjs`: pop out the Code window (pattern exists in `e2e-codemode.cjs`), keep a session visible in it, idle expires → visible session stays running.

## W6 · Small UX debt (one batch commit)

- **Worker tabs "stuck empty" hint**: detection is impossible (plugin-less `opencode` is invisible by design, D19), so make the `WorkerView` empty state explain it: muted line — "OpenCode processes started from this session appear here. If one should be visible, restart the session (or run it without --pure) so SessionDeck can connect." Honest, tiny, unblocks user confusion.
- **Exit reason for OpenCode sessions**: Claude cards show `Exited (code N)`; OpenCode exits show bare "Exited" — thread the same pty exit code through `RuntimeState` (verify where the Claude path picks it up: `runtimeRegistry.ts` / `sessionController.ts`) and render it for every agent in `tabStatus.ts` + Hub card. Unit tests in `tabStatus.test.ts`.
- **Trust-this-folder auto-answer (opt-in)**: new Code setting, **default OFF**: "Answer Claude's worktree trust prompt automatically." Implementation reuses the exact prompt text/approach the e2e harness already uses (`scripts/e2e.cjs` answers that prompt — copy its detection string into a `pty` output watcher limited to Code-mode Claude sessions doing first-prompt startup), types the confirmation into the pane so it works like a manual answer. Off by default keeps W11 spirit (no state-changing unconditional sends).
- Files: `src/renderer/workers/WorkerView.tsx`, `tabStatus.ts`, `outputSignals.ts` + Code settings section + `WorktreeSettings`-ish UI in `src/renderer/settings/` or Code sidebar, e2e trust helper.

## Suggested execution

- **Batch A (trust, main process):** W1 + W2 + W5 — one worker session, cheap model first (W01), reviewed together since they touch overlapping wiring (`sessionController`, `featureWiring`, `runtimeRegistry`).
- **Batch B (renderer polish):** W3 + W4 + W6 — one worker session.
- Each batch: unit tests green → build → real-app e2e for every touched e2e script + new scripts → screenshots for UI work → docs updates (`HANDOFF.md` per section, `DECISIONS.md` for the trust-prompt opt-in decision, `CODEMAP.md` for `multiSelect.ts`) → conventional commit per workstream (W10).
- Everything is scoped so the standalone plans (hands-free-quota, annotate-diffs, rich-previews) don't collide: W2 overlaps §3.2 of hands-free-quota (flag it, build once), the rest touches new-only files.

## Kill criteria (drop rather than fight)

- W1 if the supersede-state races corrupt already-saved timelines — instead ship only the cost-baseline attribution + away-summary piece and revisit.
- W4 if multi-select fights drag-and-drop for more than one iteration — ship Ctrl+click single-add + bulk bar only, no Shift ranges.
- W6 trust auto-answer if the e2e answer string is not stable enough to reuse verbatim — drop the item, keep the other two.
