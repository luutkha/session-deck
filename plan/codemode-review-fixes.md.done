# Plan: Code mode fixes from the read-only review (deepseek-v4-pro, 2026-10-25)

Status: proposed, waiting approval
Date: 2026-10-25
Feature: Code mode (D31, commit `be9be09`)
Review: `opencode-go/deepseek-v4-pro`, `-Agent plan`, read-only, 6 findings; every finding re-verified in source.

## 1. Goal

Fix the two real defects the review found (one HIGH, one MED) and the three cheap
line-level fixes, so Code mode survives a first hands-on test round.
Keep every accepted decision of D31 unchanged: no commit/merge/PR,
delete-from-disk stays out, built/skipped worktree handling stays as decided.

## 2. Findings (verified, not just reported)

| # | Sev | Where | What |
|---|-----|-------|------|
| 1 | HIGH | `src/renderer/code/dialogs/NewWorktreeSessionDialog.tsx:15` | Unfilled contract stub: `return null`. Wired in `WorkspaceDialogs.tsx:49`, reachable from the worktree row "+" (`useWorkspaceCommands.ts:61`) and "New session" with an active worktree session (`newSessionTarget.ts:18`). No dialog opens; a second session in an existing worktree is impossible. The e2e did not catch it because it only creates sessions via new worktrees. |
| 2 | MED | `src/main/app/codeWiring.ts:103-114` | `createWorktree` adds the worktree to store + disk, THEN starts the session. If the session fails (bad shell, missing pwsh) the worktree stays, sessionless, and with fix #1 not applied there was no way to add a session to it. |
| 3 | LOW | `src/main/git/branchName.ts` (no check) | Windows reserved device names (`aux`, `con`, `nul`, `com1`...) pass sanitization; the later `mkdir`/`worktree add` fails opaquely. Already listed as a known gap in HANDOFF. |
| 4 | LOW | `src/main/app/sessionController.ts:319-330` vs `ipcHandlers.ts:228` | `removeSessionNow` clears the controller's `activeId` but not the per-window `activeSessions` entry → the removed session stays the "on screen" id (ghost) until the next `session:setActive`; affects `isSessionOnScreen` and `sleepScheduler` focus checks. |
| 5 | LOW | `src/main/git/gitRunner.ts:35,80` | `GIT_ERROR_LINE` matches English only and no `LC_ALL` is set: a localized git error line is not picked up; the shown error can be a progress line ("Preparing worktree...") on non-English Windows. |
| 6 | LOW | `src/main/git/repoInfo.ts:57` + `codeWiring.ts:93` | Repo added at a drive root ⟶ `basename("D:\\")` = `""` ⟶ `addRepo` throws "Name required". Detectable but harmless. |

Cleared without changes (review + own re-check): branch sanitization cannot escape
the worktrees root (`..`, `a/b`, `--flag`, `AUX` handled or accepted-gap), bare and
linked-worktree folders rejected, file diff restricted to paths in the changes list,
all new IPC channels validated in main, pop-out window arg set only by main.

## 3. Fixes

### Fix A (HIGH) — implement `NewWorktreeSessionDialog` (one file, plus one test)

- Fill the stub using the already-frozen props (`worktree`, `settings`, `actions`,
  `onClose`, `onCreated`). No shared-contract change: main's
  `asCreateSessionInput` already accepts `worktreeId` (`ipcValidation.ts:149`).
- UI mirrors `NewWorktreeDialog`'s Orca look: `SessionAgentFields` (agent
  Claude/OpenCode/Shell + model with `checkModel`), no repo/name/branch inputs.
- Path hint line shows the worktree path (mono, muted, like `new-worktree-path`).
- Submit: `actions.createSession({ cwd: worktree.path, worktreeId: worktree.id,
  agent, model? })` → `onCreated(session.id)` → close. Default agent/model from
  `settings.agents`, same defaults as the Ops dialog.
- Errors via `cleanErrorMessage`; busy state while creating; Enter submits once.
- Test: extend `worktreeDialogLogic.test.ts` for the submit mapping (pure part),
  plus `scripts/e2e-codemode.cjs` gains a check: create worktree → close its
  session → "+" on the row → second session starts in it (now impossible before
  this fix, so the check would fail on the old build).

### Fix B (MED) — roll back a stranded worktree when its session fails

- In `createWorktree`'s catch (`codeWiring.ts:111-114`), before rethrowing:
  `store.removeWorktree(worktree.id)` (the session was never stored, so nothing
  else to stop) and `forget(worktree.id)`.
- Message becomes actionable: "The worktree could not be created: its session did not
  start (<reason>). Nothing was kept — files stay on disk."  Folder + branch remain on
  disk, same as manual Remove worktree (D31 wording). No delete-from-disk.
- Unit: `codeWiring` covered via `sessionController.code.test.ts`-style store
  fakes; new case: fake `controller.createSession` throws ⟶ worktree unknown after
  the call, error mentions the session reason.
- E2E: reuse the 31-check suite; the "bad shell" path is covered by the new unit
  case (no real missing-shell machine assert needed).

### Fix C (LOW, three one-liners, same commit or bundled)

1. `gitRunner.ts`: `LC_ALL: 'C'` in the child env (next to
   `GIT_TERMINAL_PROMPT: '0'`) so git messages are parseable English.
   Test: `gitRunner.test.ts` asserts the env contains `LC_ALL=C`.
2. `codeWiring.ts:93`: `path.basename(root) || repoFolderName(root)` — fallback name
   for a drive-root repo instead of "Name required" mid-dialog. Test in
   `codeReducers.test.ts` already covers the reject; add a wiring-level unit for
   `root: 'D:\\'` ⟶ name `repo` (the `repoFolderName` fallback).
3. `sessionController.ts`: `removeSessionNow` also clears the id from
   `activeSessions` (new injected dependency, already built in `index.ts:136`).
   Tests: `activeSessions.test.ts` gets `remove`-parity behavior; a controller
   test asserts the ghost id is gone after removal.

## 4. Non-goals (unchanged, by decision)

- Reserved-name mapping for worktree names stays a documented gap (HANDOFF
  "Known gaps") — a clear rejection message could be added later, not now.
- No commit/merge/PR/close-delete of worktrees; no `git worktree remove`.
- No review of Ops mode or other features; scope is the review's findings only.
- Installer stays stale; rebuild only on request.

## 5. Who does what (cost-first)

- Fixes A + B + C by me (small, integration-sensitive: dialog blob, callback
  wiring, env change) — no OpenCode worker needed; a worker would spend more
  context re-reading the mode shell than the edits are worth.
- After implementation: full verification round.

## 6. Verification (done-when)

```
npx vitest run                                   # all green, new tests included
npx tsc --noEmit -p tsconfig.web.json -p tsconfig.node.json
npx electron-vite build
npm run e2e          npm run e2e:close   npm run e2e:resume   npm run e2e:dialogs
npm run e2e:robust   npm run e2e:codemode                 # + new "second session" check
```

Then relaunch the real app and look at the new dialog once (screenshot), since it
is UI.

## 7. Commit

One conventional commit: `fix: Code mode review fixes (new-session dialog, worktree rollback, git locale)` with the doc updates (`HANDOFF.md` status line for D31, `docs/DECISIONS.md` if any choice above becomes a rule).
