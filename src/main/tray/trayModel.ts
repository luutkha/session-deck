import type { AttentionReason, SessionRun } from '../../shared/types'

export const MAX_TRAY_ATTENTION_ITEMS = 8
export const APP_NAME = 'SessionDeck'

export interface TraySessionInput {
  readonly id: string
  readonly name: string
  readonly attention: AttentionReason | null
  /** Informational; attention is listed regardless of the run state. */
  readonly run: SessionRun
}

export interface TrayModelInput {
  readonly sessions: readonly TraySessionInput[]
  /** Informational. The "Show" entry keeps the same label in both states. */
  readonly windowVisible: boolean
}

export type TrayItem =
  | { readonly kind: 'action'; readonly id: 'show' | 'quit'; readonly label: string }
  | { readonly kind: 'session'; readonly sessionId: string; readonly label: string }
  | { readonly kind: 'separator' }
  | { readonly kind: 'header'; readonly label: string }

export interface TrayModel {
  readonly tooltip: string
  readonly hasAttention: boolean
  readonly items: readonly TrayItem[]
}

const REASON_SUFFIX: Readonly<Record<AttentionReason, string>> = {
  permission: 'permission',
  done: 'finished',
  idle: 'idle',
  bell: 'bell'
}

type NeedingSession = TraySessionInput & { readonly attention: AttentionReason }

function needsAttention(session: TraySessionInput): session is NeedingSession {
  return session.attention !== null
}

/** Pure tray menu and tooltip for the current sessions. */
export function buildTrayModel(input: TrayModelInput): TrayModel {
  const needing = input.sessions.filter(needsAttention)
  const hasAttention = needing.length > 0

  const sessionItems: TrayItem[] = needing
    .slice(0, MAX_TRAY_ATTENTION_ITEMS)
    .map((s): TrayItem => ({
      kind: 'session',
      sessionId: s.id,
      label: `${s.name} - ${REASON_SUFFIX[s.attention]}`
    }))

  const tooltip = hasAttention
    ? `${APP_NAME} - ${needing.length} need attention`
    : APP_NAME

  const items: readonly TrayItem[] = [
    { kind: 'action', id: 'show', label: `Show ${APP_NAME}` },
    { kind: 'separator' },
    { kind: 'header', label: 'Needs attention' },
    ...sessionItems,
    { kind: 'separator' },
    { kind: 'action', id: 'quit', label: `Quit ${APP_NAME}` }
  ]

  return { tooltip, hasAttention, items }
}
