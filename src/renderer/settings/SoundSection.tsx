import type { ReactElement } from 'react'
import { Play } from 'lucide-react'
import type { SoundEvent } from '../../shared/types'
import type { BuiltinSoundId, SoundChoice } from '../sound'
import { BUILTIN_SOUNDS, useSoundSettings } from '../sound'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

const BUILTIN_VALUE_PREFIX = 'builtin:'
const CUSTOM_VALUE = 'custom'
const NONE_VALUE = 'none'

interface SoundRow {
  readonly event: SoundEvent
  readonly label: string
  readonly description: string
}

/** Row order mirrors the sidebar attention reasons, plus the terminal bell and quota warnings. */
const SOUND_ROWS: readonly SoundRow[] = [
  { event: 'permission', label: 'Needs permission', description: 'A session asks to continue working.' },
  { event: 'done', label: 'Finished', description: 'A session finishes answering.' },
  { event: 'idle', label: 'Waiting for you', description: 'A session goes quiet and waits for input.' },
  { event: 'bell', label: 'Terminal bell', description: 'The terminal bell rings inside a session.' },
  { event: 'quota', label: 'Quota warning', description: 'Your Claude plan usage reached a warning level.' }
]

function choiceToSelectValue(choice: SoundChoice): string {
  switch (choice.kind) {
    case 'builtin':
      return `${BUILTIN_VALUE_PREFIX}${choice.id}`
    case 'file':
      return CUSTOM_VALUE
    case 'none':
      return NONE_VALUE
  }
}

function fileBaseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

export function SoundSection(): ReactElement {
  const { settings, update, test, chooseFile, lastError } = useSoundSettings()

  function handleSelect(event: SoundEvent, value: string): void {
    if (value === CUSTOM_VALUE) {
      void chooseFile(event)
      return
    }
    let choice: SoundChoice
    if (value === NONE_VALUE) {
      choice = { kind: 'none' }
    } else if (value.startsWith(BUILTIN_VALUE_PREFIX)) {
      const id = value.slice(BUILTIN_VALUE_PREFIX.length) as BuiltinSoundId
      choice = { kind: 'builtin', id }
    } else {
      return
    }
    update({ perReason: { ...settings.perReason, [event]: choice } })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="sound-enabled" className="text-[13px] font-medium text-foreground">
          Play a sound when a session needs attention
        </Label>
        <Switch
          id="sound-enabled"
          checked={settings.enabled}
          onCheckedChange={(checked: boolean): void => update({ enabled: checked })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="sound-volume" className="text-[13px] font-medium text-foreground">
            Volume
          </Label>
          <span className="text-xs text-muted-foreground">
            {Math.round(settings.volume * 100)}%
          </span>
        </div>
        <input
          id="sound-volume"
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(settings.volume * 100)}
          aria-label="Volume"
          className="w-full accent-primary"
          onChange={(event): void => update({ volume: Number(event.target.value) / 100 })}
        />
      </div>

      <div className={cn('flex flex-col gap-3', !settings.enabled && 'opacity-50')}>
        {SOUND_ROWS.map(({ event, label, description }) => {
          const choice = settings.perReason[event]
          return (
            <div key={event} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-foreground">{label}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Test ${label} sound`}
                  onClick={(): void => void test(event)}
                  className="shrink-0 text-muted-foreground"
                >
                  <Play className="size-4" aria-hidden="true" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{description}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={choiceToSelectValue(choice)}
                  onValueChange={(value: string): void => handleSelect(event, value)}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label={`Sound for ${label}`}
                    className="w-full min-w-40 max-w-64 text-xs sm:w-auto"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {Object.entries(BUILTIN_SOUNDS).map(([id, entry]) => (
                      <SelectItem key={id} value={`${BUILTIN_VALUE_PREFIX}${id}`} className="text-xs">
                        {entry.label}
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_VALUE} className="text-xs">
                      Custom file...
                    </SelectItem>
                    <SelectItem value={NONE_VALUE} className="text-xs">
                      None
                    </SelectItem>
                  </SelectContent>
                </Select>
                {choice.kind === 'file' ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="truncate text-xs text-muted-foreground">
                      {fileBaseName(choice.path)}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="shrink-0 text-xs"
                      onClick={(): void => void chooseFile(event)}
                    >
                      Change...
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      {lastError !== null ? (
        <p role="alert" className="text-xs text-destructive">
          {lastError}
        </p>
      ) : null}
    </div>
  )
}