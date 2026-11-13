import { useEffect, useRef } from 'react'
import { decideAttentionShortcut } from './attentionNav'
import { readShortcutContext, toShortcutKeyEvent } from '../shell/useTabShortcuts'

/** Ctrl+Shift+Down / Up anywhere (the terminal included): show the next / previous session that needs you (D69). */
export function useAttentionShortcuts(step: (delta: 1 | -1) => void): void {
  const stepRef = useRef(step)
  useEffect((): void => {
    stepRef.current = step
  })

  useEffect((): (() => void) => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const action = decideAttentionShortcut(toShortcutKeyEvent(event), readShortcutContext())
      if (action === null) return
      // Capture phase + stopPropagation: neither xterm (it would send the modified arrow to the program) nor the sidebar's
      // Shift+arrow range select sees it.
      event.preventDefault()
      event.stopPropagation()
      stepRef.current(action === 'next' ? 1 : -1)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return (): void => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])
}
