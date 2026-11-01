import { useEffect } from 'react'
import { isJarvisShortcut } from './jarvisLogic'

const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]'

/** Ctrl+Shift+J opens Jarvis (D53). Main shows it, switching the window to Ops mode when needed. Once per window. */
export function useJarvisShortcut(): void {
  useEffect((): (() => void) => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isJarvisShortcut(event, document.querySelector(DIALOG_SELECTOR) !== null)) return
      event.preventDefault()
      event.stopPropagation()
      window.api.openJarvis().catch((error: unknown): void => console.error('Open Jarvis failed', error))
    }
    window.addEventListener('keydown', onKeyDown, true)
    return (): void => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}
