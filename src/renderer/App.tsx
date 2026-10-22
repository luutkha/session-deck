// Window shell (D31): one per window. Holds what is shared by both modes (store, usage, mode switch, focus requests,
// quota toasts) and mounts the workspace of the mode on screen. The main window also plays sounds and shows the
// "While you were away" summary; the popped-out Code window only shows Code mode.
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useAttentionSound } from './sound'
import { useUsage } from './usage/useUsage'
import { QuotaToast } from './usage/QuotaToast'
import { TooltipProvider } from './components/ui/tooltip'
import { useSessionStore } from './state/useSessionStore'
import type { Id, Session } from '../shared/types'
import { useUserActivityReporter } from './shell/useUserActivityReporter'
import { AwayDialog } from './timeline/AwayDialog'
import { useAwaySummary } from './timeline/useAwaySummary'
import { ModeWorkspace } from './mode/ModeWorkspace'
import type { ModeChrome } from './mode/ModeTitleBar'
import { decideFocus, needsYouCounts, sessionMode } from './mode/modeLogic'
import { useUiMode } from './mode/useUiMode'
import type { FocusRequest } from './mode/useWorkspaceNav'
import './styles.css'

/** Plays the user's notification sounds. Mounted in the main window only, so a sound is never played twice. */
function AttentionSoundPlayer(): null {
  useAttentionSound()
  return null
}

export function App(): ReactElement {
  useUserActivityReporter()
  const store = useSessionStore()
  const usage = useUsage()
  const ui = useUiMode()
  const away = useAwaySummary()
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)
  const isMain = ui.role === 'main'

  /** Shows a session from outside the workspace: switches mode first when it belongs to the other one. */
  const requestFocus = useCallback((id: Id): void => {
    const session = store.data?.sessions.find((s: Session): boolean => s.id === id)
    if (session === undefined) return
    const decision = decideFocus(ui.mode, sessionMode(session), ui.codePoppedOut)
    if (decision.switchTo !== undefined) ui.setMode(decision.switchTo)
    setFocusRequest({ id })
  }, [store.data?.sessions, ui.mode, ui.codePoppedOut, ui.setMode])

  // Tray menu and desktop notification clicks (main sends them to the window that should show the session).
  useEffect(() => window.api?.onFocusSession?.(requestFocus), [requestFocus])
  const clearFocus = useCallback((): void => setFocusRequest(null), [])

  const counts = useMemo(() => needsYouCounts(store.data, store.runtime), [store.data, store.runtime])
  const chrome: ModeChrome = {
    role: ui.role,
    codePoppedOut: ui.codePoppedOut,
    counts,
    windowError: ui.windowError,
    onSwitch: ui.setMode,
    onPopOutCode: ui.popOutCode,
    onDockCode: ui.dockCode
  }

  return (
    <TooltipProvider delayDuration={300}>
      <ModeWorkspace
        key={ui.mode}
        mode={ui.mode}
        store={store}
        usage={usage}
        chrome={chrome}
        focusRequest={focusRequest}
        onFocusHandled={clearFocus}
        onShowAwaySummary={away.showLast}
      />
      {isMain ? <AttentionSoundPlayer /> : null}
      {isMain ? <AwayDialog summary={away.summary} onOpenSession={requestFocus} onClose={away.close} /> : null}
      <QuotaToast />
    </TooltipProvider>
  )
}
