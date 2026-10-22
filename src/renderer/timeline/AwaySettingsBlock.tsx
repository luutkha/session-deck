// The Away summary settings (General section): on/off and the minutes before the user counts as away.
import { useEffect, useState, type ReactElement } from 'react'
import { MAX_SLEEP_MINUTES, MIN_SLEEP_MINUTES, type AwaySettings, type SettingsPatch } from '../../shared/types'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Switch } from '../components/ui/switch'
import { cn } from '../lib/utils'
import { parseSleepMinutes } from '../settings/sleepValidation'

export interface AwaySettingsBlockProps {
  readonly settings: AwaySettings
  readonly onPatch: (patch: SettingsPatch) => Promise<void>
}

export function AwaySettingsBlock({ settings, onPatch }: AwaySettingsBlockProps): ReactElement {
  const [afterText, setAfterText] = useState<string>(String(settings.afterMinutes))
  const [afterError, setAfterError] = useState<string | null>(null)

  useEffect((): void => {
    setAfterText(String(settings.afterMinutes))
  }, [settings.afterMinutes])

  function handleAfterMinutes(value: string): void {
    setAfterText(value)
    const parsed = parseSleepMinutes(value)
    if (parsed.minutes === null) {
      setAfterError(parsed.error)
      return
    }
    setAfterError(null)
    void onPatch({ away: { afterMinutes: parsed.minutes } })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="general-away-enabled" className="text-[13px] font-medium text-foreground">
          {'Show "While you were away"'}
        </Label>
        <Switch
          id="general-away-enabled"
          checked={settings.enabled}
          onCheckedChange={(checked: boolean): void => void onPatch({ away: { enabled: checked } })}
        />
      </div>

      <div className={cn('flex flex-col gap-1', !settings.enabled && 'opacity-50')}>
        <Label htmlFor="general-away-after" className="text-[13px] font-medium text-foreground">
          Away after (minutes)
        </Label>
        <Input
          id="general-away-after"
          type="number"
          min={MIN_SLEEP_MINUTES}
          max={MAX_SLEEP_MINUTES}
          step={1}
          required
          value={afterText}
          disabled={!settings.enabled}
          aria-label="Away after (minutes)"
          aria-invalid={afterError !== null}
          className="w-24 text-xs"
          onChange={(event): void => handleAfterMinutes(event.target.value)}
        />
        {afterError !== null ? (
          <p role="alert" className="text-xs text-destructive">
            {afterError}
          </p>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        When you come back after this long without typing or clicking in SessionDeck, a summary shows
        what finished, what needs you and what it cost.
      </p>
    </div>
  )
}
