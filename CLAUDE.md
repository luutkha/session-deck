# SessionDeck

Electron desktop app (an Orca-like, narrower tool) for running and managing many Claude Code and OpenCode sessions. Electron + electron-vite + React 19 + TypeScript strict + node-pty + xterm.js + Tailwind v4/shadcn. Windows first.

## Read first
1. `docs/DECISIONS.md`: what the user decided (product and working rules). Do not re-ask or undo these.
2. `HANDOFF.md`: current state of the code, per feature.
3. `docs/FEATURES.md`: the feature tree + matrices — find a feature's rules, code path and tests in one lookup.
4. `docs/CODEMAP.md`: which folder and file does what.
5. `docs/LESSONS.md`: gotchas that already cost time.
6. `DESIGN.md` (UI must look like Orca), `PLAN.md` (original architecture), `README.md` (run/test).

## Keep the knowledge base current (required)
- When the user decides something (picks an option, says yes/no to a feature, sets a rule), add it to `docs/DECISIONS.md` in the same turn, with their words.
- When a bug's cause was not obvious, add it to `docs/LESSONS.md`.
- When a feature ships, update its section in `HANDOFF.md` and its row in `docs/FEATURES.md`.
- When a folder or key file is added, moved or removed, update `docs/CODEMAP.md`.
- `AGENTS.md` points other agents (OpenCode workers) here; keep it in sync with this list.
- Commit these docs with the feature.

## Standing rules (details in DECISIONS.md)
- Show a plan and wait when the user asks for analysis or a plan.
- Verify in the real built app (CDP e2e in `scripts/`), not only unit tests. Never skip a failing test; find the root cause.
- Features must work on any PC and any folder.
- Claude sessions always run yolo. Git worktrees only in Code mode (D31); Ops mode never creates them.
- Commit after each finished feature (conventional commits). Rollback point: tag `baseline-2026-10-17`.
- Relaunch the app yourself after a change. Build the installer (`npm run dist`) only when the user asks.
- Delegated work uses cheap OpenCode models first (free, then flash, then deepseek-v4-pro).
- Never change the user's real `~/.claude` config from tests.

## Commands
- `npx vitest run` (unit), `npx tsc --noEmit -p tsconfig.web.json` and `-p tsconfig.node.json` (types)
- `npx electron-vite build` then `node scripts/e2e-<name>.cjs` (e2e against the built app)
- `npm run preview` (launch the app), `npm run dist` (installer in `release/`, only on request)

## Contract
`src/shared/types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts` are the IPC contract between main and renderer. Change them additively and on purpose.
