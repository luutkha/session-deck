import { useEffect, useState, type ReactElement } from 'react'
import type { AppSettings, SettingsPatch } from '../../shared/types'
import type { SessionActions } from '../state/useSessionStore'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

export interface QuotaSectionProps {
  readonly settings: AppSettings
  readonly actions: Pick<SessionActions, 'updateSettings'>
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
      setError(toMessage(err))
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

      {error !== null ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
