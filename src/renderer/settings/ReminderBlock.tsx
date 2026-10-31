// Reminders block on the Sound page (D44): repeat the alert while a needs-you session stays unread.
import { useEffect, useState, type ReactElement } from 'react'
import {
  MAX_REMINDER_MINUTES,
  MIN_REMINDER_MINUTES,
  type ReminderSettings,
  type SettingsPatch
} from '../../shared/types'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Switch } from '../components/ui/switch'
import { cn } from '../lib/utils'
import { parseReminderMinutes } from './reminderValidation'
import { errorMessage } from '../../shared/guards'

export interface ReminderBlockProps {
  readonly settings: ReminderSettings
  readonly onPatch: (patch: SettingsPatch) => Promise<unknown>
}

export function ReminderBlock({ settings, onPatch }: ReminderBlockProps): ReactElement {
  const [afterText, setAfterText] = useState<string>(String(settings.afterMinutes))
  const [afterError, setAfterError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect((): void => {
    setAfterText(String(settings.afterMinutes))
  }, [settings.afterMinutes])

  async function apply(patch: SettingsPatch): Promise<void> {
    setError(null)
    try {
      await onPatch(patch)
    } catch (err: unknown) {
      setError(errorMessage(err))
    }
  }

  function handleAfterMinutes(value: string): void {
    setAfterText(value)
    const parsed = parseReminderMinutes(value)
    if (parsed.minutes === null) {
      setAfterError(parsed.error)
      return
    }
    setAfterError(null)
    void apply({ reminder: { afterMinutes: parsed.minutes } })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="reminder-enabled" className="text-[13px] font-medium text-foreground">
          Repeat the alert while a session waits for me
        </Label>
        <Switch
          id="reminder-enabled"
          checked={settings.enabled}
          onCheckedChange={(checked: boolean): void => void apply({ reminder: { enabled: checked } })}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Plays the same sound and desktop notice again (and flashes the taskbar) while a session stays unread. The
        session on screen never reminds.
      </p>

      <div className={cn('flex flex-col gap-1', !settings.enabled && 'opacity-50')}>
        <Label htmlFor="reminder-after" className="text-[13px] font-medium text-foreground">
          Remind again after (minutes)
        </Label>
        <Input
          id="reminder-after"
          type="number"
          min={MIN_REMINDER_MINUTES}
          max={MAX_REMINDER_MINUTES}
          step={1}
          required
          value={afterText}
          disabled={!settings.enabled}
          aria-label="Remind again after (minutes)"
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

      {error !== null ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
