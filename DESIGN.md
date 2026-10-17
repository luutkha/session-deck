# SessionDeck UI: "look exactly like Orca"

Goal (user request): the same UI as Orca (https://www.onorca.dev, open source MIT, https://github.com/stablyai/orca) for OUR feature set only (sessions, rename, user statuses, attention sound, groups, native terminal). Behavior and the six features stay ours; the visual system, layout and component styling become Orca's.

Reference (MIT, Copyright (c) 2026 Lovecast Inc., keep the LICENSE and a notice in the app's about/THIRD_PARTY file): `reference/orca/`
- Target screenshots: `reference/orca/docs/assets/readme-hero.jpg` (full window), `reference/orca/docs/site/ways-to-run-local-sidebar.png` (sidebar cards), tab-split.jpg, orca-split-screen.jpg.
- Tokens + fonts: `reference/orca/src/assets/main.css` (dark palette in the `.dark` block, `@theme inline`, `--radius: 0.625rem`, font `Geist` at `src/assets/fonts/Geist-Variable.woff2`).
- shadcn/ui primitives to reuse nearly verbatim: `reference/orca/src/components/ui/*.tsx` (button, badge, input, dialog, dropdown-menu, context-menu, tooltip, scroll-area, select, switch, separator, collapsible, popover, checkbox, textarea, label).
- Layout components to study and copy class names from: `components/sidebar/*` (SidebarHeader, SidebarNav, WorktreeCard*, WorktreeList, SidebarGroupByToggle, SidebarFilter), `components/tab-bar/*` (TabBar, SortableTab), `components/status-bar/*`.
- Stack to adopt: Tailwind CSS v4 (`@tailwindcss/vite`), `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` icons, `tw-animate-css`. Dark theme only (`class="dark"` on <html>). Match versions in `reference/orca` package.json (https://github.com/stablyai/orca/blob/main/package.json).

## Target anatomy (from the hero screenshot)
1. Window: canvas `--background #0a0a0a`; custom title bar row (Windows: `titleBarOverlay`, same dark color) with the app name and a sidebar-toggle icon button.
2. Left sidebar (~280px, `--sidebar`/worktree-sidebar colors, 1px border `rgb(255 255 255 / 0.07)`):
   - Nav rows (icon + label, muted, hover accent): "New session", "Search".
   - "Sessions" header row (muted text) with small icon buttons on the right: filter (sliders icon, opens group-by menu: Groups | Status), new group (folder-plus), new session (plus).
   - Collapsible SECTIONS: header = chevron/icon + label + count badge. Sections are our groups (default) or our statuses (group-by Status). A "Pinned"-style first section is NOT needed.
   - SESSION CARD (rounded-lg, hover bg accent, selected = accent bg + subtle border): row 1 status dot (green running, red exited, amber needs attention, pulsing) + title (medium weight, truncate) + right-aligned small actions; row 2 small badges (group name, user status as colored dot + name) + muted folder name; row 3 muted line: activity text ("Running", "Needs permission", "Finished", "Exited (code)") with relative time on the right ("22m").
   - Bottom: help/settings icon buttons row (statuses editor lives here), thin.
3. Main area: TAB BAR (h ~36px): one tab per OPEN session (icon + truncated title + close x, active tab lighter with underline/top accent), a `+` button, right-side small icon buttons. CLOSING A TAB CLOSES THE SESSION (user decision 2026-10-13): kill its `claude` process AND move the session out of the active list into a collapsible "Closed" section at the bottom of the sidebar (collapsed by default, count badge, muted cards). Closed sessions keep their name, folder, group, status and Claude conversation id, so the user can RESUME them later: clicking a closed card (or its "Resume" button / context menu item) restores it to its group, opens a tab, and runs `claude --resume <id>` (same conversation). Contract additions (orchestrator-owned): `Session.closedAt?: number` (epoch ms, present = closed), IPC `sessionClose` (kill + set closedAt) and `sessionReopen` (clear closedAt + start with resume). A closed session never auto-starts on app launch and is excluded from group counts and the status filter by default. A process that merely EXITS by itself stays in its group as "Exited" (it is not "closed"). Permanently deleting is separate: context menu "Remove session" (with confirm), also available on closed cards ("Delete"). Terminal below fills the rest (`bg #0a0a0a`-ish, no padding artifacts).
4. STATUS BAR (h 24px, 12px muted text, top border): left = active session folder + run state; right = sound toggle (icon button), attention count.
5. Dialogs (New session, Statuses editor, confirm) use the shadcn `dialog`, `input`, `select`, `button`, `label`, `switch`, with Orca's spacing/radius. Context menus use shadcn `context-menu`.
6. Typography: Geist 13px base for UI; terminal keeps Cascadia Code. Icons: lucide-react, 14-16px.

## Rules
- Copy Orca's real class strings and token values; do not invent colors. Where Orca has features we do not (git, worktrees, repos, PRs, tasks, automations, mobile, file panel), omit them.
- Keep our behavior, data model, IPC contract and tests working. The e2e script (`npm run e2e`) asserts text/roles: update its selectors when markup changes, keep it green.
- Accessibility kept (roles, aria-labels, focus ring).
- Verification: orchestrator takes screenshots via `npm run e2e` (scripts/e2e-screenshot.png) and compares them with `reference/orca/docs/assets/readme-hero.jpg`.

## Phases
A. Foundation: deps, Tailwind v4, tokens, Geist font, `lib/utils.ts` (cn), ported `ui/*` primitives, dark class, title bar overlay.
B. Shell: app layout, sidebar (nav, header, sections, session cards), tab bar, status bar, empty state. Reuse existing state/selectors/drag-drop logic.
C. Dialogs + menus restyle (new session, statuses editor, confirm, context menu, inline rename).
D. Visual QA loop against the reference screenshots; fix the diffs.

## Addendum 2026-10-13 (after first user test)
- Hub: main-area view (pinned "Hub" tab + sidebar nav item). Columns = "No status" + statuses in array order; cards open sessions; drag changes status; Closed sessions listed in a strip with Resume.
- Settings dialog (gear in the sidebar footer): Sound (per-event sound, volume, custom file, Test) and Statuses (add/rename/recolor/reorder/delete). Footer Tag button opens Settings on Statuses.
- Closing really kills the process tree (see HANDOFF).
