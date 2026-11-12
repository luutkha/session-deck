import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
import type { Id } from '../../shared/types'
import { terminalOptionsFor } from './terminalOptions'
import { DEFAULT_TERM_VIEW, fontSizeFor, type TermView } from './termView'
import { registerLinkProvider } from './links/linkProvider'
import { attachFileDrop, clipboardHasImageOnly, pasteImageKeysFor } from './inputExtras'
import { readRightClickMode } from './rightClickPref'
import {
  decideRightClick,
  isRightButton,
  decideKeyAction,
  type KeyInfo
} from './keymap'

/** What a pane asks the workspace to do on Ctrl+= / Ctrl+- / Ctrl+0 or Ctrl+wheel (terminal comfort). */
export type ZoomAction = 'in' | 'out' | 'reset'

/**
 * One terminal pane's xterm view: the Terminal itself, its fit addon and the
 * WebGL renderer addon when available. Mutable fields track renderer and
 * pending-fit state; the object itself is never replaced.
 */
export interface TerminalView {
  readonly term: Terminal
  readonly fitAddon: FitAddon
  /** One search provider per pane (W3): searches this pane's buffer only. */
  readonly searchAddon: SearchAddon
  webgl: WebglAddon | null
  /** A WebGL attach threw (no GPU / contexts exhausted): the policy stops retrying it. */
  webglFailed: boolean
  fitFrame: number | null
  /** Set by the workspace that owns the terminal profile; absent = zoom shortcuts do nothing. */
  onZoom: ((action: ZoomAction) => void) | null
  /** Set by the workspace so Ctrl+Shift+F can open the search bar; absent = swallowed but no bar. */
  onSearch: (() => void) | null
  /** Set by the workspace (D59): a right-click asks it to open the terminal menu at this point (window coordinates). */
  onContextMenu: ((point: { readonly x: number; readonly y: number }) => void) | null
  /** The container the terminal was opened into (for live refits); set by openTerminalView. */
  openedElement: HTMLElement | null
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

/** Copies the pane's selection (menu, Ctrl+C, right-click) and clears it; nothing selected = nothing happens. */
export async function copySelectionToClipboard(term: Terminal): Promise<void> {
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

/** The DOM listeners openTerminalView added, so a re-open or a dispose removes them from the container. */
const viewListeners = new WeakMap<TerminalView, AbortController>()

/** Pastes the clipboard once (menu, Ctrl+V, right-click); an image-only clipboard makes the agent attach it. */
export async function pasteClipboardInto(term: Terminal): Promise<void> {
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

function attachKeyHandling(view: TerminalView): void {
  view.term.attachCustomKeyEventHandler((event: KeyboardEvent): boolean => {
    const decision = decideKeyAction(toKeyInfo(event), view.term.hasSelection())
    switch (decision) {
      case 'copy':
        void copySelectionToClipboard(view.term)
        return false
      case 'paste':
        void pasteClipboardInto(view.term)
        return false
      case 'app-shortcut':
        return false
      case 'search':
        view.onSearch?.()
        return false
      case 'zoom-in':
        view.onZoom?.('in')
        return false
      case 'zoom-out':
        view.onZoom?.('out')
        return false
      case 'zoom-reset':
        view.onZoom?.('reset')
        return false
      case 'allow':
        return true
    }
  })
}

/**
 * Builds a Terminal with all addons that may load before `open`, and wires
 * keyboard, input and resize reporting. The profile carries the zoom font size
 * and the scrollback of NEW panes (terminal comfort). The WebGL addon is
 * deliberately NOT loaded here: it must be added after `term.open`.
 */
export function buildTerminalView(
  id: Id,
  options: {
    readonly termView?: TermView
    readonly onZoom?: (action: ZoomAction) => void
    readonly onSearch?: () => void
    readonly onContextMenu?: (point: { readonly x: number; readonly y: number }) => void
  } = {}
): TerminalView {
  const term = new Terminal(terminalOptionsFor(options.termView ?? DEFAULT_TERM_VIEW))

  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)

  const searchAddon = new SearchAddon()
  term.loadAddon(searchAddon)

  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = '11'

  sessionIds.set(term, id)
  registerLinkProvider(term, id)

  // Typing also clears the session's attention: main does that inside its pty write (attention.noteInput).
  term.onData((data: string): void => {
    window.api.ptyWrite(id, data)
  })

  term.onResize(({ cols, rows }: { cols: number; rows: number }): void => {
    window.api.ptyResize(id, cols, rows)
  })

  const view: TerminalView = {
    term,
    fitAddon,
    searchAddon,
    webgl: null,
    webglFailed: false,
    fitFrame: null,
    onZoom: options.onZoom ?? null,
    onSearch: options.onSearch ?? null,
    onContextMenu: options.onContextMenu ?? null,
    openedElement: null
  }
  attachKeyHandling(view)

  return view
}

/**
 * Loads the WebGL renderer into an OPENED terminal (xterm needs a parent element first).
 * The pane registry decides when: only visible panes near the context cap get one.
 * A failure is remembered (webglFailed) so the policy does not retry a pane forever.
 */
export function attachWebgl(view: TerminalView): void {
  if (view.webgl !== null) {
    return
  }
  try {
    const addon = new WebglAddon()
    addon.onContextLoss((): void => {
      // A newer addon may already be attached when an old one reports a late loss.
      if (view.webgl !== addon) {
        return
      }
      // Disposing the addon makes xterm fall back to the DOM renderer. The context is gone
      // for good (usually Chromium's per-renderer limit), so this pane stops asking for one.
      view.webgl = null
      view.webglFailed = true
      addon.dispose()
    })
    view.term.loadAddon(addon)
    view.webgl = addon
  } catch (error) {
    view.webglFailed = true
    console.error('SessionDeck: WebGL renderer unavailable, using the DOM renderer', error)
  }
}

/**
 * Gives the pane's WebGL context back (hidden pane). xterm falls back to its DOM renderer,
 * which pauses while the element is hidden and costs nothing there. Attach again on show.
 */
export function detachWebgl(view: TerminalView): void {
  const addon = view.webgl
  if (addon === null) {
    return
  }
  // Clear first: an onContextLoss fired by dispose() must not touch the next addon.
  view.webgl = null
  try {
    addon.dispose()
  } catch (error) {
    console.error('SessionDeck: releasing the WebGL renderer failed', error)
  }
}

/**
 * Opens the terminal into `element` and attaches mouse behaviour. The WebGL renderer is
 * attached separately (attachWebgl): the pane registry knows then whether the pane shows.
 */
export function openTerminalView(view: TerminalView, element: HTMLElement): void {
  // Re-opening into a fresh element (StrictMode remount) must not stack two sets of listeners.
  viewListeners.get(view)?.abort()
  const listeners = new AbortController()
  viewListeners.set(view, listeners)
  const { signal } = listeners

  view.openedElement = element
  view.term.open(element)

  // xterm also pastes on the textarea's native paste event; all pasting goes through pasteOnce instead.
  element.addEventListener('paste', (event: ClipboardEvent): void => {
    event.preventDefault()
    event.stopImmediatePropagation()
    const text = event.clipboardData?.getData('text/plain') ?? ''
    pasteOnce(view.term, text)
  }, { capture: true, signal })

  // When the app turns on mouse reporting (Claude's fullscreen UI does), xterm would forward the right button to it and
  // Claude pastes on a reported right-click by itself, on top of our paste below. The right button belongs to
  // SessionDeck (copy/paste), so it never reaches xterm; the contextmenu event still fires.
  const swallowRightButton = (event: MouseEvent): void => {
    if (!isRightButton(event.button)) {
      return
    }
    event.stopPropagation()
    if (event.type === 'mousedown') {
      view.term.focus()
    }
  }
  element.addEventListener('mousedown', swallowRightButton, { capture: true, signal })
  element.addEventListener('mouseup', swallowRightButton, { capture: true, signal })

  element.addEventListener('contextmenu', (event: MouseEvent): void => {
    event.preventDefault()
    const action = decideRightClick(readRightClickMode(), event.ctrlKey, view.term.hasSelection())
    if (action === 'menu' && view.onContextMenu !== null) {
      view.onContextMenu({ x: event.clientX, y: event.clientY })
    } else if (action === 'copy') {
      void copySelectionToClipboard(view.term)
    } else if (action === 'paste' || !view.term.hasSelection()) {
      void pasteClipboardInto(view.term)
    } else {
      void copySelectionToClipboard(view.term)
    }
  }, { signal })

  attachFileDrop(element, view.term)

  // Ctrl+wheel zooms (terminal comfort). Capture phase + preventDefault so xterm does not scroll the buffer.
  element.addEventListener(
    'wheel',
    (event: WheelEvent): void => {
      if (!event.ctrlKey || view.onZoom === null) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      view.onZoom(event.deltaY < 0 ? 'in' : 'out')
    },
    { capture: true, passive: false, signal }
  )

  element.addEventListener('mousedown', (): void => {
    view.term.focus()
  }, { signal })
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

/**
 * Live zoom (terminal comfort): applies a profile's zoom to ONE mounted pane and refits it so the pty
 * receives the new cols/rows through the single existing fit path (no second resize path).
 */
export function applyTerminalFontSize(view: TerminalView, zoomPercent: number): void {
  const fontSize = fontSizeFor(zoomPercent)
  if (view.term.options.fontSize === fontSize) {
    return
  }
  view.term.options.fontSize = fontSize
  if (view.openedElement !== null) {
    fitTerminalView(view, view.openedElement)
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

/** Disposes the terminal (and with it all loaded addons), removes its listeners and cancels work. */
export function disposeTerminalView(view: TerminalView): void {
  if (view.fitFrame !== null) {
    cancelAnimationFrame(view.fitFrame)
    view.fitFrame = null
  }
  viewListeners.get(view)?.abort()
  viewListeners.delete(view)
  // term.dispose() disposes the addons too; clearing the field keeps detachWebgl a no-op.
  view.webgl = null
  view.term.dispose()
}
