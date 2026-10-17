import { Fragment, type ReactElement } from 'react'
import type { Id, SessionUsage, UsageState, UsageWindow } from '../../shared/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  describeWindow,
  formatAgo,
  formatContext,
  formatCost,
  formatPercent,
  sessionUsageFor,
  usageLevel,
  type UsageLevel
} from './usageLogic'
import { PACE_WONT_HIT } from './usagePace'
import { UsageRefreshButton } from './UsageRefreshButton'

export interface UsageChipsProps {
  readonly state: UsageState
  readonly activeSessionId: Id | null
  readonly stale: boolean
  readonly now: number
  /** Manual refresh trigger. When absent, no refresh button renders (unchanged legacy behavior). */
  readonly onRefresh?: () => void
  readonly refreshing?: boolean
  readonly refreshError?: string | null
  /** Consent pieces; when absent the refresh button skips the consent gate. */
  readonly consented?: boolean
  readonly grantConsent?: () => void
  /** Burn-rate hints per window. When absent, no pace text renders. */
  readonly pace?: { readonly fiveHour: string; readonly sevenDay: string }
}

const WAITING_LABEL = 'Usage: waiting for a Claude turn'
const WAITING_TOOLTIP = 'Claude Code reports usage after each turn.'

function fillClass(level: UsageLevel): string {
  if (level === 'high') return 'bg-[var(--destructive)]'
  if (level === 'warn') return 'bg-[var(--status-warning)]'
  return 'bg-primary/70'
}

function textClass(level: UsageLevel): string {
  if (level === 'high') return 'text-[var(--destructive)]'
  if (level === 'warn') return 'text-[var(--status-warning)]'
  return ''
}

function widthPercent(percent: number): string {
  const clamped = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0
  return `${String(clamped)}%`
}

function WindowChip(props: {
  readonly label: string
  readonly longLabel: string
  readonly window: UsageWindow
  readonly now: number
  readonly updatedAt: number
  readonly stale: boolean
  readonly pace: string
  readonly showInlinePace: boolean
}): ReactElement {
  const { label, longLabel, window, now, updatedAt, stale, pace, showInlinePace } = props
  const level = usageLevel(window.usedPercentage)
  const sentence = describeWindow(longLabel, window, now, updatedAt)
  const tooltip = stale ? `${sentence} (stale)` : sentence
  const inlinePace =
    showInlinePace && window.usedPercentage >= 30 && pace !== '' && pace !== PACE_WONT_HIT
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={pace === '' ? tooltip : `${tooltip}. ${pace}`}
          className={cn('flex shrink-0 items-center gap-1.5', stale && 'opacity-60')}
        >
          <span className="text-muted-foreground">{label}</span>
          <span className="h-1 w-12 overflow-hidden rounded-full bg-muted">
            <span
              className={cn('block h-full rounded-full', fillClass(level))}
              style={{ width: widthPercent(window.usedPercentage) }}
            />
          </span>
          <span className="tabular-nums">{formatPercent(window.usedPercentage)}</span>
          {inlinePace ? (
            <span className="text-muted-foreground/70">{pace}</span>
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {pace === '' ? (
          tooltip
        ) : (
          <span className="flex flex-col gap-0.5">
            <span>{tooltip}</span>
            <span className="text-background/70">{pace}</span>
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

function describeSession(session: SessionUsage, now: number): string {
  const lines: string[] = []
  if (session.model !== null) lines.push(`Model: ${session.model}`)
  if (session.contextPercent !== null) lines.push(`Context: ${formatPercent(session.contextPercent)}`)
  if (session.costUsd !== null) {
    const cost = formatCost(session.costUsd)
    if (cost !== '') lines.push(`Cost: ${cost}`)
  }
  if (session.effort !== null) lines.push(`Effort: ${session.effort}`)
  const ago = formatAgo(now, session.updatedAt)
  if (ago !== '') lines.push(`Updated: ${ago}`)
  return lines.join(' · ')
}

function SessionChip(props: { readonly session: SessionUsage; readonly now: number }): ReactElement | null {
  const { session, now } = props
  const parts: ReactElement[] = []
  if (session.model !== null) {
    parts.push(<span key="model">{session.model}</span>)
  }
  if (session.contextPercent !== null) {
    const ctxText = formatContext(session.contextPercent)
    if (ctxText !== '') {
      const color = session.contextPercent >= 85 ? textClass(usageLevel(session.contextPercent)) : ''
      parts.push(
        <span key="ctx" className={color === '' ? undefined : color}>
          {ctxText}
        </span>
      )
    }
  }
  if (session.costUsd !== null) {
    const cost = formatCost(session.costUsd)
    if (cost !== '') parts.push(<span key="cost">{cost}</span>)
  }
  if (parts.length === 0) return null
  const sentence = describeSession(session, now)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="group" aria-label={sentence} className="flex shrink-0 items-center gap-1.5">
          {parts.map((part, index) => (
            <Fragment key={part.key}>
              {index > 0 ? <span aria-hidden="true">·</span> : null}
              {part}
            </Fragment>
          ))}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {sentence}
      </TooltipContent>
    </Tooltip>
  )
}

function WaitingChip(): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="img" aria-label={`${WAITING_LABEL}. ${WAITING_TOOLTIP}`} className="shrink-0">
          {WAITING_LABEL}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {WAITING_TOOLTIP}
      </TooltipContent>
    </Tooltip>
  )
}

/** Compact status-bar chips: plan-window usage + active session model/context/cost. */
export function UsageChips(props: UsageChipsProps): ReactElement {
  const { state, activeSessionId, stale, now, onRefresh, refreshing, refreshError, consented, grantConsent, pace } =
    props
  const account = state.account
  const hasAccountData =
    account !== null && (account.fiveHour !== null || account.sevenDay !== null)
  const session = sessionUsageFor(state, activeSessionId)

  return (
    <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
      {hasAccountData && account !== null ? (
        <>
          {account.fiveHour !== null ? (
            <WindowChip
              label="5h"
              longLabel="5-hour window"
              window={account.fiveHour}
              now={now}
              updatedAt={account.updatedAt}
              stale={stale}
              pace={pace?.fiveHour ?? ''}
              showInlinePace={true}
            />
          ) : null}
          {account.sevenDay !== null ? (
            <WindowChip
              label="Week"
              longLabel="7-day window"
              window={account.sevenDay}
              now={now}
              updatedAt={account.updatedAt}
              stale={stale}
              pace={pace?.sevenDay ?? ''}
              showInlinePace={false}
            />
          ) : null}
        </>
      ) : (
        <WaitingChip />
      )}
      {session !== null ? <SessionChip session={session} now={now} /> : null}
      {onRefresh !== undefined ? (
        <UsageRefreshButton
          onRefresh={onRefresh}
          refreshing={refreshing ?? false}
          refreshError={refreshError ?? null}
          consented={consented}
          grantConsent={grantConsent}
        />
      ) : null}
    </div>
  )
}
