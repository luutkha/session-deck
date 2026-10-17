import type { AppSettings, AutoStatusSettings, Id, Session, SessionActivity, StatusDef } from '../../shared/types'

export interface AutoStatusInput {
  readonly settings: AppSettings
  readonly statuses: readonly StatusDef[]
  readonly session: Session
  readonly activity: SessionActivity
}

function targetFor(auto: AutoStatusSettings, activity: SessionActivity): Id | null {
  switch (activity) {
    case 'working':
      return auto.working
    case 'needs-input':
      return auto.needsInput
    case 'finished':
      return auto.finished
  }
}

/**
 * Decides whether a session moves to another status because its activity changed.
 * Returns the status id to apply, or undefined to leave the session alone. Undefined when auto status is disabled,
 * the session is closed, the mapping is null, the mapped status does not exist, or the session already has it.
 */
export function decideAutoStatus(input: AutoStatusInput): Id | null | undefined {
  const { settings, statuses, session, activity } = input
  if (!settings.autoStatus.enabled) return undefined
  if (session.closedAt !== undefined) return undefined

  const target = targetFor(settings.autoStatus, activity)
  if (target === null) return undefined
  if (!statuses.some((status) => status.id === target)) return undefined
  if (target === session.statusId) return undefined

  return target
}
