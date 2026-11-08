# SessionDeck implementation standard

How to build a change in this codebase so it lands smoothly: the workflow, the architecture rules, a checklist per kind of change, the test standard and the definition of done. It is the "how"; `DECISIONS.md` is the "what the user wants", `FEATURES.md` the "what exists", `LESSONS.md` the "what already went wrong".

---

## 1. Workflow (every change)

1. **Understand the ask.** If the user asks for analysis or a plan, write the plan and STOP until they say go (W03). Otherwise act; ask only for decisions that are genuinely theirs (product choices), not for things the code or a sensible default answers.
2. **Record decisions first.** Any choice the user makes goes into `docs/DECISIONS.md` in the same turn, quoting their words (W12). Defaults you chose while building go into the same entry as "choices made while building (change on request)".
3. **Read before writing.** Find the feature in `FEATURES.md` (tree → matrix row → `Code` / `Tests` columns), read its `Rules`, then read the named files. Check `LESSONS.md` for the area.
4. **Design the slice** (section 2): which pure rules, which service, which wiring, which contract additions, which UI.
5. **Build bottom-up:** shared types → pure logic + unit tests → main service + tests → IPC contract → renderer logic + tests → UI.
6. **Verify for real** (section 5): typecheck both projects, unit suite, build, the feature's e2e against the built app, the neighbouring suites, a screenshot for UI work, a real Claude/OpenCode run when the feature depends on one.
7. **Document** (section 6) and **commit** one finished feature per commit (section 7).
8. **Relaunch the user's app** on the new build (W08). Build the installer only when asked (W09).

Small, verified steps beat one big change: commit each finished feature before starting the next.

---

## 2. Architecture rules

### 2.1 Layers

| Layer | Where | Rule |
|---|---|---|
| Contract | `src/shared/types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts` | Additive only, on purpose. Every new field is optional or has a default; every new channel is documented with a one-line comment (payload → result). |
| Shared pure helpers | `src/shared/*.ts` | No Node, no DOM. Used by both sides (e.g. `guards.ts`, `jarvisSchedule.ts`). |
| Main pure rules | `src/main/<area>/*.ts` without IO | Unit-tested in a sibling `*.test.ts`. |
| Main services | `create<Thing>(deps)` factories | All IO (fs, timers, child processes, network, other services) comes in through a `deps` object, so tests pass fakes. No module-level state. |
| Main wiring | `src/main/index.ts`, `app/*Wiring.ts`, `jarvis/jarvisWiring.ts` | Creates services, connects them, registers IPC, adds shutdown steps. Keep `index.ts` a list of wiring calls; put feature wiring in its own file. |
| Renderer pure logic | `src/renderer/<area>/*Logic.ts` | No React, DOM or IPC; unit-tested. |
| Renderer hooks | `use<Thing>.ts` | Own persistence, IPC calls and subscriptions. |
| Components | `*.tsx` | Render only; reuse `components/ui/*` (Orca/shadcn primitives) and the Orca tokens (D02). |

### 2.2 One path per action

- A user action, a palette command and a Jarvis tool must reach the **same** controller/store/service function. Never write a second implementation (example: `jarvisTools` calls `controller.sleepSession`, `codeWiring.removeWorktree`, `promptQueue` — exactly what the UI calls).
- Session lifecycle goes through `sessionController` (create, close, reopen, sleep, wake, restart, remove, fork). Live state lives in `runtimeRegistry`; persisted state in `SessionStore` (pure reducers in `store/reducers.ts`).
- Typing into a session: `controller.writeToPty`. Text and the submitting Enter are **separate writes** with a pause (`QUEUE_ENTER_DELAY_MS`); TUIs drop an Enter glued to other input (LESSONS: trust prompt).

### 2.3 Persistence

- Store fields: add to `Session`/`StoreData` (optional), set in the reducer, and parse in `store/persistence.ts` so an invalid value is **dropped**, never failing the whole file.
- Settings: a section in `AppSettings` with defaults in `DEFAULT_APP_SETTINGS` (section 3.2).
- Feature files under `<userData>`: own file per feature (`resume-on-launch.json`, `jarvis/schedules.json`), `{version: 1, ...}`, parse defensively (broken entries dropped), serialized writes.
- `localStorage` is for per-window UI conveniences only (widths, toggles, last tab), always wrapped in try/catch. A real setting that main reads lives in the store.

### 2.4 Security and safety defaults

- Validate every IPC payload in main (`app/ipcValidation.ts` helpers: `assertId`, `assertNonEmptyString`, `assertBoolean`, ...). Unknown keys are rejected. The renderer is not trusted.
- Local servers bind `127.0.0.1`, random port, per-run secret token, body size caps (`HookServer`, Jarvis `mcpHttpServer`).
- Child processes: `execFile`/`spawn` with argument arrays. Arguments that reach `cmd.exe` (session launch) are either validated by the safe-arg allow-list (user args) or produced by SessionDeck (trusted internal args); never interpolate user text into a shell string.
- Untrusted content (markdown, transcripts, terminal text, MCP arguments) is parsed defensively and never executed or rendered unsanitized (`DOMPurify` for markdown).
- Destructive actions that a user did not click directly (Jarvis) ask Yes/No in the app first.
- Never touch the user's real `~/.claude` or OpenCode config (W11). Per-session behaviour goes through SessionDeck's own `--settings` file, `--mcp-config`, or `OPENCODE_CONFIG_CONTENT`.

### 2.5 Windows-first

- Paths can contain spaces (`C:\Users\John Smith`) and can be 8.3 short names (`C:\Users\KHALT_~1`). Test with `e2e-spaces.cjs`.
- Files are CRLF in the working tree (git normalizes). When editing with scripts, keep the file's line ending.
- Kill whole process trees (`treeKiller`); a bare `conhost.exe` may outlive a session until quit.
- Features must work on any PC and any folder (W07): no machine-specific paths, no dependency on the user's own skills or scripts.

---

## 3. Checklists per kind of change

### 3.1 New IPC call
1. `src/shared/ipc.ts`: channel in `IPC` (with a comment `// (args) -> result: what (Dnn)`) and the method on `Api`.
2. `src/preload/index.ts`: `ipcRenderer.invoke` (events: `on`/`off` pair returning an unsubscribe).
3. Main handler in the owning wiring file; validate every argument.
4. Renderer: call it from a hook/action, not scattered across components.
5. Tests: validation unit test; e2e when the behaviour is visible.
6. Docs: `FEATURES.md` §3.1 / §3.2.

### 3.2 New setting
1. `types.ts`: field on the `*Settings` interface, default in `DEFAULT_APP_SETTINGS`, `SettingsPatch`, `resolveSettings`.
2. A new SECTION also needs: `SETTINGS_SECTIONS`, `FIELD_CHECKS`, `parseStoredSettings`, `updateSettings` (`main/store/settings.ts`) and `asSettingsPatch` (`main/app/settingsValidation.ts`).
3. Range/allowed-value rule in `settingsProblem`; a value that reaches a command line gets a strict character allow-list.
4. UI control in `renderer/settings/*Section.tsx` through `actions.updateSettings`; validate input before saving.
5. Tests: `settings.test.ts` (default for an old stored file, accepted values, rejected values); update the "complete valid settings object" test.
6. Docs: `FEATURES.md` §3.6.

### 3.3 New store field on a session
1. Optional field on `Session` (and `CreateSessionInput` only if creation sets it; if only main may set it, keep it out of `ALLOWED_CREATE_SESSION_KEYS`).
2. Reducer sets it; `persistence.ts` parses it (drop invalid).
3. Tests: reducer + persistence round trip + "invalid value dropped".

### 3.4 New main-process service
1. `create<Thing>(deps)`; deps include clocks (`now`, `setTimeout`/`setInterval`), file IO and `onError`.
2. Pure rules in a separate file with their own tests.
3. Wire it in `index.ts` or a feature wiring file; add a `runShutdownStep` for timers/servers/files.
4. Errors go to `logMainError` (`main-errors.log`), never to an uncaught throw or a native dialog.

### 3.5 New UI
1. Look: copy Orca class strings and tokens (`DESIGN.md`); icons from `lucide-react`; dark theme tokens only, no invented colours.
2. Accessibility: roles, `aria-label`, `aria-pressed` for toggles, keyboard reachable, focus returns sensibly.
3. Test hooks: add `data-*` attributes for e2e selectors (`data-jarvis-toggle`, `data-schedule-id`); never select by text that may change or by `aside`.
4. Mode awareness: Ops vs Code (`dataForMode`, `modeStorageKeys`). Things that must exist in both modes and survive a mode switch are mounted in `App.tsx`, outside `ModeWorkspace` (Jarvis panel).
5. Terminals: one xterm per session, never unmounted; a hidden terminal keeps its size (slide/`invisible`, not `display:none`).
6. Screenshot it (`E2E_SHOT_DIR`) and look at it before reporting.

### 3.6 New Jarvis tool (D53/D54)
1. Add it to `main/jarvis/jarvisTools.ts`: `name`, a description written for the model (what, when, what it returns), a JSON schema (`schema({...}, required)`), `run`.
2. Resolve targets with `targets.ts` (`resolveSession`, `resolveGroup`, `resolveStatus`); never act on Jarvis itself; ambiguous names are errors that list candidates.
3. Call the same controller/store/service path as the UI (section 2.2). New dependencies go into `JarvisToolDeps` and are wired in `index.ts` / `jarvisWiring.ts`.
4. Destructive → `deps.confirm({...})` first. Reversible → `pushUndo(label, inverse)`. Every action → `deps.log(tool, detail)`.
5. Return short, factual text; throw an `Error` with a plain message for a failed call (shown to the model with `isError`).
6. The system prompt lists tools automatically (`jarvisSystemPrompt(toolNames)`); add a "How to work" line only for a new usage pattern.
7. Tests: `jarvisTools.test.ts` with the fakes in `setup()`; extend `e2e-jarvis.cjs` (it asserts the tool count — update it).

### 3.7 New agent, launch argument or session kind
1. Launch options live in `main/app/startOptions.ts`; special sessions add to their launch through `SessionControllerDeps.launchExtras` (`{ claudeArgs }` or `{ opencodeConfig }`), not by special-casing the controller.
2. Claude: internal args are trusted, user args are allow-listed. OpenCode: no CLI `--model` (it prints help and exits); everything goes into `OPENCODE_CONFIG_CONTENT` through `applyConfigPatch`; launch with `--standalone`.
3. Verify against the real CLI version on the machine before relying on a flag (`claude --help`, `opencode <cmd> --help`), and write the version into the code comment.

### 3.8 New main-area view (like Hub or Grid)
1. Extend `MainView` in `renderer/mode/viewPref.ts`; `parseView` must still fall back safely for old stored values.
2. Per-mode keys only if the view has its own persisted state (`modeStorageKeys`).
3. Pure logic module + tests first (mirror `split/splitLogic.ts`, `grid/gridLogic.ts`), then a hook (mirror `useSplitLayout.ts` / `useGridLayout.ts`), rendered from `ModeWorkspace.tsx`.
4. Terminals stay in the one registry (`useTerminalPanes` hoisted in `ModeWorkspace`), drawn by `TerminalWorkspace`.
5. A tab-bar control and a palette item; focus requests (sidebar, tray, notification) must land sensibly in the view.
6. An e2e suite and, ideally, a state in `e2e-visual.cjs`.

---

## 4. Code style

- TypeScript strict; `readonly` on interface fields and arrays; explicit return types on exported functions and React callbacks (match the surrounding file).
- Immutable updates (reducers return new objects).
- Small files (< ~400 lines where practical) with one job; a header comment says what the file does and which decision it belongs to (`// ... (D53)`).
- Comments explain WHY (a constraint, a verified behaviour, a past bug), not what the next line does.
- Names say what things are (`isReadyForPrompt`, `waitUntilReady`); constants in `UPPER_SNAKE` with their unit (`_MS`, `_S`, `_MAX`).
- Reuse `src/shared/guards.ts` (`isRecord`, `errorMessage`) instead of local copies.

---

## 5. Testing standard

### 5.1 Unit (Vitest)
- Sibling `*.test.ts` for every pure module and service. Inject fakes through deps; fake timers only after imports (`vi.useFakeTimers()` inside the test, restored in `finally`).
- Test files must not live under the OS temp dir (Vitest cannot import from there); temp test dirs go under `process.cwd()`.
- A test that cannot run in the environment reports SKIP (`context.skip()`), never an early `return`.

### 5.2 E2E against the built app (`scripts/e2e-*.cjs`)
- Always `npx electron-vite build` first; each suite uses `launchApp({ port })` from `e2e-lib.cjs` with a **temp user-data dir** and its **own CDP port** (never reuse a port another suite uses).
- Drive the UI like a user: CDP mouse/keyboard events (`Input.dispatchMouseEvent` / `dispatchKeyEvent`), `scrollIntoView` before clicking, `data-*` selectors, await state with `waitFor` (never fixed sleeps as assertions).
- Read terminal output from `window.api.ptyReplay` (the terminal draws with WebGL; there is no DOM text).
- Fake external programs on PATH (`claude.cmd` + a node stub) when the real tool would change user state or cost money; but re-check the real tool when its version changes.
- Test seams are env vars read only by the app (`SESSIONDECK_E2E_ENDPOINT_FILE`, `SESSIONDECK_VOICE_WAV`, `SESSIONDECK_E2E_OPENED_URLS_FILE`, `SESSIONDECK_E2E_NO_GH`) and are inert when unset.
- Real-Claude suites (`*-real.cjs`, `e2e.cjs`, `e2e-bell`, `e2e-notes-usage`) cost the user's plan: keep prompts tiny, say so in the file header, prefer OpenCode free models (`opencode/deepseek-v4.1-flash-free`) when the agent does not matter.
- Every suite cleans up the sessions it made and kills the app in `finally`.

### 5.3 Judging a failure
- Never skip a failing test; find the root cause (W05, W06). Reproduce, fix, show it going from failing to passing.
- Rerun a failing **real-agent or timing** check alone before calling it a regression; do not run the full unit suite and e2e suites at the same time. Report which checks were rerun and their results.
- When a fake passes but the real program fails, the fake is wrong: fix the fake to match the real behaviour.

### 5.4 What to run
- Always: `npx tsc --noEmit -p tsconfig.node.json`, `npx tsc --noEmit -p tsconfig.web.json`, `npx vitest run`, the feature's e2e.
- Plus the suites of the areas the change touched (`FEATURES.md` §3.7 maps scripts to features). Before an installer: `npm run dist`, `npm run e2e:packaged`, `EXE=<release exe> node scripts/e2e-spaces.cjs`.

---

## 6. Documentation (same commit as the code)

| When | Update |
|---|---|
| The user decides something | `docs/DECISIONS.md` (their words, date, `Dnn`) |
| A feature ships or changes | `docs/FEATURES.md` (tree, matrix row, maps §3, invariants §5, gaps §6) and the "Recent work" part of `HANDOFF.md` |
| A file or folder is added/moved/removed | `docs/CODEMAP.md` |
| A bug's cause was not obvious | `docs/LESSONS.md` (in the topic section) |
| A new npm script or e2e | `package.json` scripts, `FEATURES.md` §3.7 |
| The read-first list changes | `CLAUDE.md` and `AGENTS.md` together |

Keep docs factual and current: replace stale statements instead of appending contradictions; dated history belongs in `HANDOFF.md` "History" and git, not in the reference docs.

---

## 7. Commits

- Conventional commits on `main`: `feat(area): ...`, `fix(area): ...`, `test: ...`, `docs: ...`, `refactor: ...`. One finished feature (code + tests + docs) per commit; a bug found on the way gets its own `fix:` commit.
- Body: what and why, then `Verified:` with the exact suites and counts.
- End with the attribution lines from the session instructions.
- Push only when the user asks.

---

## 8. Definition of done

- [ ] Decision recorded (if any) and the plan approved (if one was asked for).
- [ ] Contract changes additive; IPC validated in main.
- [ ] Pure logic unit-tested; services tested with fakes.
- [ ] Both typechecks clean; full unit suite green on a quiet machine.
- [ ] Feature e2e green against the built app; neighbouring suites green (real-agent ones rerun alone if they timed out).
- [ ] Screenshot looked at for UI work; works in Ops and Code where it applies.
- [ ] Works on any PC: no machine paths, paths with spaces OK, no user config touched.
- [ ] Docs updated in the same commit; committed.
- [ ] The user's app relaunched on the new build; the report says what changed, what was verified (with counts), and anything skipped or left open.
