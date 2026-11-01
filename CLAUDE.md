# SessionDeck

Electron desktop app (an Orca-like, narrower tool) for running and managing many Claude Code and OpenCode sessions, with Jarvis, an AI session that controls the app. Electron + electron-vite + React 19 + TypeScript strict + node-pty + xterm.js + Tailwind v4/shadcn. Windows first.

## Read first
1. `docs/DECISIONS.md`: what the user decided (product and working rules). Do not re-ask or undo these.
2. `HANDOFF.md`: one-page current state, known gaps, history.
3. `docs/IMPLEMENTATION.md`: how to build a change here — workflow, architecture rules, checklists, test standard, definition of done (W13).
4. `docs/FEATURES.md`: the feature tree + matrices — find a feature's rules, code path and tests in one lookup.
5. `docs/CODEMAP.md`: which folder and file does what.
6. `docs/LESSONS.md`: gotchas that already cost time, by topic.
7. `DESIGN.md` (UI must look like Orca), `README.md` (features, run, test). `PLAN.md` is the original v1 plan (historical).

## Keep the knowledge base current (required, details in IMPLEMENTATION.md §6)
- When the user decides something (picks an option, says yes/no to a feature, sets a rule), add it to `docs/DECISIONS.md` in the same turn, with their words.
- When a feature ships or changes, update `docs/FEATURES.md` and `HANDOFF.md`.
- When a folder or key file is added, moved or removed, update `docs/CODEMAP.md`.
- When a bug's cause was not obvious, add it to `docs/LESSONS.md`.
- Replace stale statements instead of appending contradictions. `AGENTS.md` mirrors this read-first list; keep them in sync.
- Commit these docs with the feature.

## Standing rules (details in DECISIONS.md)
- Show a plan and wait when the user asks for analysis or a plan.
- Verify in the real built app (CDP e2e in `scripts/`), not only unit tests. Never skip a failing test; find the root cause.
- Features must work on any PC and any folder.
- Claude sessions always run yolo. Git worktrees only in Code mode (D31); Ops mode never creates them.
- Commit after each finished feature (conventional commits). Rollback point: tag `baseline-2026-10-17`. Push only when asked.
- Relaunch the app yourself after a change. Build the installer (`npm run dist`) only when the user asks.
- Delegated work uses cheap OpenCode models first (free, then flash, then deepseek-v4-pro).
- Never change the user's real `~/.claude` config from tests.

## Commands
- `npx vitest run` (unit), `npx tsc --noEmit -p tsconfig.web.json` and `-p tsconfig.node.json` (types)
- `npx electron-vite build` then `node scripts/e2e-<name>.cjs` (e2e against the built app)
- `npm run preview` (launch the app), `npm run dist` (installer in `release/`, only on request), `npm run e2e:packaged` (test the packaged build)

## Contract
`src/shared/types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts` are the IPC contract between main and renderer. Change them additively and on purpose.
