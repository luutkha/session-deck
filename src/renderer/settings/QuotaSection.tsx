import { useEffect, useState, type ReactElement } from 'react'
import type {
  AppSettings,
  QuotaCriticalAction,
  QuotaResetAction,
  QuotaSettings,
  SettingsPatch
} from '../../shared/types'
import type { SessionActions } from '../state/useSessionStore'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  QUOTA_CRITICAL_MAX,
  QUOTA_CRITICAL_MIN,
  QUOTA_WARN_MAX,
  QUOTA_WARN_MIN,
  validateQuotaThresholds
} from './quotaValidation'
import { errorMessage } from '../../shared/guards'

export interface QuotaSectionProps {
  readonly settings: AppSettings
  readonly actions: Pick<SessionActions, 'updateSettings'>
}

const CRITICAL_OPTIONS: readonly { readonly value: QuotaCriticalAction; readonly label: string }[] = [
  { value: 'ask', label: 'Ask me' },
  { value: 'sleep', label: 'Sleep idle sessions automatically' },
  { value: 'nothing', label: 'Do nothing' }
]

const RESET_OPTIONS: readonly { readonly value: QuotaResetAction; readonly label: string }[] = [
  { value: 'ask', label: 'Ask me' },
  { value: 'wake', label: 'Wake them automatically' }
]

const AUTOPILOT_HELP =
  'Sleeping frees no quota by itself, it only stops idle sessions from starting new turns. Sessions marked Keep awake and Remote Control sessions are never slept. Busy sessions are never interrupted.'

function isCriticalAction(value: string): value is QuotaCriticalAction {
  return CRITICAL_OPTIONS.some((option) => option.value === value)
}

function isResetAction(value: string): value is QuotaResetAction {
  return RESET_OPTIONS.some((option) => option.value === value)
}

interface QuotaAutopilotFieldsProps {
  readonly quota: QuotaSettings
  readonly onPatch: (patch: SettingsPatch) => void
}

/** Quota autopilot (D30): what to do at the critical level and at the reset, and the continue-on-wake switch. */
function QuotaAutopilotFields({ quota, onPatch }: QuotaAutopilotFieldsProps): ReactElement {
  return (
    <div className={cn('flex flex-col gap-4', !quota.enabled && 'opacity-50')}>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="quota-critical-action" className="text-[13px] font-medium text-foreground">
          At the critical level
        </Label>
        <Select
          value={quota.criticalAction}
          disabled={!quota.enabled}
          onValueChange={(value: string): void => {
            if (isCriticalAction(value)) onPatch({ quota: { criticalAction: value } })
          }}
        >
          <SelectTrigger id="quota-critical-action" size="sm" className="w-full min-w-40 max-w-64 text-xs sm:w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {CRITICAL_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value} className="text-xs">
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="quota-reset-action" className="text-[13px] font-medium text-foreground">
          When the 5-hour window resets
        </Label>
        <Select
          value={quota.resetAction}
          disabled={!quota.enabled}
          onValueChange={(value: string): void => {
            if (isResetAction(value)) onPatch({ quota: { resetAction: value } })
          }}
        >
          <SelectTrigger id="quota-reset-action" size="sm" className="w-full min-w-40 max-w-64 text-xs sm:w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {RESET_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value} className="text-xs">
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="quota-continue-on-wake" className="text-[13px] font-medium text-foreground">
          Type “continue” where a turn was cut off by the limit
        </Label>
        <Switch
          id="quota-continue-on-wake"
          checked={quota.continueOnWake}
          disabled={!quota.enabled}
          onCheckedChange={(checked: boolean): void => onPatch({ quota: { continueOnWake: checked } })}
        />
      </div>

      <p className="text-xs text-muted-foreground">{AUTOPILOT_HELP}</p>
    </div>
  )
}

export function QuotaSection({ settings, actions }: QuotaSectionProps): ReactElement {
  const { quota } = settings
  const [warnText, setWarnText] = useState<string>(String(quota.warnAtPercent))
  const [criticalText, setCriticalText] = useState<string>(String(quota.criticalAtPercent))
  const [error, setError] = useState<string | null>(null)

  useEffect((): void => {
    setWarnText(String(quota.warnAtPercent))
    setCriticalText(String(quota.criticalAtPercent))
  }, [quota.warnAtPercent, quota.criticalAtPercent])

  const validation = validateQuotaThresholds(Number(warnText), Number(criticalText))

  async function applyPatch(patch: SettingsPatch): Promise<void> {
    setError(null)
    try {
      await actions.updateSettings(patch)
    } catch (err: unknown) {
      setError(errorMessage(err))
    }
  }

  function commitIfValid(nextWarnText: string, nextCriticalText: string): void {
    const warn = Number(nextWarnText)
    const critical = Number(nextCriticalText)
    if (validateQuotaThresholds(warn, critical).valid) {
      void applyPatch({ quota: { warnAtPercent: warn, criticalAtPercent: critical } })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="quota-enabled" className="text-[13px] font-medium text-foreground">
          Warn me when my plan usage gets high
        </Label>
        <Switch
          id="quota-enabled"
          checked={quota.enabled}
          onCheckedChange={(checked: boolean): void => void applyPatch({ quota: { enabled: checked } })}
        />
      </div>

      <div className={cn('flex flex-wrap gap-5', !quota.enabled && 'opacity-50')}>
        <div className="flex flex-col gap-1">
          <Label htmlFor="quota-warn" className="text-[13px] font-medium text-foreground">
            Warn at (%)
          </Label>
          <Input
            id="quota-warn"
            type="number"
            min={QUOTA_WARN_MIN}
            max={QUOTA_WARN_MAX}
            step={1}
            required
            value={warnText}
            disabled={!quota.enabled}
            aria-label="Warn at percent"
            aria-invalid={validation.warnError !== null}
            className="w-24 text-xs"
            onChange={(event): void => {
              const value = event.target.value
              setWarnText(value)
              commitIfValid(value, criticalText)
            }}
          />
          {validation.warnError !== null ? (
            <p role="alert" className="text-xs text-destructive">
              {validation.warnError}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="quota-critical" className="text-[13px] font-medium text-foreground">
            Critical at (%)
          </Label>
          <Input
            id="quota-critical"
            type="number"
            min={QUOTA_CRITICAL_MIN}
            max={QUOTA_CRITICAL_MAX}
            step={1}
            required
            value={criticalText}
            disabled={!quota.enabled}
            aria-label="Critical at percent"
            aria-invalid={validation.criticalError !== null}
            className="w-24 text-xs"
            onChange={(event): void => {
              const value = event.target.value
              setCriticalText(value)
              commitIfValid(warnText, value)
            }}
          />
          {validation.criticalError !== null ? (
            <p role="alert" className="text-xs text-destructive">
              {validation.criticalError}
            </p>
          ) : null}
        </div>
      </div>

      <Separator />

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="quota-notify-reset" className="text-[13px] font-medium text-foreground">
          Tell me when a usage window resets
        </Label>
        <Switch
          id="quota-notify-reset"
          checked={quota.notifyOnReset}
          onCheckedChange={(checked: boolean): void =>
            void applyPatch({ quota: { notifyOnReset: checked } })
          }
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Alerts use the sound chosen under Sound &gt; Quota warning and a desktop notification when
        enabled.
      </p>

      <Separator />

      <QuotaAutopilotFields quota={quota} onPatch={(patch: SettingsPatch): void => void applyPatch(patch)} />

      <Separator />

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="quota-show-opencode-go" className="text-[13px] font-medium text-foreground">
          Show OpenCode Go usage
        </Label>
        <Switch
          id="quota-show-opencode-go"
          checked={quota.showOpencodeGo}
          onCheckedChange={(checked: boolean): void =>
            void applyPatch({ quota: { showOpencodeGo: checked } })
          }
        />
      </div>

      <p className="text-xs text-muted-foreground">
        The OpenCode plugin reads the Go allowance from opencode.ai/zen/go/v1/usage. Your Go key stays
        inside OpenCode and never reaches SessionDeck; without a Go login no bars appear.
      </p>

      {error !== null ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
