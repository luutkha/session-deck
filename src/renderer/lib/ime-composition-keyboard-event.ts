// Adapted from stablyai/orca (MIT, (c) 2026 Lovecast Inc.)

type ImeKeyboardEvent = {
  isComposing?: boolean
  keyCode?: number
  nativeEvent?: { isComposing?: boolean; keyCode?: number }
}

/** True when the IME, rather than the app, owns a keyboard event. */
export function isImeOwnedKeyboardEvent<KeyEvent extends ImeKeyboardEvent>(event: KeyEvent): boolean {
  return (
    event.isComposing === true ||
    event.keyCode === 229 ||
    event.nativeEvent?.isComposing === true ||
    event.nativeEvent?.keyCode === 229
  )
}
