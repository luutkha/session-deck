import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { CanvasAddon } from '@xterm/addon-canvas'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
import type { Id } from '../../shared/types'
import { terminalOptionsFor } from './terminalOptions'
import { DEFAULT_TERM_VIEW, fontSizeFor, type TermView } from './termView'
import type { RendererKind } from './terminalRenderer'
import { registerLinkProvider } from './links/linkProvider'
import { getHoveredLink, type HoveredLink } from './links/hoveredLink'
import { attachFileDrop, clipboardHasImageOnly, pasteImageKeysFor } from './inputExtras'
import { readRightClickMode } from './rightClickPref'
import {
  decideRightClick,
  isRightButton,
  decideKeyAction,
  type KeyInfo
} from './keymap'

/**
 * Max decorated matches per pane. The search addon re-runs a full highlight pass after every
 * write batch while decorations are on; its default of 1000 is far too costly on a chatty pane.
 */
export const SEARCH_HIGHLIGHT_LIMIT = 200

/** What a pane asks the workspace to do on Ctrl+= / Ctrl+- / Ctrl+0 or Ctrl+wheel (terminal comfort). */
export type ZoomAction = 'in' | 'out' | 'reset'

/** Where a right-click asked for the menu, plus (D76) the link under the pointer at that moment. */
export interface ContextMenuPoint {
  readonly x: number
  readonly y: number
  /** Absent = the pointer was not over a detected link, so the menu gets no link rows. */
  readonly link?: HoveredLink
}

/**
 * One terminal pane's xterm view: the Terminal itself, its fit addon and the GPU
 * renderer addon when one is attached. Mutable fields track renderer and
 * pending-fit state; the object itself is never replaced.
 */
export interface TerminalView {
  readonly term: Terminal
  readonly fitAddon: FitAddon
  /** One search provider per pane (W3): searches this pane's buffer only. */
  readonly searchAddon: SearchAddon
  /** The attached WebGL/Canvas addon; null on xterm's DOM renderer (kind 'dom' never loads one). */
  gpuAddon: { dispose(): void } | null
  /** Which renderer is attached now (null = DOM, the same as 'dom' but also "nothing chosen yet"). */
  gpuKind: RendererKind | null
  /** A GPU addon attach threw or lost its context (diagnostics; the policy reads failedKinds). */
  rendererFailed: boolean
  /** Kinds whose attach already failed for this pane: never retried (no GPU / contexts exhausted). */
  readonly failedKinds: Set<RendererKind>
  fitFrame: number | null
  /** Set by the workspace that owns the terminal profile; absent = zoom shortcuts do nothing. */
  onZoom: ((action: ZoomAction) => void) | null
  /** Set by the workspace so Ctrl+Shift+F can open the search bar; absent = swallowed but no bar. */
  onSearch: (() => void) | null
  /** Set by the workspace (D59): a right-click asks it to open the terminal menu at this point (window coordinates). */
  onContextMenu: ((point: ContextMenuPoint) => void) | null
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
    /** Reduced effects (software GPU): lower the default scrollback at construction (W4-H). */
    readonly reducedEffects?: boolean
    /** True when the user saved `sessiondeck.termview.v1`; their scrollback must be kept. */
    readonly explicitTermView?: boolean
    readonly onZoom?: (action: ZoomAction) => void
    readonly onSearch?: () => void
    readonly onContextMenu?: (point: ContextMenuPoint) => void
  } = {}
): TerminalView {
  const term = new Terminal(terminalOptionsFor(options.termView ?? DEFAULT_TERM_VIEW, {
    reducedEffects: options.reducedEffects ?? false,
    explicit: options.explicitTermView ?? false
  }))

  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)

  // 0.16 takes the highlight cap as a constructor option, not in ISearchOptions.
  const searchAddon = new SearchAddon({ highlightLimit: SEARCH_HIGHLIGHT_LIMIT })
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
    gpuAddon: null,
    gpuKind: null,
    rendererFailed: false,
    failedKinds: new Set<RendererKind>(),
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
 * Loads a GPU renderer (WebGL or Canvas) into an OPENED terminal (xterm needs a parent element first).
 * The pane registry decides when and which kind: visible panes only, and WebGL only near the context cap.
 * A failure is remembered per kind (failedKinds) so the policy does not retry that pane forever.
 */
export function attachRenderer(view: TerminalView, kind: 'webgl' | 'canvas'): void {
  if (view.gpuKind === kind) {
    return
  }
  if (view.gpuKind !== null) {
    detachRenderer(view)
  }
  if (view.failedKinds.has(kind)) {
    return
  }
  try {
    const addon: WebglAddon | CanvasAddon = kind === 'webgl' ? new WebglAddon() : new CanvasAddon()
    if (addon instanceof WebglAddon) {
      addon.onContextLoss((): void => {
        // A newer addon may already be attached when an old one reports a late loss.
        if (view.gpuAddon !== addon) {
          return
        }
        // Disposing the addon makes xterm fall back to the DOM renderer. The context is gone for good
        // (usually Chromium's per-renderer limit), so this pane stops asking for WebGL.
        view.gpuAddon = null
        view.gpuKind = null
        view.failedKinds.add('webgl')
        view.rendererFailed = true
        addon.dispose()
      })
    }
    view.term.loadAddon(addon)
    view.gpuAddon = addon
    view.gpuKind = kind
  } catch (error) {
    view.failedKinds.add(kind)
    view.rendererFailed = true
    console.error(`SessionDeck: the ${kind} terminal renderer is unavailable, using the DOM renderer`, error)
  }
}

/**
 * Gives the pane's GPU renderer back (hidden pane / renderer switch). xterm falls back to its DOM renderer,
 * which pauses while the element is hidden and costs nothing there. Attach again when needed.
 */
export function detachRenderer(view: TerminalView): void {
  const addon = view.gpuAddon
  if (addon === null) {
    view.gpuKind = null
    return
  }
  // Clear first: an onContextLoss fired by dispose() must not touch the next addon.
  view.gpuAddon = null
  view.gpuKind = null
  try {
    addon.dispose()
  } catch (error) {
    console.error('SessionDeck: releasing the terminal renderer failed', error)
  }
}

/** Reduced effects (no GPU): a blinking cursor repaints the pane forever, so it is turned off (live option). */
export function applyReducedEffects(view: TerminalView, reduced: boolean): void {
  if (view.term.options.cursorBlink === !reduced) {
    return
  }
  view.term.options.cursorBlink = !reduced
}

/**
 * Opens the terminal into `element` and attaches mouse behaviour. The GPU renderer is
 * attached separately (attachRenderer): the pane registry knows then whether the pane shows.
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
      // D76: read the hover record at click time (a left link has already cleared it, so no stale rows). Only for a REAL
      // right-click: the keyboard Menu key / Shift+F10 raises the same event with no pointer over any link, so it must
      // not pick up whatever link the pointer last hovered.
      const link = event.button === 2 ? getHoveredLink(view.term) : null
      view.onContextMenu(link === null
        ? { x: event.clientX, y: event.clientY }
        : { x: event.clientX, y: event.clientY, link })
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
  // term.dispose() disposes the addons too; clearing the fields keeps detachRenderer a no-op.
  view.gpuAddon = null
  view.gpuKind = null
  view.term.dispose()
}
