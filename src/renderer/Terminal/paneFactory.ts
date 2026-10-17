import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import type { Id } from '../../shared/types'
import { TERMINAL_OPTIONS } from './terminalOptions'
import { registerLinkProvider } from './links/linkProvider'
import { attachFileDrop, clipboardHasImageOnly, pasteImageKeysFor } from './inputExtras'
import {
  decideContextMenuAction,
  decideKeyAction,
  type KeyInfo
} from './keymap'

/**
 * One terminal pane's xterm view: the Terminal itself, its fit addon and the
 * WebGL renderer addon when available. Mutable fields track renderer and
 * pending-fit state; the object itself is never replaced.
 */
export interface TerminalView {
  readonly term: Terminal
  readonly fitAddon: FitAddon
  webgl: WebglAddon | null
  fitFrame: number | null
}

function toKeyInfo(event: KeyboardEvent): KeyInfo {
  return {
    type: event.type,
    key: event.key,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey
  }
}

async function copySelectionToClipboard(term: Terminal): Promise<void> {
  const text = term.getSelection()
  if (text.length === 0) {
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    term.clearSelection()
  } catch (error) {
    console.error('SessionDeck: copying the selection to the clipboard failed', error)
  }
}

const sessionIds = new WeakMap<Terminal, Id>()

async function pasteClipboardInto(term: Terminal): Promise<void> {
  const sessionId = sessionIds.get(term)
  // An image on the clipboard has no text to paste: the agent reads the clipboard itself (Claude: Alt+V, OpenCode: Ctrl+V).
  if (sessionId !== undefined && await clipboardHasImageOnly()) {
    const { data } = await window.api.getStore()
    const agent = data.sessions.find((session) => session.id === sessionId)?.agent
    window.api.ptyWrite(sessionId, pasteImageKeysFor(agent))
    return
  }
  let text: string
  try {
    text = await navigator.clipboard.readText()
  } catch (error) {
    console.error('SessionDeck: reading the clipboard for paste failed', error)
    return
  }
  pasteOnce(term, text)
}

const PASTE_DEDUPE_MS = 400
const lastPaste = new WeakMap<Terminal, { text: string; at: number }>()

/** Pastes through one gate: the same text arriving twice within a moment (right-click + native paste event, etc.) is one paste. */
export function pasteOnce(term: Terminal, text: string, now: number = Date.now()): boolean {
  if (text.length === 0) {
    return false
  }
  const previous = lastPaste.get(term)
  if (previous !== undefined && previous.text === text && now - previous.at < PASTE_DEDUPE_MS) {
    return false
  }
  lastPaste.set(term, { text, at: now })
  term.paste(text)
  return true
}

function attachKeyHandling(term: Terminal): void {
  term.attachCustomKeyEventHandler((event: KeyboardEvent): boolean => {
    const decision = decideKeyAction(toKeyInfo(event), term.hasSelection())
    switch (decision) {
      case 'copy':
        void copySelectionToClipboard(term)
        return false
      case 'paste':
        void pasteClipboardInto(term)
        return false
      case 'app-shortcut':
        return false
      case 'allow':
        return true
    }
  })
}

/**
 * Builds a Terminal with all addons that may load before `open`, and wires
 * keyboard, input and resize reporting. The WebGL addon is deliberately NOT
 * loaded here: it must be added after `term.open` (see `openTerminalView`).
 */
export function buildTerminalView(id: Id): TerminalView {
  const term = new Terminal(TERMINAL_OPTIONS)

  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)

  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = '11'

  sessionIds.set(term, id)
  registerLinkProvider(term, id)

  term.onData((data: string): void => {
    window.api.ptyWrite(id, data)
    window.api.clearAttention(id)
  })

  term.onResize(({ cols, rows }: { cols: number; rows: number }): void => {
    window.api.ptyResize(id, cols, rows)
  })

  attachKeyHandling(term)

  return { term, fitAddon, webgl: null, fitFrame: null }
}

function loadWebglRenderer(view: TerminalView): void {
  try {
    const addon = new WebglAddon()
    addon.onContextLoss((): void => {
      // Disposing the addon makes xterm fall back to the DOM renderer.
      view.webgl = null
      addon.dispose()
    })
    view.term.loadAddon(addon)
    view.webgl = addon
  } catch (error) {
    console.error('SessionDeck: WebGL renderer unavailable, using the DOM renderer', error)
  }
}

/** Opens the terminal into `element` and attaches mouse behaviour + WebGL. */
export function openTerminalView(view: TerminalView, element: HTMLElement): void {
  view.term.open(element)

  // xterm also pastes on the textarea's native paste event; all pasting goes through pasteOnce instead.
  element.addEventListener('paste', (event: ClipboardEvent): void => {
    event.preventDefault()
    event.stopImmediatePropagation()
    const text = event.clipboardData?.getData('text/plain') ?? ''
    pasteOnce(view.term, text)
  }, true)

  element.addEventListener('contextmenu', (event: MouseEvent): void => {
    event.preventDefault()
    const action = decideContextMenuAction(view.term.hasSelection())
    if (action === 'copy') {
      void copySelectionToClipboard(view.term)
    } else {
      void pasteClipboardInto(view.term)
    }
  })

  attachFileDrop(element, view.term)

  element.addEventListener('mousedown', (): void => {
    view.term.focus()
  })

  loadWebglRenderer(view)
}

/** Fits the terminal to its container; a zero-sized container is never fit. */
export function fitTerminalView(view: TerminalView, element: HTMLElement): void {
  if (element.clientWidth === 0 || element.clientHeight === 0) {
    return
  }
  try {
    view.fitAddon.fit()
  } catch (error) {
    console.error('SessionDeck: failed to fit the terminal to its container', error)
  }
}

/** requestAnimationFrame-debounced fit; a pending frame is always coalesced. */
export function scheduleTerminalFit(view: TerminalView, element: HTMLElement): void {
  if (view.fitFrame !== null) {
    cancelAnimationFrame(view.fitFrame)
  }
  view.fitFrame = requestAnimationFrame((): void => {
    view.fitFrame = null
    fitTerminalView(view, element)
  })
}

/**
 * Observes the pane container and fits (rAF-debounced) on every size change.
 * Returns a cleanup that disconnects the observer and cancels a pending fit.
 */
export function observeTerminalResize(view: TerminalView, element: HTMLElement): () => void {
  const observer = new ResizeObserver((): void => {
    scheduleTerminalFit(view, element)
  })
  observer.observe(element)
  return (): void => {
    observer.disconnect()
    if (view.fitFrame !== null) {
      cancelAnimationFrame(view.fitFrame)
      view.fitFrame = null
    }
  }
}

/** Disposes the terminal (and with it all loaded addons) and cancels work. */
export function disposeTerminalView(view: TerminalView): void {
  if (view.fitFrame !== null) {
    cancelAnimationFrame(view.fitFrame)
    view.fitFrame = null
  }
  view.term.dispose()
}
