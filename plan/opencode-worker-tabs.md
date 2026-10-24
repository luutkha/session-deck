# Plan: worker tabs for OpenCode sessions

Status: proposed, not implemented
Date: 2026-10-25
Feature owner: OpenCode worker

## 1. Goal

Any `opencode` process started from an OpenCode session (orchestrator, `!` shell
escape, a script, or by hand) appears as a read-only worker tab of that OpenCode
session, exactly like it does today for Claude and Shell sessions.

The parent OpenCode session must not be affected:

- no worker tab for the parent itself
- no busy/idle/status changes caused by workers
- no worker cost added to the parent's usage
- no worker `AgentSession` replacing the parent's `opencodeSessionId`

## 2. Non-goals

- OpenCode in-process subagents (`info.parentID` set) stay invisible. They are
  not separate processes and the existing worker plugin deliberately ignores
  them.
- `opencode --pure` (plugins disabled) stays invisible. Same limitation as the
  Claude implementation.
- Remote/SSH sessions.
- Changes to the worker tab UI. The existing read-only tab, auto-close and
  click-to-view behavior is reused unchanged.
- Per-session hook tokens. The current single local token is used by design.

## 3. Current behavior

- `src/main/app/startOptions.ts`
  - Claude: `envFor(id)` + `workerEnv()` -> `OPENCODE_CONFIG_CONTENT` with the
    worker plugin.
  - Shell: `workerEnv()` only.
  - OpenCode: `envFor(id)` + `opencodeEnv()` -> `OPENCODE_CONFIG_CONTENT` with
    only the session plugin (activity, status, cost, `AgentSession`).
- `src/main/attention/AttentionService.ts`
  - `opencodeEnv()` builds the session-plugin config.
  - `workerEnv()` builds the worker-plugin config for Claude/Shell.
- `src/main/workers/WorkerHub.ts` accepts a worker event from any known session.
  It does not know or care whether the owner is Claude, Shell or OpenCode.
- `HANDOFF.md:75` documents the current limit: "workers started from an OpenCode
  session inside the app are not covered."

## 4. Why simply adding `workerEnv()` to OpenCode is not enough

If an OpenCode session gets both plugins in `OPENCODE_CONFIG_CONTENT`:

1. The parent OpenCode process loads the worker plugin too. It reports its own
   top-level session as a worker -> a duplicate "worker" tab of the parent.
2. Every child worker process inherits the same config, so it also loads the
   session plugin. Its `AgentSession` can overwrite the parent's
   `opencodeSessionId`, and its busy/idle/cost events can move the parent card
   to Working/Review and add the worker's cost to the parent.

Both problems come from the same fact: the config is inherited by children and
there is no built-in "am I the parent process?" flag.

## 5. Design: owner-process handshake

Both plugins report a stable process id (`proc`). The app treats the first
process that reports for an OpenCode session as the owner (the parent OpenCode
process). Every other process for that session is a worker.

### 5.1 Process id

- Both the session plugin and the worker plugin use `String(process.pid)` as
  `proc`.
- The same process therefore produces the same `proc` from both plugins.
- The id is only used for routing/filtering inside one app run. It is not
  persisted.
- Pid reuse is theoretically possible, but owner/worker records are reset when
  the pty starts (see 5.5), and worker records live at most 30 minutes.

### 5.2 Worker plugin

- On plugin initialization, immediately post `{ kind: "hello" }`.
- Keep the existing 5 second `beat`.
- `hello` and `beat` carry only `proc` (no OpenCode session id).
- The parent process is therefore registered before it can create its own
  session or spawn a worker.

### 5.3 Owner registration in `WorkerHub`

Add a per-owner `ownerProcs` map.

On every accepted worker event for an owner:

```
if (isOpencodeSession(owner)) {
  ownerProc = ownerProcs.get(owner)
  if (ownerProc === undefined) {
    ownerProcs.set(owner, event.proc)   // parent hello is first
    ownerProc = event.proc
  }
  if (event.proc === ownerProc) return true  // parent self-report: accept, drop
}
```

- For Claude and Shell owners, `isOpencodeSession` is false, so behavior is
  unchanged: every process is a worker.
- `hello`/`beat` register the owner but never create a worker record.
- A child `start` with a different `proc` creates a normal worker record.

### 5.4 Filtering the session plugin

The session plugin adds `proc` to every request:

- `/hook/<id>/AgentSession` body: `{ session_id, proc }`
- `/hook/<id>/UserPromptSubmit` body: `{ proc }`
- `/hook/<id>/Stop` body: `{ proc }`
- `/hook/<id>/Notification` body: `{ message, proc }`
- `/statusline/<id>` body: `{ cost, model?, proc }`

The app ignores a session-plugin event when its `proc` is a worker process:

- `WorkerHub.isWorkerProc(owner, proc)` returns true when the owner is an
  OpenCode session, an owner proc is known, and `proc !== ownerProc`.
- `AttentionService` checks this before `AttentionManager` and before
  `onHookEvent`, so a child cannot raise attention, change activity/status,
  update the timeline, or change `opencodeSessionId`.
- The statusline callback checks the same thing before `usage.ingest`, so a
  child cannot add cost to the parent.

A child session plugin event can arrive before the child's own worker `hello`.
That is still filtered correctly: once the parent's `hello` set `ownerProc`, any
different `proc` is a worker by definition.

### 5.5 Reset on start

`WorkerHub` keeps the owner proc only for the lifetime of the pty process.

- Add `PtyManager.onStart(listener)` (mirrors `onExit`).
- In `index.ts`, subscribe:
  `pty.onStart((id) => workers.forgetSession(id))`.
- `forgetSession` also clears `ownerProcs`.
- This covers sleep/wake, manual restart, automatic fallback restart and a
  normal close/reopen.
- Reset on start (not on exit) avoids a race where an old process's exit event
  arrives after the new process already registered as owner.

### 5.6 Sequence

Parent OpenCode starts:

1. App injects both plugins and `SESSIONDECK_*`.
2. Worker plugin posts `hello` with `proc = P`.
3. `WorkerHub` records `P` as owner for this OpenCode session.
4. Session plugin posts `AgentSession` with `proc = P`; accepted.
5. Parent's worker plugin may report its own session; `proc = P`; accepted then
   dropped, so no self-tab.

A worker starts from the parent:

1. Child inherits the same config and env.
2. Child worker plugin posts `hello` with `proc = W`.
3. `WorkerHub` sees `W !== P`; it is a worker.
4. Child worker events create/update a worker tab.
5. Child session plugin events carry `proc = W`; ignored before attention,
   controller and usage.
6. Parent card and cost stay unchanged.

## 6. File-by-file changes

### `src/shared/types.ts`

- `HookEvent` gains `readonly proc?: string`.
- No renderer changes; the field is optional and only main uses it.

### `src/main/opencode/pluginEnv.ts`

- Generalize the config builder to accept multiple plugin paths:
  - `buildOpencodeConfigContent(pluginPaths: readonly string[], existing)`
  - `opencodePluginEnv(pluginPaths, existing)`
- Keep the existing merge semantics:
  - preserve every other field (`model`, `provider`, ...)
  - append missing plugin URLs without duplicates
  - merge `permission` and force `"*": "allow"`
  - unparseable/non-object config returned unchanged
- Put the worker plugin first, then the session plugin, so the parent's `hello`
  is sent as early as possible.
- Keep a thin single-plugin wrapper only if it keeps existing tests readable;
  otherwise update all call sites.

### `src/main/opencode/pluginSource.ts`

- Compute `var proc = String(process.pid)`.
- `postHook(event, body)` merges `proc` into every hook body.
- `syncUsage` adds `proc` to the statusline body.
- No need to send `oc` in busy/idle; proc filtering is sufficient.
- Keep all existing behavior for subagents, permissions and cost.

### `src/main/attention/HookServer.ts`

- Parse the optional `proc` field from hook bodies.
  - Validate: string, 1..64 chars.
  - Invalid/absent -> undefined, do not reject the event.
- Add it to the emitted `HookEvent`.
- Refactor the three body reads (`message`, `prompt`, `proc`) into one JSON parse
  while keeping the existing validation rules for each event.
- Statusline stays raw JSON; `AttentionService` reads `proc` from it.

### `src/main/attention/AttentionService.ts`

- `opencodeEnv()` uses both plugin paths:
  - worker plugin (first)
  - session plugin
  - throws if either file is missing (same as today)
- New dep: `isIgnoredProcess?: (sessionId: string, proc: string) => boolean`.
- `handleHook`:
  - if `event.proc !== undefined && isIgnoredProcess(event.sessionId, event.proc)`
    return before `attentionManager.handleHook` and before `onHookEvent`.
- Statusline wrapper:
  - read `proc` from the payload;
  - if present and ignored, return before `onStatusLine`.
- Keep Claude behavior unchanged: Claude hook bodies have no `proc`, so the
  predicate is never called.

### `src/main/workers/workerEvents.ts`

- Add `{ kind: 'hello'; proc: string }` to `WorkerEvent`.
- Parser accepts `hello` with only a valid `proc`.
- Keep all caps and validation.

### `src/main/workers/workerPluginSource.ts`

- `proc = String(process.pid)`.
- Post `hello` once, immediately after the `post` helper is defined and before
  the heartbeat interval.
- Keep `beat` every 5 seconds.
- Update the header comment: workers from Claude, Shell and OpenCode sessions.

### `src/main/workers/WorkerHub.ts`

- `WorkerHubDeps` gains `isOpencodeSession: (id: Id) => boolean`.
- Add `ownerProcs: Map<Id, string>`.
- `ingest`:
  - register/check owner as described in 5.3 before the `hello`/`beat` return;
  - drop events whose `proc` is the owner proc;
  - everything else unchanged.
- Add `isWorkerProc(owner, proc): boolean`.
- `forgetSession` deletes the owner proc.
- Update comments: "Claude, Shell or OpenCode owner".

### `src/main/app/startOptions.ts`

- No logic change: `opencodeEnv()` now returns the combined config.
- Update the comment on `buildOpencodeStartOptions`.

### `src/main/pty/PtyManager.ts`

- Add `onStart(cb: (id: Id) => void): () => void`.
- Emit after a successful spawn, before the first data event.
- Mirror the existing `onExit` listener set/dispose pattern.

### `src/main/index.ts`

- `createWorkerHub` deps:
  - `isOpencodeSession: (id) => store.get().sessions.some((s) => s.id === id && s.agent === 'opencode')`
- `createAttentionService` deps:
  - `isIgnoredProcess: (id, proc) => workers.isWorkerProc(id, proc)`
- After `workers` exists:
  - `pty.onStart((id) => workers.forgetSession(id))`
- Keep `onWorkerEvent` as `workers.ingest(sessionId, payload)`.

### Documentation

- `HANDOFF.md`
  - update the worker-tabs section: Claude, Shell and OpenCode owners;
  - remove the "workers started from an OpenCode session are not covered" limit;
  - note the owner-proc handshake and the new e2e.
- `docs/CODEMAP.md`
  - update the `workers/` and `opencode/` descriptions.
- `docs/DECISIONS.md`
  - extend D19 with a 2026-10-25 note: OpenCode sessions are covered; the owner
    is the first process that reports for the session; child session-plugin
    events are ignored by proc.
- `docs/LESSONS.md`
  - add: "Inherited config is loaded by both parent and children. Identify the
    parent by a first-report process id and filter child session-plugin events;
    reset on pty start, not exit."
- `README.md`
  - update the worker-tabs sentence if it names Claude only.
- `package.json`
  - add `e2e:opencode-workers`.

## 7. Tests

### Unit tests

1. `src/main/opencode/pluginEnv.test.ts`
   - both plugin URLs are present and deduplicated;
   - user fields (`model`, `provider`) survive;
   - permission merge keeps user rules and adds `"*": "allow"`;
   - unparseable/non-object config is returned unchanged;
   - worker plugin precedes session plugin.

2. `src/main/opencode/pluginSource.test.ts` (or the existing session-plugin test)
   - every hook body carries `proc`;
   - statusline carries `proc`;
   - subagent `session.created` still ignored;
   - cost/model behavior unchanged.

3. `src/main/workers/workerEvents.test.ts`
   - `hello` accepted with a valid proc;
   - `hello` rejected without/with an invalid proc;
   - existing kinds unchanged.

4. `src/main/workers/workerPlugin.test.ts`
   - the first post is `hello`;
   - `proc` is the process pid;
   - heartbeat still every 5 s;
   - no env -> no posts;
   - fetch failure still never throws.

5. `src/main/workers/WorkerHub.test.ts`
   - OpenCode owner: first hello registers owner; no worker record;
   - owner `start`/`beat` do not create a tab;
   - child `start` creates a tab;
   - `isWorkerProc` is true for a child proc, false for owner and unknown;
   - Claude owner: every proc is a worker (no owner filtering);
   - `forgetSession` clears the owner proc;
   - existing lost/trim/limit behavior unchanged.

6. `src/main/attention/HookServer.*.test.ts`
   - `proc` is parsed into `HookEvent`;
   - missing/invalid `proc` is ignored, event still accepted;
   - AgentSession/UserPromptSubmit/Stop/Notification all carry it;
   - existing validation and body caps unchanged.

7. `src/main/attention/AttentionService.test.ts`
   - an ignored proc does not call `AttentionManager` or `onHookEvent`;
   - an ignored statusline proc does not call `onStatusLine`;
   - an allowed/absent proc behaves as today;
   - `opencodeEnv()` contains both plugin URLs.

8. `src/main/pty/PtyManager.test.ts`
   - `onStart` fires once per successful start/restart;
   - unsubscribe stops it;
   - a failed spawn does not fire.

9. `src/main/app/sessionController.*.test.ts`
   - no change expected if reset is wired through `pty.onStart`; if a controller
     dep is used instead, cover sleep/wake/restart.

### Real-app e2e

1. `scripts/e2e-opencode.cjs` (extend)
   - after a normal turn, `window.api.getWorkers()` has no worker owned by the
     OpenCode session (no self-tab).
   - This proves the real parent loaded the worker plugin and the owner filter
     dropped its self-report.

2. New `scripts/e2e-opencode-workers.cjs`
   - launch with `SESSIONDECK_E2E_ENDPOINT_FILE`;
   - create a real OpenCode session on the free model and wait for its TUI;
   - send raw worker-plugin events with a distinct proc:
     - `hello`
     - `start` for `ses_e2e...`
     - `text`/`idle`
   - assert one read-only tab appears and is owned by the OpenCode session;
   - send raw session-plugin events with the same worker proc:
     - `AgentSession` with a different `ses_...`
     - `UserPromptSubmit`
     - `Stop`
     - a statusline cost
   - assert:
     - parent `opencodeSessionId` is unchanged;
     - parent activity/status is unchanged;
     - parent usage/cost did not change.
   - close the session and assert the worker tab is gone.
   - Add `e2e:opencode-workers` to `package.json`.

3. Regression
   - `npm run e2e:workers` (Claude owner) still passes.
   - `npm run e2e:opencode` still passes.
   - `npm run e2e:robust` still passes.

## 8. Verification sequence

1. `npx vitest run --reporter=dot` -> all green.
2. `npm run build` -> typecheck + build clean.
3. `npm run e2e:workers`
4. `npm run e2e:opencode`
5. `npm run e2e:opencode-workers`
6. `npm run e2e:robust`
7. Manual check in the real app:
   - create an OpenCode session;
   - ask it to run a child `opencode run ...` (or use the `!` shell escape);
   - one worker tab appears;
   - parent card stays on the correct status, cost does not jump;
   - no duplicate tab for the parent.
8. Relaunch the app with the new build (W08).
9. Commit the feature (W10) after green.

## 9. Acceptance criteria

- An OpenCode session shows worker tabs for child `opencode` processes.
- The parent OpenCode process never shows a worker tab for itself.
- Worker session-plugin events cannot change the parent's:
  - `opencodeSessionId`
  - activity (`working` / `needs-input` / `finished`)
  - auto status
  - attention/bell
  - usage/cost
- Claude and Shell worker behavior is unchanged.
- Sleep/wake and restart re-register the new parent process.
- Full unit suite, typecheck, build and the e2e suites above pass.
- Docs are updated in the same change.

## 10. Risks and open questions

- **Parent must be first.** The design relies on the parent's `hello` arriving
  before any worker event. This is causally guaranteed: the parent must be
  running to spawn a worker, and `hello` is posted at plugin initialization.
  If local HTTP drops the parent `hello`, the first child event could become the
  owner. Mitigation: the hook server is local and the worker plugin has a 2 s
  timeout with no retry; a missed hello is very unlikely. If it happens, a
  restart (pty start) resets the owner.
- **Pid reuse.** `proc` is the pid. A reused pid inside the same app run could
  confuse liveness. Owner/worker records are reset on pty start and finished
  workers are forgotten after 30 minutes, so the window is small.
- **`OPENCODE_CONFIG_CONTENT` unparseable.** Existing behavior returns the value
  unchanged, so neither plugin loads. This is already true for OpenCode sessions
  and is not made worse.
- **Plugin load order.** We put the worker plugin first, but correctness does
  not depend on OpenCode honoring order: the owner can also be registered by the
  parent's first `start` or `beat`. The `hello` is an optimization for timing.
- **e2e determinism.** The new e2e waits for the real OpenCode TUI before sending
  raw events. If the free model/TUI is slow, use a generous wait and fail with
  diagnostics rather than skipping.
- **Worker tabs on parent restart.** `forgetSession` on pty start clears any
  tabs from the previous process. That is intentional: those workers belonged to
  a dead parent.
