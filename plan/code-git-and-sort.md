# Plan: Code mode commit / push / PR (D60) + sort sessions (D61)

Status: shown 2026-11-08; answers: checkbox per file, no AI message, merge included, Hub follows the sort. Waiting for go. Two features, two commits. Sort ships first (smaller, both modes).

---

## Part A — Sort sessions (D61)

### Today
- Ops sidebar: sessions keep their manual drag order (`Session.order`) inside each group / folder bucket, or inside each status section.
- Code sidebar: sessions inside a worktree in creation order. Hub columns: manual order.
- No way to reorder by name, activity or attention.

### What the user gets
A **Sort** menu next to the existing filter menu (sidebar header), with:

| Sort | Order |
|---|---|
| Manual (default) | Today's drag order. Drag and drop works only here. |
| Needs attention | Needs you → working → finished → idle → sleeping → exited, then last active. |
| Last active | Most recent prompt / turn end / typing first. |
| Newest | `createdAt` descending. |
| Name A–Z | Natural sort (`session 2` before `session 10`), case-insensitive. |

- Sorting applies **inside each section** (group, folder bucket, status section, worktree). Groups, repos and worktrees keep their own order.
- Saved per mode (Ops and Code sort separately), in localStorage, same as group-by.
- While a non-manual sort is active, dragging a session shows a hint "Switch to Manual to reorder" instead of a broken drop. Dragging to another group / status still works (it changes the group / status, not the position).
- Keyboard ↑/↓ and Shift+click ranges follow the sorted on-screen order (`flatSessionIds`).
- "Needs attention" and "Last active" re-sort live, but a session does not jump while the mouse is over the list (re-sort on mouse leave), so clicks never land on the wrong card.
- Jarvis: `sidebar_view` gains `sort`.

### How
- `Session.lastActiveAt?: number` (additive, persisted). Set in main on: prompt sent (user Enter in the PTY / queue / broadcast), turn finished (Stop hook / OpenCode turn end). Throttled to one store write per session per 30 s. Missing → `createdAt`.
- Pure `sortSessions(sessions, mode, runtime)` in `renderer/state/sessionSort.ts`, used by `selectors.ts` sections, status sections, `codeTree.ts` and the Hub columns (user: Hub follows the same sort).
- Sort menu: `renderer/Sidebar/SortMenu.tsx` (shadcn dropdown, Orca look), pref in `sidebarPrefs.ts` with mode-scoped keys.

### Tests
- Unit: comparators (ties, missing `lastActiveAt`, natural names), attention ranking, throttling of `lastActiveAt`, prefs per mode, drag guard.
- e2e `scripts/e2e-sort.cjs`: 4 sessions; each sort gives the expected order in the sidebar DOM; keyboard order follows; setting survives restart; Code mode separate; Jarvis `sidebar_view sort`.

---

## Part B — Code mode: commit, push, PR (D60)

### Today
Changes panel shows the diff of a worktree vs its base. Nothing writes to git except `git worktree add`. Remove worktree leaves folder and branch on disk.

### What the user gets (all inside the Changes panel of a worktree)
1. **Commit box** at the top: message field + **Commit** (Ctrl+Enter). A checkbox per changed file, all on by default; only checked files are committed (`git add -- <files>` then `git commit -F <tempfile>`). The list refreshes after.
2. ~~Draft message~~ — not built: the user chose "No AI"; the user writes the message.
3. **Push**: `git push -u origin <branch>`. Shows "↑3 ↓0" ahead/behind. Disabled with no remote, with a reason in the tooltip. Never force-push.
4. **Create PR**:
   - `gh` installed and signed in → `gh pr create --base <base> --head <branch> --title … --body …`, then shows the PR link.
   - Otherwise (this PC has no `gh`) → opens the host's compare page in the browser: GitHub `…/compare/<base>...<branch>?expand=1`, GitLab `…/-/merge_requests/new?merge_request[source_branch]=…`, Bitbucket `…/pull-requests/new?source=…`. Unknown host → button hidden.
   - Pushes first if the branch is not on the remote yet.
5. **Merge into base** (user: "Yes, include"): in the repo folder, `git merge --no-ff <branch>`; refuses if the repo folder has uncommitted changes or a different branch checked out; on conflict runs `git merge --abort` and reports the files. Confirm dialog.
6. **Remove worktree** dialog gets "Also delete the folder and branch from disk" (off by default): `git worktree remove` then `git branch -d`; an unmerged branch asks again before `-D`. Never offered for the repo-folder workspace.

### Safety
- Every git call stays `execFile('git', …)` in `main/git/`, no shell; message via temp file; file paths re-validated against the current change list (same rule as file diff).
- Push / PR / merge / delete are confirmed in the UI; for Jarvis they go through the existing destructive-tool confirm.
- Git errors (no identity, hook failed, rejected push, auth) come back as readable text in the panel, never a crash.

### Jarvis
New tools: `commit_worktree` (message required), `push_worktree`, `create_pr`, `merge_worktree`, and `remove_worktree` gains `delete_from_disk`.

### Code / contract (additive)
- `main/git/`: `commit.ts`, `push.ts` (+ ahead/behind), `remoteHost.ts` (remote URL → host + compare URL, pure), `pullRequest.ts` (`gh` detection + create), `merge.ts`, `worktreeDelete.ts`.
- `shared/ipc.ts` + preload: `codeCommit`, `codePush`, `codeBranchStatus`, `codeCreatePr`, `codeMerge`; `removeWorktree` gets `deleteFromDisk`.
- Renderer: `code/changes/CommitBox.tsx`, `BranchActions.tsx`, checkboxes in `ChangeRow.tsx`.

### Tests
- Unit with real temp repos (`testRepo.ts`) and a local bare repo as `origin`: commit selected files only, empty message refused, no identity error text, push + ahead/behind, rejected push, compare URLs for https / ssh / GitLab / Bitbucket remotes, `gh` absent → URL path, merge clean / conflict-abort / dirty-refused, delete merged / unmerged branch.
- e2e `scripts/e2e-code-git.cjs` on the built app: worktree → edit file → commit 1 of 2 files → push to the bare origin → Create PR opens the compare URL (link open intercepted) → merge → remove with delete-from-disk; plus Jarvis `commit_worktree`.

---

## Docs to update with each commit
DECISIONS (D60/D61 final wording), FEATURES (NAV-12 sort, COD-12..16), CODEMAP (new files), HANDOFF, LESSONS if anything bites.
