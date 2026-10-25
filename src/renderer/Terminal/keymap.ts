/**
 * Pure keyboard/clipboard decision logic for terminal panes.
 *
 * The host maps the returned decision onto xterm's
 * `attachCustomKeyEventHandler`: 'copy' and 'paste' are performed by us and
 * the event is swallowed (handler returns false); 'allow' returns true so the
 * event keeps its default behaviour — xterm handles it (e.g. Ctrl+C without a
 * selection sends ^C) and it still bubbles to app-level shortcut handlers
 * (Ctrl+N, F2, Ctrl+Tab).
 */

/** Minimal, DOM-free view of a KeyboardEvent so this stays unit-testable. */
export interface KeyInfo {
  readonly type: string
  readonly key: string
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
}

export type KeyDecision = 'copy' | 'paste' | 'allow' | 'app-shortcut' | 'zoom-in' | 'zoom-out' | 'zoom-reset'

export type ContextMenuDecision = 'copy' | 'paste'

const KEY_DOWN = 'keydown'

/** Single-character keys are compared case-insensitively (Shift uppercases). */
function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key
}

export function decideKeyAction(event: KeyInfo, hasSelection: boolean): KeyDecision {
  // Only keydown may trigger clipboard actions; keyup/keypress pass through so
  // a held key cannot double-fire copy/paste.
  if (event.type !== KEY_DOWN) {
    return 'allow'
  }
  // Alt/Meta combos belong to the OS or the app, never to our clipboard map.
  if (event.altKey || event.metaKey) {
    return 'allow'
  }

  const key = normalizeKey(event.key)

  if (event.ctrlKey && !event.shiftKey && key === 'c') {
    // With a selection: copy it. Without: allow -> xterm sends ^C (SIGINT).
    return hasSelection ? 'copy' : 'allow'
  }
  if (event.ctrlKey && event.shiftKey && key === 'c') {
    return 'copy'
  }
  if (event.ctrlKey && key === 'v') {
    // Covers both Ctrl+V and Ctrl+Shift+V.
    return 'paste'
  }
  // Ctrl+Shift+N is the app's "new session" shortcut: keep xterm from sending ^N to the program, but let the
  // event bubble to the window-level handler.
  if (event.ctrlKey && event.shiftKey && key === 'n') {
    return 'app-shortcut'
  }
  // Terminal comfort: Ctrl+= (and its Shift variant, i.e. '+'), Ctrl+- and Ctrl+0 zoom every pane.
  if (event.ctrlKey && (key === '=' || key === '+')) {
    return 'zoom-in'
  }
  if (event.ctrlKey && (key === '-' || key === '_')) {
    return 'zoom-out'
  }
  if (event.ctrlKey && key === '0') {
    return 'zoom-reset'
  }
  // Everything else — Ctrl+Backspace, Shift+Enter, plain Ctrl+N (readline history), F2, Ctrl+Tab —
  // is allowed through untouched.
  return 'allow'
}

const RIGHT_MOUSE_BUTTON = 2

/** The right button is SessionDeck's (copy/paste); it is never reported to the app running in the pane. */
export function isRightButton(button: number): boolean {
  return button === RIGHT_MOUSE_BUTTON
}

/** Right-click inside a pane: copy the selection when there is one, else paste. */
export function decideContextMenuAction(hasSelection: boolean): ContextMenuDecision {
  return hasSelection ? 'copy' : 'paste'
}
