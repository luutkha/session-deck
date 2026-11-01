// D54: the Jarvis panel's list of scheduled instructions (made by asking Jarvis). Pause / resume / delete here.
import { CalendarClock, Pause, Play, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import type { JarvisSchedule } from '../../shared/types'
import { scheduleWhen } from '../../shared/jarvisSchedule'
import { Button } from '../components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover'
import { cn } from '../lib/utils'

function useJarvisSchedules(): readonly JarvisSchedule[] {
  const [schedules, setSchedules] = useState<readonly JarvisSchedule[]>([])
  useEffect((): (() => void) => {
    let alive = true
    window.api.getJarvisSchedules().then((list): void => {
      if (alive) setSchedules(list)
    }, (): void => undefined)
    const off = window.api.onJarvisSchedules((list): void => setSchedules(list))
    return (): void => {
      alive = false
      off()
    }
  }, [])
  return schedules
}

function stateOf(schedule: JarvisSchedule): string {
  if (schedule.enabled) return 'on'
  return schedule.once && schedule.lastRunAt !== null ? 'done' : 'paused'
}

export function JarvisSchedules(): ReactElement {
  const schedules = useJarvisSchedules()
  const active = schedules.filter((s) => s.enabled).length
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className="gap-1 px-1.5 text-muted-foreground" aria-label="Jarvis schedules" data-jarvis-schedules="">
          <CalendarClock size={13} aria-hidden="true" />
          {active > 0 ? <span className="text-[11px] tabular-nums">{active}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-2">
        <p className="px-1 pb-1.5 text-[12px] font-medium">Scheduled tasks</p>
        {schedules.length === 0 ? (
          <p className="px-1 pb-1 text-[12px] text-muted-foreground">
            None yet. Ask Jarvis, e.g. “every weekday at 9:00, wake API and send it ‘pull and run the tests’”. The app must be running at that time.
          </p>
        ) : (
          <ul className="flex max-h-[320px] flex-col gap-1 overflow-y-auto" aria-label="Scheduled tasks">
            {schedules.map((schedule) => (
              <li key={schedule.id} data-schedule-id={schedule.id} className={cn('flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-accent/40', !schedule.enabled && 'opacity-60')}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="tabular-nums text-foreground">{scheduleWhen(schedule)}</span>
                    {schedule.label ? <span className="truncate">· {schedule.label}</span> : null}
                    <span className="ml-auto shrink-0">{stateOf(schedule)}</span>
                  </div>
                  <p className="break-words text-[12px] leading-snug">{schedule.instruction}</p>
                </div>
                <div className="flex shrink-0 items-center">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground"
                    aria-label={schedule.enabled ? 'Pause schedule' : 'Resume schedule'}
                    onClick={(): void => void window.api.setJarvisScheduleEnabled(schedule.id, !schedule.enabled).catch((): void => undefined)}
                  >
                    {schedule.enabled ? <Pause size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Delete schedule"
                    onClick={(): void => void window.api.removeJarvisSchedule(schedule.id).catch((): void => undefined)}
                  >
                    <Trash2 size={12} aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
