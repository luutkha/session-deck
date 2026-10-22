import type { ReactElement } from 'react'
import { ExternalLink, PanelLeft, Undo2 } from 'lucide-react'
import type { Id, UiMode, WindowRole } from '../../shared/types'
import { Button } from '../components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { NeedsYouButton } from '../attention/NeedsYouButton'
import type { NeedsYouItem } from '../attention/needsYou'
import { TitleBarRegion } from '../shell/TitleBarRegion'
import { ModeSwitch } from './ModeSwitch'
import type { NeedsYouCounts } from './modeLogic'

/** What the title bar needs to know about the window and the modes. */
export interface ModeChrome {
  readonly role: WindowRole
  readonly codePoppedOut: boolean
  readonly counts: NeedsYouCounts
  readonly windowError: string | null
  readonly onSwitch: (mode: UiMode) => void
  readonly onPopOutCode: () => void
  readonly onDockCode: () => void
}

export interface ModeTitleBarProps {
  readonly chrome: ModeChrome
  readonly mode: UiMode
  readonly needsYou: readonly NeedsYouItem[]
  readonly onOpenSession: (id: Id) => void
  readonly onHideSidebar: () => void
}

export const CODE_WINDOW_LABEL = 'SessionDeck · Code'
const POP_OUT_LABEL = 'Open Code in its own window'
const DOCK_LABEL = 'Move Code back to the main window'

function IconAction({ label, onClick, children }: {
  readonly label: string
  readonly onClick: () => void
  readonly children: ReactElement
}): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-xs" className="app-no-drag text-muted-foreground" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/** Left side of the title bar: the Ops | Code switch in the main window, the label in the Code window. */
function Identity({ chrome, mode }: { readonly chrome: ModeChrome; readonly mode: UiMode }): ReactElement {
  if (chrome.role === 'code') {
    return <span className="text-[13px] font-medium text-muted-foreground">{CODE_WINDOW_LABEL}</span>
  }
  return (
    <div className="flex items-center gap-1">
      <ModeSwitch
        mode={mode}
        codePoppedOut={chrome.codePoppedOut}
        counts={chrome.counts}
        onSwitch={chrome.onSwitch}
        onFocusCodeWindow={chrome.onPopOutCode}
      />
      {mode === 'code' ? (
        <IconAction label={POP_OUT_LABEL} onClick={chrome.onPopOutCode}>
          <ExternalLink size={14} aria-hidden="true" />
        </IconAction>
      ) : null}
    </div>
  )
}

/** The sidebar's title bar: mode switch (or Code window label), needs-you bell, hide-sidebar button. */
export function ModeTitleBar({ chrome, mode, needsYou, onOpenSession, onHideSidebar }: ModeTitleBarProps): ReactElement {
  return (
    <>
      <TitleBarRegion className="flex h-9 shrink-0 items-center justify-between border-b border-sidebar-border pl-3 pr-1.5">
        <Identity chrome={chrome} mode={mode} />
        <div className="flex items-center gap-0.5">
          {chrome.role === 'code' ? (
            <IconAction label={DOCK_LABEL} onClick={chrome.onDockCode}>
              <Undo2 size={14} aria-hidden="true" />
            </IconAction>
          ) : null}
          <NeedsYouButton items={needsYou} onOpenSession={onOpenSession} className="app-no-drag" />
          <IconAction label="Hide sidebar" onClick={onHideSidebar}>
            <PanelLeft size={14} />
          </IconAction>
        </div>
      </TitleBarRegion>
      {chrome.windowError !== null ? (
        <p role="alert" className="shrink-0 border-b border-sidebar-border px-3 py-1 text-xs text-destructive">
          {chrome.windowError}
        </p>
      ) : null}
    </>
  )
}
