// Maps a session's run state and attention reason to the dot shown on its tab, and builds the tab models.
import type { AgentKind, AttentionReason, Id, RuntimeState, Session, SessionRun } from '../../shared/types'

export interface TabModel {
  readonly id: Id
  readonly title: string
  readonly run: SessionRun | null
  readonly attention: AttentionReason | null
  /** True while the session is asleep (its process is stopped; opening it resumes it). */
  readonly sleeping?: boolean
  /** Which agent the session runs; present only for opencode (claude tabs stay unmarked). */
  readonly agent?: AgentKind
  /** True while Remote Control is active for the running session. */
  readonly remote?: boolean
}

export interface TabIndicator {
  readonly colorClass: string
  readonly pulse: boolean
  readonly label: string
}

// Attention colours are the same CSS variables the sidebar uses (styles/orca-theme.css).
const ATTENTION_INDICATORS: Readonly<Record<AttentionReason, TabIndicator>> = {
  permission: { colorClass: 'bg-[var(--attn-permission)]', pulse: true, label: 'Needs permission' },
  done: { colorClass: 'bg-[var(--attn-done)]', pulse: true, label: 'Finished' },
  idle: { colorClass: 'bg-[var(--attn-idle)]', pulse: true, label: 'Waiting for input' },
  bell: { colorClass: 'bg-[var(--attn-idle)]', pulse: true, label: 'Bell' }
}

const RUN_INDICATORS: Readonly<Record<SessionRun, TabIndicator>> = {
  running: { colorClass: 'bg-status-success', pulse: false, label: 'Running' },
  exited: { colorClass: 'bg-destructive', pulse: false, label: 'Exited' }
}

const UNKNOWN_INDICATOR: TabIndicator = {
  colorClass: 'bg-muted-foreground',
  pulse: false,
  label: 'Not started'
}

/** Attention wins over the run state: a finished or waiting session should be noticed first. */
export function tabIndicatorFor(
  run: SessionRun | null,
  attention: AttentionReason | null
): TabIndicator {
  if (attention !== null) {
    return ATTENTION_INDICATORS[attention]
  }
  return run === null ? UNKNOWN_INDICATOR : RUN_INDICATORS[run]
}

/** Number of live sessions that currently need attention (used by the status bar). */
export function countAttention(
  states: ReadonlyMap<Id, RuntimeState>,
  liveIds: ReadonlySet<Id>
): number {
  let count = 0
  for (const [id, state] of states) {
    if (liveIds.has(id) && state.attention !== null) {
      count += 1
    }
  }
  return count
}

/** The open tabs in their order, joined with the session name and runtime state. Unknown ids are skipped. */
export function buildTabModels(
  openIds: readonly Id[],
  sessions: readonly Session[],
  states: ReadonlyMap<Id, RuntimeState>
): readonly TabModel[] {
  const byId = new Map<Id, Session>(sessions.map((session: Session): [Id, Session] => [session.id, session]))
  const models: TabModel[] = []
  for (const id of openIds) {
    const session = byId.get(id)
    if (session === undefined) {
      continue
    }
    const state = states.get(id)
    const sleeping = state?.sleeping === true
    models.push({
      id,
      title: session.name,
      run: state?.run ?? null,
      attention: state?.attention ?? null,
      ...(sleeping ? { sleeping: true } : {}),
      ...(state?.remoteControl === true ? { remote: true } : {}),
      ...(session.agent === 'opencode' ? { agent: 'opencode' as const } : {})
    })
  }
  return models
}

/** Last path segment, for the status bar. Accepts Windows and POSIX separators. */
export function folderName(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter((part: string): boolean => part.length > 0)
  return parts[parts.length - 1] ?? cwd
}
