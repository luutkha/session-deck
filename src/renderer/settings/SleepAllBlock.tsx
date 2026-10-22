import { useEffect, useState, type ReactElement } from 'react'
import { MAX_SLEEP_MINUTES, MIN_SLEEP_MINUTES, type SettingsPatch, type SleepSettings } from '../../shared/types'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { parseSleepMinutes } from './sleepValidation'

export interface SleepAllBlockProps {
  readonly sleep: SleepSettings
  readonly onPatch: (patch: SettingsPatch) => Promise<void>
}

const SLEEP_ALL_LABEL = 'Sleep everything when idle'
const SLEEP_ALL_AFTER_LABEL = 'Sleep everything after (minutes)'
const SLEEP_ALL_HELP =
  'Puts every session to sleep, including the one on screen, once nothing is working or waiting for you and you have not typed or clicked in SessionDeck for this long. Sessions marked Keep awake and Remote Control sessions keep running.'

/** "Sleep everything when idle": a global idle timer, independent of the per-session "Sleep idle sessions" switch. */
export function SleepAllBlock({ sleep, onPatch }: SleepAllBlockProps): ReactElement {
  const [afterText, setAfterText] = useState<string>(String(sleep.allAfterMinutes))
  const [sleepError, setSleepError] = useState<string | null>(null)

  useEffect((): void => {
    setAfterText(String(sleep.allAfterMinutes))
  }, [sleep.allAfterMinutes])

  function handleAfterMinutes(value: string): void {
    setAfterText(value)
    const parsed = parseSleepMinutes(value)
    if (parsed.minutes === null) {
      setSleepError(parsed.error)
      return
    }
    setSleepError(null)
    void onPatch({ sleep: { allAfterMinutes: parsed.minutes } })
  }

  function handleEnabled(checked: boolean): void {
    void onPatch({ sleep: { allEnabled: checked } })
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="automation-sleep-all-enabled" className="text-[13px] font-medium text-foreground">
          {SLEEP_ALL_LABEL}
        </Label>
        <Switch
          id="automation-sleep-all-enabled"
          aria-label={SLEEP_ALL_LABEL}
          checked={sleep.allEnabled}
          onCheckedChange={handleEnabled}
        />
      </div>

      <div className={cn('flex flex-col gap-1', !sleep.allEnabled && 'opacity-50')}>
        <Label htmlFor="automation-sleep-all-after" className="text-[13px] font-medium text-foreground">
          {SLEEP_ALL_AFTER_LABEL}
        </Label>
        <Input
          id="automation-sleep-all-after"
          type="number"
          min={MIN_SLEEP_MINUTES}
          max={MAX_SLEEP_MINUTES}
          step={1}
          required
          value={afterText}
          disabled={!sleep.allEnabled}
          aria-label={SLEEP_ALL_AFTER_LABEL}
          aria-invalid={sleepError !== null}
          className="w-24 text-xs"
          onChange={(event): void => handleAfterMinutes(event.target.value)}
        />
        {sleepError !== null ? (
          <p role="alert" className="text-xs text-destructive">
            {sleepError}
          </p>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">{SLEEP_ALL_HELP}</p>
    </div>
  )
}
