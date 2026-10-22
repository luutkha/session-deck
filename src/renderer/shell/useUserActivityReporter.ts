import { useEffect, useRef } from 'react'
import { shouldReport } from './userActivity'

const ACTIVITY_EVENTS = ['keydown', 'pointerdown', 'wheel'] as const

/**
 * Reports keyboard and mouse activity inside SessionDeck to the main process (throttled).
 * Capture phase is required: xterm.js stops some key events, so bubbling listeners would miss typing in the terminal.
 */
export function useUserActivityReporter(): void {
  const lastSentAtRef = useRef<number | null>(null)

  useEffect((): (() => void) => {
    const listenerOptions: AddEventListenerOptions = { capture: true, passive: true }

    function report(): void {
      const now = Date.now()
      if (!shouldReport(lastSentAtRef.current, now)) return
      try {
        window.api.reportUserActivity()
        lastSentAtRef.current = now
      } catch (error: unknown) {
        console.error('SessionDeck: failed to report user activity', error)
      }
    }

    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, report, listenerOptions)
    }
    return (): void => {
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, report, listenerOptions)
      }
    }
  }, [])
}
