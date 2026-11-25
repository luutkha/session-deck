// Maps a session's run state, attention reason, sleep flag and activity to the icon shown on its tab,
// and builds the tab models.
import type { AgentKind, AttentionReason, Id, RuntimeState, Session, SessionActivity, SessionRun } from '../../shared/types'

export interface TabModel {
  readonly id: Id
  readonly title: string
  readonly run: SessionRun | null
  readonly attention: AttentionReason | null
  /** The pty exit code (any agent); rendered as "Exited (N)" when non-zero. */
  readonly exitCode?: number | null
  /** True while the session is asleep (its process is stopped; opening it resumes it). */
  readonly sleeping?: boolean
  /** What the agent is doing right now (working / needs-input / finished); absent = unknown. */
  readonly activity?: SessionActivity | null
  /** Which agent the session runs; present only for opencode or cursor (claude tabs stay unmarked). */
  readonly agent?: AgentKind
  /** True while Remote Control is active for the running session. */
  readonly remote?: boolean
  /** True when the session lives in a git worktree, so its side panel offers the Changes tab. */
  readonly worktree?: boolean
  /** D86: the worktree this session lives in; the tab shows its changed-files badge. */
  readonly worktreeId?: string
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
  bell: { colorClass: 'bg-[var(--attn-idle)]', pulse: true, label: 'Bell' },
  unread: { colorClass: 'bg-[var(--attn-idle)]', pulse: false, label: 'Marked unread' }
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
  attention: AttentionReason | null,
  exitCode: number | null = null
): TabIndicator {
  if (attention !== null) {
    return ATTENTION_INDICATORS[attention]
  }
  if (run === 'exited' && exitCode !== null && exitCode !== 0) {
    return { ...RUN_INDICATORS.exited, label: `Exited (${String(exitCode)})` }
  }
  return run === null ? UNKNOWN_INDICATOR : RUN_INDICATORS[run]
}

/** What the tab shows next to the title (working indicator plan): attention > sleeping > working > … */
export type TabVisual =
  | { readonly kind: 'attention'; readonly reason: AttentionReason }
  | { readonly kind: 'sleeping' }
  | { readonly kind: 'working' }
  | { readonly kind: 'needs-input' }
  | { readonly kind: 'dot'; readonly indicator: TabIndicator }

/**
 * The icon precedence for a tab: a session that needs you wins, then sleep, then the live "working"
 * spinner (the point of the feature), then an unanswered needs-input (an OpenCode question that raised no
 * permission hook), then the plain run-state dot exactly as before.
 */
export function tabVisualFor(input: {
  readonly run: SessionRun | null
  readonly attention: AttentionReason | null
  readonly exitCode?: number | null
  readonly sleeping?: boolean
  readonly activity?: SessionActivity | null
}): TabVisual {
  if (input.attention !== null) return { kind: 'attention', reason: input.attention }
  if (input.sleeping === true) return { kind: 'sleeping' }
  if (input.activity === 'working') return { kind: 'working' }
  if (input.activity === 'needs-input') return { kind: 'needs-input' }
  return { kind: 'dot', indicator: tabIndicatorFor(input.run, null, input.exitCode ?? null) }
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
      ...(state?.exitCode === undefined || state.exitCode === null ? {} : { exitCode: state.exitCode }),
      ...(state?.activity === undefined || state.activity === null ? {} : { activity: state.activity }),
      ...(sleeping ? { sleeping: true } : {}),
      ...(state?.remoteControl === true ? { remote: true } : {}),
      ...(session.worktreeId !== undefined ? { worktree: true, worktreeId: session.worktreeId } : {}),
      ...(session.agent === 'opencode' || session.agent === 'cursor' ? { agent: session.agent } : {})
    })
  }
  return models
}

/** Last path segment, for the status bar. Accepts Windows and POSIX separators. */
export function folderName(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter((part: string): boolean => part.length > 0)
  return parts[parts.length - 1] ?? cwd
}
