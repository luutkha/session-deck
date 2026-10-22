import { useEffect, useState, type ReactElement } from 'react'
import {
  MAX_SLEEP_MINUTES,
  MIN_SLEEP_MINUTES,
  type AppSettings,
  type Id,
  type StatusDef
} from '../../shared/types'
import type { SessionActions } from '../state/useSessionStore'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { parseSleepMinutes } from './sleepValidation'
import { SleepAllBlock } from './SleepAllBlock'

export interface AutomationSectionProps {
  readonly settings: AppSettings
  readonly statuses: readonly StatusDef[]
  readonly actions: Pick<SessionActions, 'updateSettings'>
}

type AutoField = 'working' | 'needsInput' | 'finished'

interface AutoRow {
  readonly field: AutoField
  readonly label: string
}

const NO_CHANGE = '__none__'

const AUTO_ROWS: readonly AutoRow[] = [
  { field: 'working', label: 'While Claude is working' },
  { field: 'needsInput', label: 'When Claude needs permission or input' },
  { field: 'finished', label: 'When Claude finishes' }
]

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function AutomationSection({
  settings,
  statuses,
  actions
}: AutomationSectionProps): ReactElement {
  const [error, setError] = useState<string | null>(null)
  const [sleepError, setSleepError] = useState<string | null>(null)
  const { autoStatus, sleep } = settings
  const [afterText, setAfterText] = useState<string>(String(sleep.afterMinutes))

  useEffect((): void => {
    setAfterText(String(sleep.afterMinutes))
  }, [sleep.afterMinutes])

  async function applyPatch(patch: Parameters<SessionActions['updateSettings']>[0]): Promise<void> {
    setError(null)
    try {
      await actions.updateSettings(patch)
    } catch (err: unknown) {
      setError(toMessage(err))
    }
  }

  function handleSelect(field: AutoField, value: string): void {
    const statusId: Id | null = value === NO_CHANGE ? null : value
    void applyPatch({ autoStatus: { [field]: statusId } })
  }

  function handleSleepMinutes(value: string): void {
    setAfterText(value)
    const parsed = parseSleepMinutes(value)
    if (parsed.minutes === null) {
      setSleepError(parsed.error)
      return
    }
    setSleepError(null)
    void applyPatch({ sleep: { afterMinutes: parsed.minutes } })
  }

  function handleSleepEnabled(checked: boolean): void {
    void applyPatch({ sleep: { enabled: checked } })
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Move a session to a status automatically when Claude&apos;s activity changes.
      </p>

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="automation-enabled" className="text-[13px] font-medium text-foreground">
          Automatic status
        </Label>
        <Switch
          id="automation-enabled"
          checked={autoStatus.enabled}
          onCheckedChange={(checked: boolean): void =>
            void applyPatch({ autoStatus: { enabled: checked } })
          }
        />
      </div>

      <div className={cn('flex flex-col gap-3', !autoStatus.enabled && 'opacity-50')}>
        {AUTO_ROWS.map(({ field, label }) => {
          const selected = autoStatus[field]
          return (
            <div key={field} className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-medium text-foreground">{label}</span>
              <Select
                value={selected ?? NO_CHANGE}
                disabled={!autoStatus.enabled}
                onValueChange={(value: string): void => handleSelect(field, value)}
              >
                <SelectTrigger
                  size="sm"
                  aria-label={label}
                  className="w-full min-w-40 max-w-56 text-xs sm:w-auto"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value={NO_CHANGE} className="text-xs">
                    Don&apos;t change
                  </SelectItem>
                  {statuses.map((status: StatusDef) => (
                    <SelectItem key={status.id} value={status.id} className="text-xs">
                      <span
                        aria-hidden="true"
                        className="inline-block size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: status.color }}
                      />
                      {status.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Applies to open sessions only; you can still change a status by hand.
      </p>

      <Separator />

      <div className="flex flex-col gap-3 rounded-lg border border-border/60 p-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="automation-sleep-enabled" className="text-[13px] font-medium text-foreground">
            Sleep idle sessions
          </Label>
          <Switch
            id="automation-sleep-enabled"
            aria-label="Sleep idle sessions"
            checked={sleep.enabled}
            onCheckedChange={handleSleepEnabled}
          />
        </div>

        <div className={cn('flex flex-col gap-1', !sleep.enabled && 'opacity-50')}>
          <Label htmlFor="automation-sleep-after" className="text-[13px] font-medium text-foreground">
            Sleep after (minutes)
          </Label>
          <Input
            id="automation-sleep-after"
            type="number"
            min={MIN_SLEEP_MINUTES}
            max={MAX_SLEEP_MINUTES}
            step={1}
            required
            value={afterText}
            disabled={!sleep.enabled}
            aria-label="Sleep after (minutes)"
            aria-invalid={sleepError !== null}
            className="w-24 text-xs"
            onChange={(event): void => handleSleepMinutes(event.target.value)}
          />
          {sleepError !== null ? (
            <p role="alert" className="text-xs text-destructive">
              {sleepError}
            </p>
          ) : null}
        </div>

        <p className="text-xs text-muted-foreground">
          Stops the Claude process of a session that has been idle (no output, not working, not
          waiting for you) to free memory and CPU. Open it again and the same conversation resumes.
        </p>
      </div>

      <SleepAllBlock sleep={sleep} onPatch={applyPatch} />

      {error !== null ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
