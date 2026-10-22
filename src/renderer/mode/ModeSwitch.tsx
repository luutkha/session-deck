import type { ReactElement } from 'react'
import { ExternalLink } from 'lucide-react'
import type { UiMode } from '../../shared/types'
import { cn } from '../lib/utils'
import type { NeedsYouCounts } from './modeLogic'

export interface ModeSwitchProps {
  /** The mode on screen. */
  readonly mode: UiMode
  readonly codePoppedOut: boolean
  /** Needs-you bells per mode; a badge shows on the segment that is not on screen. */
  readonly counts: NeedsYouCounts
  readonly onSwitch: (mode: UiMode) => void
  /** Code is in its own window: the Code segment focuses that window. */
  readonly onFocusCodeWindow: () => void
}

const SEGMENTS: readonly { readonly mode: UiMode; readonly label: string }[] = [
  { mode: 'ops', label: 'Ops' },
  { mode: 'code', label: 'Code' }
]

const SEGMENT_CLASS =
  'app-no-drag flex h-6 items-center gap-1 rounded px-2 text-[12px] font-medium tracking-tight transition-colors'
const BADGE_CLASS =
  'inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground'

/** Ops | Code switch shown in the main window's sidebar title bar (D31). */
export function ModeSwitch({ mode, codePoppedOut, counts, onSwitch, onFocusCodeWindow }: ModeSwitchProps): ReactElement {
  return (
    <div
      data-mode-switch=""
      role="group"
      aria-label="Mode"
      className="app-no-drag flex items-center gap-0.5 rounded-md border border-sidebar-border bg-worktree-sidebar-accent p-0.5"
    >
      {SEGMENTS.map((segment) => {
        const outOfWindow = segment.mode === 'code' && codePoppedOut
        const pressed = mode === segment.mode
        const count = counts[segment.mode]
        return (
          <button
            key={segment.mode}
            type="button"
            data-mode={segment.mode}
            aria-pressed={pressed}
            title={outOfWindow ? 'Code is in its own window. Click to show it.' : `${segment.label} mode`}
            onClick={(): void => (outOfWindow ? onFocusCodeWindow() : onSwitch(segment.mode))}
            className={cn(
              SEGMENT_CLASS,
              pressed ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {outOfWindow ? <ExternalLink className="size-3" aria-hidden="true" /> : null}
            {segment.label}
            {count > 0 && !pressed ? (
              <span data-mode-badge="" aria-label={`${count} need you`} className={BADGE_CLASS}>
                {count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
