# Manual test — Status bar Claude usage chips

Scope: `src/renderer/usage/**` renders Claude plan usage in the status bar.
Automated coverage: `usageLogic.test.ts`, `usageCache.test.ts` (pure functions).

## Setup

1. `npm run dev`.
2. Open at least one Claude session so the status bar shows a cwd and run chip.
3. The renderer reads `window.api.getUsage()` / `window.api.onUsage` (built by the
   backend worker). If that API is absent, the app must still render normally.

## Cases

1. **Waiting state** — Before any turn reports usage, the right cluster shows a
   muted `Usage: waiting for a turn`. Hovering shows
   "Claude Code and OpenCode Go report usage after a turn."
2. **Account bars** — After a turn, two chips appear: `5h` and `Week`, each a thin
   12px track with a percentage. Colors: <70% primary, 70–89% warning, >=90% destructive.
3. **Countdown** — Hover a chip; the tooltip reads e.g.
   "5-hour window: 38% used, resets in 2h 10m (updated just now)". The countdown ticks
   every 30s without any data change.
4. **Active session** — The active session's chip reads `Sonnet 5.5 · ctx 5% · $0.11`
   (missing parts are omitted). The tooltip lists Model, Context, Cost, Effort, Updated.
   At `ctx >= 85%` the context value turns warning/destructive colored.
5. **Stale cache** — Start the app with API usage delayed: previously cached account
   values show immediately at reduced opacity and their tooltips end with "(stale)".
6. **Recovery** — Once a fresh `onUsage` event arrives, the stale flag clears.
7. **No session** — With no active tab, only the account chips render (no session chip).
8. **No `window.api`** — Temporarily delete `window.api` in DevTools and reload: no
   crash, chips show the waiting state, console free of errors.
9. **Refresh affordance** — A small ghost refresh icon (RefreshCw) sits at the end of the
   usage cluster. It is also present in the "Usage: waiting for a turn" state, so
   one click can load numbers with no session turn. Tooltip reads "Refresh usage from
   your Claude account" with a muted second line "Uses the login token Claude Code keeps
   on this machine".
10. **First-use consent** — With `localStorage['sessiondeck.usage.consent.v1']` cleared,
    the first click opens a dialog titled "Refresh usage from your Claude account?" with
    plain-language body about `~/.claude/.credentials.json`, api.anthropic.com, and the
    token never being saved/logged. Cancel (focused on open) and Escape dismiss with no
    request; "Allow and refresh" persists consent, closes, and starts the request. A
    second click refreshes directly.
11. **Spinner** — While the request is in flight the icon spins (`motion-safe:animate-spin`)
    and the button is disabled; with OS "reduce motion" enabled it does not spin.
12. **Errors** — On failure a short destructive-colored line appears next to the button
    (`role="alert"`) for ~8 s and is also shown in the tooltip; it clears on the next
    attempt or after 8 s. Check each kind: no-credentials, stale-token, rate-limited
    (message includes the retry delay, e.g. "Try again in 4m."), server, network,
    unavailable.
13. **Missing refresh API** — With `window.api.refreshUsage` deleted, clicking refresh
    shows "Refresh is not available in this build." and never throws.
14. **Cooldown math** — `refreshCooldownLeftMs` (pure) returns the remaining retry window
    for rate-limited errors and 0 for every other kind, an absent delay, or after expiry
    (covered by `usageLogic.test.ts`).
15. **Pace hint** — After two or more fresh account updates that change the 5-hour percent
    over at least 5 minutes, the 5h chip shows a muted `~1h 20m left at this pace` inline
    when the percent is >= 30%, and every chip's tooltip gains a second pace line. When the
    projection lands after the reset it reads "won't hit the limit before it resets" (never
    inline). With too little history, no pace text appears. History persists under
    `localStorage['sessiondeck.usage.history.v1']`; corrupt JSON renders as no history
    (covered by `usagePace.test.ts`).
16. **Quota toasts** — When main emits a quota alert, a toast stacks at the top-right
    (max 3, newest last): warn = warning colour, critical = destructive, reset = success,
    with a reset toast adding "resets in 2h 10m" when a reset time is known. Each has a
    Gauge/AlertTriangle icon, a Dismiss (X) button, and auto-dismisses after 8 s. Copy is
    "5-hour usage is at 82%", "Weekly usage is at 96%, critical", "5-hour window reset"
    (covered by `quotaAlertLogic.test.ts`). With `window.api.onQuotaAlert` missing nothing
    renders and there are no console errors.
