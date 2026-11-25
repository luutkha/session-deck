# Backlog: features proposed on 2026-11-24, not built yet

The user asked ("Notes others feature to plan, to implement in feature") to keep the other ideas as plans. Numbers are the ones of the 2026-11-24 proposal. Sizes: S under an hour, M a few hours, L a night. "Needs you" = a product decision or a real account is involved; ask before building. Built ones are in FEATURES.md (D85/D86/D87).

## Review and git
| # | Idea | Size | Plan |
|---|------|------|------|
| 3 | Ask the agent to review / fix a hunk | M | Detached window gets a session picker (the `target` that annotations need); buttons "Review these changes" / "Fix this hunk" write a prompt with `ptyWrite` like the annotation Send. Reuse `formatAnnotationMessage`. |
| 5 | Open in editor at the line | M, needs you | Settings: editor (VS Code `code -g file:line`, Cursor `cursor -g`, IntelliJ `idea --line N file`); auto-detect with the diagnostics probe; new IPC `file:openInEditor` (main validates the path is inside the worktree). |
| 6 | Commit message suggestion | M, needs you | Spends model quota: run a short headless agent call on `git diff --stat` + diff head; ask the user which model/agent. |
| 8 | Diff against another branch/commit | M | `worktree:fileDiff` and `worktree:changes` take an optional base; UI: base picker in the header (default = merge-base as today). |
| 9 | Conflict view | L | Detect `git status` unmerged paths (`UU`), show a Conflicts group, three-pane or marker view, "mark resolved" = `git add`. |
| 16 | Archive/restore closed sessions | S | The "Closed" sidebar section already exists; add search + delete-forever + restore-all. |

## Sessions
| # | Idea | Size | Plan |
|---|------|------|------|
| 10 | Search across transcripts | L | `src/main/transcripts` exists: build an incremental index (per-file mtime), IPC `transcripts:search(query)`, results list in the palette. |
| 11 | Session templates | M | Presets exist (`presets/presetLogic.ts`); extend with first prompt + worktree flag. |
| 12 | Fork a session | M | New session with the same cwd/agent and `--resume <id> --fork-session` for Claude; for others start fresh with a summary prompt. |
| 13 | Cost/token dashboard | M | `main/usage` has the data; page with per-day/per-session bars. |
| 14 | Quota-aware queue | M | `main/quota` + `queue`: when a session hits its limit, hold its queue and resume at the reset time. Check what already exists first. |
| 17 | Export a session | M | Transcript to markdown/HTML through the `transcript.ts` reader; save dialog. |

## Jarvis
| # | Idea | Size | Plan |
|---|------|------|------|
| 18 | Morning brief | M | Digest tools exist (`digestTools.ts`); add a scheduled summary of "finished / failed / needs input" shown at start. |
| 20 | Push-to-talk | L, needs you | Web Speech or a local model: needs a decision on privacy and provider. |
| 21 | Confirm step for bulk actions | M, needs you | Jarvis plans exist (`planService.ts`): add a required approval for actions touching more than N sessions. |

## Reliability and quality
| # | Idea | Size | Plan |
|---|------|------|------|
| 22 | Crash recovery report | M | On start, if the last quit was not clean (`quitState.ts`), show what was running and offer restore (`launchResume` already knows). |
| 24 | CI for packaged build | M | GitHub workflow: `npm ci`, typechecks, `vitest run`, `electron-vite build`, `e2e:packaged` on Windows. Needs a workflow file and the user's OK to add CI. |
| 26 | Visual regression | L | `scripts/visual/*.png` exist; compare screenshots with a tolerance after each build and report diffs. |
| 27 | Accessibility pass | M | Keyboard order, labels, focus rings, reduced motion; check with axe in an e2e. |
| 28 | Replace polling with file watching | M | `useWorktreeChanges` polls every 10 s per worktree; watch `.git` index/HEAD + the worktree folder with a debounce, keep polling as fallback. |

## Workflow polish
| # | Idea | Size | Plan |
|---|------|------|------|
| 30 | Keyboard shortcut editor | M | A shortcut registry (today they are hard-coded) + a Settings page + conflict detection. |
| 31 | Notification rules | M | Per-session rules (idle, error, done) on top of `main/notify`; quiet hours. |
| 33 | Themes and font size | S | CSS variables already drive the look (DESIGN.md); expose font size and one alternate theme. |
| 34 | Drag a file onto a session | M | Drop handler on the terminal pane that types the quoted path (Claude `@path`). |

## Larger bets (all need the user)
35 Task board (cards linked to sessions/worktrees), 36 PR + CI status per worktree (GitHub auth, `gh`), 37 Remote/mobile read-only status page (security design first), 38 Plugin/extension API.
