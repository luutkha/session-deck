import { useEffect } from 'react'
import { isJarvisShortcut } from './jarvisLogic'
import { toggleJarvisPanel } from './jarvisPanelStore'

const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]'

/** Ctrl+Shift+J opens or closes this window's Jarvis panel (D53). Mounted once per window. */
export function useJarvisShortcut(): void {
  useEffect((): (() => void) => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isJarvisShortcut(event, document.querySelector(DIALOG_SELECTOR) !== null)) return
      event.preventDefault()
      event.stopPropagation()
      toggleJarvisPanel()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return (): void => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}
