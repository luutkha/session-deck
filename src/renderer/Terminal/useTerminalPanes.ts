// The xterm pane registry for a terminal workspace. Keeps one xterm instance
// per session mounted for the session's whole lifetime (hidden via CSS, never
// destroyed) so scrollback and render state survive switching and splitting.
// Hidden panes give their GPU renderer back (see webglPolicy), stop receiving
// output (it is queued, see hiddenQueue) and everything is disposed when the
// workspace unmounts (a mode switch remounts it). The renderer kind follows the
// measured GPU and the user's graphics preferences (no-GPU support, D62).
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Id, RuntimeState, SessionRun } from '../../shared/types'
import type { PtyReplay } from '../../shared/ipc'
import { HiddenQueue } from './hiddenQueue'
import { SeqGate } from './seqGate'
import type { TermView } from './termView'
import type { ZoomAction } from './paneFactory'
import {
  applyReducedEffects,
  attachRenderer,
  buildTerminalView,
  detachRenderer,
  disposeTerminalView,
  fitTerminalView,
  observeTerminalResize,
  openTerminalView,
  scheduleTerminalFit,
  type TerminalView
} from './paneFactory'
import { planRenderers, type RendererPaneState } from './webglPolicy'
import { resolveReducedEffects, resolveRenderer, type RendererKind } from './terminalRenderer'
import { useGraphicsPrefs } from './graphicsPrefs'
import { useGpuInfo } from './useGpuInfo'

export interface TerminalPaneHandle {
  readonly id: Id
  readonly view: TerminalView
  readonly gate: SeqGate
  lastRun: SessionRun | null
  opened: boolean
  disposed: boolean
  element: HTMLDivElement | null
  cleanupResize: (() => void) | null
  hydration: number
  /** Not on screen: output goes to `queue` instead of the term (see hiddenQueue). */
  hidden: boolean
  readonly queue: HiddenQueue
}

/**
 * Applies the replay buffer, then flushes live chunks queued in the meantime.
 * The generation guard discards a stale replay when a restart began a new
 * hydration while an older request was still in flight.
 */
async function hydratePane(pane: TerminalPaneHandle): Promise<void> {
  const generation = pane.hydration
  let replay: PtyReplay
  try {
    replay = await window.api.ptyReplay(pane.id)
  } catch (error) {
    console.error(`SessionDeck: replay request failed for session ${pane.id}`, error)
    return
  }
  if (pane.disposed || pane.hydration !== generation) {
    return
  }
  try {
    const chunks = pane.gate.begin(replay)
    for (const chunk of chunks) {
      pane.view.term.write(chunk)
    }
  } catch (error) {
    console.error(`SessionDeck: applying the replay failed for session ${pane.id}`, error)
  }
}

function dispatchPtyData(
  panes: ReadonlyMap<Id, TerminalPaneHandle>,
  id: Id,
  data: string,
  seq: number
): void {
  const pane = panes.get(id)
  if (pane === undefined || pane.disposed) {
    return
  }
  let chunks: readonly string[]
  try {
    // Always keep sequencing: a hidden pane must not see stale or duplicated output on show.
    chunks = pane.gate.push(seq, data)
  } catch (error) {
    console.error(`SessionDeck: dropping a malformed PTY chunk for session ${id}`, error)
    return
  }
  for (const chunk of chunks) {
    if (pane.hidden) {
      pane.queue.push(chunk)
    } else {
      pane.view.term.write(chunk)
    }
  }
}

/**
 * The pane just became visible again: apply what was held back while it was hidden.
 * An overflow means the queued output was dropped, so the pane replays from main
 * (the replay buffer is the source of truth), exactly like the restart path.
 */
function flushDeferredOutput(pane: TerminalPaneHandle): void {
  const { chunks, overflowed } = pane.queue.take()
  if (!pane.opened || pane.disposed) {
    // Never opened: openPane hydrates it from main anyway, nothing to replay.
    return
  }
  if (overflowed) {
    pane.hydration += 1
    pane.view.term.reset()
    pane.gate.reset()
    void hydratePane(pane)
  } else {
    for (const chunk of chunks) {
      pane.view.term.write(chunk)
    }
  }
  if (pane.element !== null) {
    // The pane may have been resized while it was hidden. The fit is rAF-debounced per view,
    // so this coalesces with the ResizeObserver's fit instead of doubling it.
    scheduleTerminalFit(pane.view, pane.element)
  }
}

/** Idempotent: the unmount cleanup, the "session is gone" effect and a StrictMode remount may all reach the same pane. */
function disposePane(pane: TerminalPaneHandle): void {
  if (pane.disposed) {
    return
  }
  pane.disposed = true
  // Held-back output is worthless once the pane is gone (the session replays on reopen).
  pane.queue.take()
  const cleanupResize = pane.cleanupResize
  pane.cleanupResize = null
  if (cleanupResize !== null) {
    try {
      cleanupResize()
    } catch (error) {
      console.error(`SessionDeck: stopping the resize observer of session ${pane.id} failed`, error)
    }
  }
  if (pane.opened) {
    pane.opened = false
    try {
      disposeTerminalView(pane.view)
    } catch (error) {
      console.error(`SessionDeck: disposing the terminal of session ${pane.id} failed`, error)
    }
  }
  pane.element = null
}

/** Restarts a pane's process and returns focus to its terminal. */
export function restartPane(pane: TerminalPaneHandle): void {
  if (pane.disposed) {
    return
  }
  window.api.ptyRestart(pane.id).catch((error: unknown): void => {
    console.error(`SessionDeck: restarting session ${pane.id} failed`, error)
  })
  // The click moved focus to the button; typing should keep going to the pty.
  pane.view.term.focus()
}

export interface TerminalPanesApi {
  readonly panesRef: React.MutableRefObject<Map<Id, TerminalPaneHandle>>
  readonly createdIds: readonly Id[]
  readonly handleViewportRef: (element: HTMLDivElement | null) => void
  readonly fitPanes: (ids: readonly Id[]) => void
  readonly focusPane: (id: Id | null) => void
}

/** Construction profile + zoom sink for the panes (terminal comfort). Read at pane creation time. */
export interface TerminalPanesOptions {
  readonly termView?: TermView
  readonly onZoom?: (action: ZoomAction) => void
  /** Ctrl+Shift+F inside a pane: the owner opens its search bar for the active pane (W3). */
  readonly onSearch?: () => void
  /** A right-click in a pane (D59): the owner opens the terminal menu for that pane at the point. */
  readonly onContextMenu?: (id: Id, point: { readonly x: number; readonly y: number }) => void
}

/**
 * Owns every pane's xterm lifecycle. Panes are created lazily the first time
 * their session becomes VISIBLE and disposed when the session leaves
 * `sessionIds`. `visibleIds` only drives creation; hidden panes stay mounted.
 */
export function useTerminalPanes(
  visibleIds: readonly Id[],
  sessionIds: readonly Id[],
  runtime: ReadonlyMap<Id, RuntimeState>,
  options: TerminalPanesOptions = {}
): TerminalPanesApi {
  const panesRef = useRef<Map<Id, TerminalPaneHandle>>(new Map())
  // The pane container of every id ever seen: after a StrictMode remount the ref callback runs
  // BEFORE the lazy create effect, so the element must be remembered to open the fresh pane into.
  const viewportsRef = useRef<Map<Id, HTMLDivElement>>(new Map())
  const [createdIds, setCreatedIds] = useState<readonly Id[]>([])
  // Panes are built with the profile current at CREATION; later zooms are applied live, never rebuilt.
  const optionsRef = useRef<TerminalPanesOptions>(options)
  optionsRef.current = options
  const visibleIdsRef = useRef<readonly Id[]>(visibleIds)
  visibleIdsRef.current = visibleIds
  // Graphics preferences + the measured GPU decide the renderer (D62). Both are app-wide hooks, so every
  // workspace and the settings dialog see the same values live.
  const prefs = useGraphicsPrefs()
  const gpu = useGpuInfo()
  const wanted: RendererKind = resolveRenderer(prefs.renderer, gpu.info?.mode ?? null)
  const reducedEffects = resolveReducedEffects(prefs.effects, gpu.info?.mode ?? null)
  // Read at pane construction and by the policy callback (both outlive the render that saw the value).
  const wantedRef = useRef<RendererKind>(wanted)
  wantedRef.current = wanted
  const reducedRef = useRef<boolean>(reducedEffects)
  reducedRef.current = reducedEffects

  /**
   * Applies the renderer plan to every live pane: hidden panes hand their addon back, visible
   * ones get the wanted kind (all of them for Canvas, up to the WebGL cap), and 'dom' detaches.
   */
  const applyRendererPolicy = useCallback((): void => {
    const kind = wantedRef.current
    const visible = new Set(visibleIdsRef.current)
    const handles = new Map<Id, TerminalPaneHandle>()
    const states: RendererPaneState[] = []
    for (const [id, pane] of panesRef.current) {
      if (!pane.opened || pane.disposed) {
        continue
      }
      handles.set(id, pane)
      states.push({
        id,
        visible: visible.has(id),
        kind: pane.view.gpuKind,
        failed: pane.view.failedKinds.has(kind)
      })
    }
    const plan = planRenderers(states, kind)
    // Free addons first: attaching before detaching would briefly exceed the WebGL context cap.
    for (const id of plan.detach) {
      const pane = handles.get(id)
      if (pane !== undefined) {
        detachRenderer(pane.view)
      }
    }
    for (const item of plan.attach) {
      const pane = handles.get(item.id)
      if (pane !== undefined) {
        attachRenderer(pane.view, item.kind)
      }
    }
  }, [])

  /** Opens a pane's xterm into its viewport once, sizes the pty to it and replays the buffer. */
  const openPane = useCallback((pane: TerminalPaneHandle, element: HTMLDivElement): void => {
    if (pane.opened || pane.disposed) {
      return
    }
    pane.opened = true
    pane.element = element
    openTerminalView(pane.view, element)
    fitTerminalView(pane.view, element)
    window.api.ptyResize(pane.id, pane.view.term.cols, pane.view.term.rows)
    pane.cleanupResize = observeTerminalResize(pane.view, element)
    void hydratePane(pane)
    // A pane opened after the last policy run must get its renderer now if it is on screen.
    applyRendererPolicy()
  }, [applyRendererPolicy])

  // ONE live-data subscription for the whole workspace; panes are dispatched by id.
  useEffect((): (() => void) => {
    return window.api.onPtyData((id: Id, data: string, seq: number): void => {
      dispatchPtyData(panesRef.current, id, data, seq)
    })
  }, [])

  // Lazy pane creation: the first time a session becomes visible.
  const visibleKey = visibleIds.join('|')
  useEffect((): void => {
    for (const id of visibleIds) {
      if (!sessionIds.includes(id)) {
        continue
      }
      const existing = panesRef.current.get(id)
      if (existing !== undefined && !existing.disposed) {
        continue
      }
      // A disposed handle (the unmount cleanup of a StrictMode remount) is replaced, not reused.
      panesRef.current.delete(id)
      const view = buildTerminalView(id, {
        termView: optionsRef.current.termView,
        onZoom: optionsRef.current.onZoom,
        onSearch: optionsRef.current.onSearch,
        // Read at click time: the owner's callback may change after the pane is built.
        onContextMenu: (point): void => { optionsRef.current.onContextMenu?.(id, point) }
      })
      // Reduced effects are a construction value too: a pane built in that mode starts without a blinking cursor.
      applyReducedEffects(view, reducedRef.current)
      const pane: TerminalPaneHandle = {
        id,
        view,
        gate: new SeqGate(),
        lastRun: runtime.get(id)?.run ?? null,
        opened: false,
        disposed: false,
        element: null,
        cleanupResize: null,
        hydration: 0,
        // Panes are created on first visibility, so a fresh pane is on screen.
        hidden: false,
        queue: new HiddenQueue()
      }
      panesRef.current.set(id, pane)
      setCreatedIds((prev: readonly Id[]): readonly Id[] =>
        prev.includes(id) ? prev : [...prev, id]
      )
    }
    // Panes re-created after the whole workspace was torn down still have their DOM viewport:
    // their ref callback already ran (or never runs again), so open them here.
    for (const pane of panesRef.current.values()) {
      const element = viewportsRef.current.get(pane.id)
      if (element !== undefined && element.isConnected) {
        openPane(pane, element)
      }
    }
  }, [visibleKey, sessionIds, runtime, openPane])

  // Renderer: re-plan whenever the visible set, the pane set, the wanted kind or the GPU info changes
  // (a settings change and the arrival of the GPU info switch live panes without recreating them).
  const createdKey = createdIds.join('|')
  // Deferred output: this MUST run before the renderer policy effect below, so a pane that becomes
  // visible is already marked visible (and has its queued output applied) when it gets a context.
  useEffect((): void => {
    const visible = new Set(visibleIdsRef.current)
    for (const pane of panesRef.current.values()) {
      const nextHidden = !visible.has(pane.id)
      if (pane.hidden === nextHidden) {
        continue
      }
      pane.hidden = nextHidden
      if (!nextHidden) {
        flushDeferredOutput(pane)
      }
    }
  }, [visibleKey, createdKey])
  useEffect((): void => {
    applyRendererPolicy()
  }, [applyRendererPolicy, visibleKey, createdKey, wanted])

  // Reduced effects: live on every mounted pane (cursor blink is the one per-pane effect xterm has).
  useEffect((): void => {
    for (const pane of panesRef.current.values()) {
      applyReducedEffects(pane.view, reducedEffects)
    }
  }, [reducedEffects, createdKey])

  // Dispose panes whose session is gone.
  useEffect((): void => {
    const alive = new Set(sessionIds)
    const removed: Id[] = []
    for (const [id, pane] of panesRef.current) {
      if (!alive.has(id)) {
        disposePane(pane)
        panesRef.current.delete(id)
        viewportsRef.current.delete(id)
        removed.push(id)
      }
    }
    if (removed.length > 0) {
      const gone = new Set(removed)
      setCreatedIds((prev: readonly Id[]): readonly Id[] =>
        prev.filter((id: Id): boolean => !gone.has(id))
      )
    }
  }, [sessionIds])

  // The workspace unmounts on every mode switch (App.tsx keys it by mode) and its panes would
  // otherwise leak their xterm, WebGL context and ResizeObserver. StrictMode runs this cleanup
  // once right after mount in dev; the lazy create effect above builds the panes again (and
  // re-opens them into the viewports remembered above), so nothing is lost.
  useEffect((): (() => void) => {
    return (): void => {
      for (const pane of panesRef.current.values()) {
        disposePane(pane)
      }
      panesRef.current.clear()
    }
  }, [])

  // Restart: a session that went exited -> running gets a fresh screen and a
  // fresh replay; the seq gate keeps its last seq (main keeps increasing it).
  useEffect((): void => {
    for (const pane of panesRef.current.values()) {
      const next: SessionRun | null = runtime.get(pane.id)?.run ?? null
      if (pane.lastRun === 'exited' && next === 'running' && pane.opened) {
        // The old screen and anything held back for a hidden pane are stale now.
        pane.queue.take()
        pane.hydration += 1
        pane.view.term.reset()
        pane.gate.reset()
        void hydratePane(pane)
      }
      if (next !== null) {
        pane.lastRun = next
      }
    }
  }, [runtime])

  const handleViewportRef = useCallback((element: HTMLDivElement | null): void => {
    if (element === null) {
      return
    }
    const id = element.dataset['sessionId']
    if (id === undefined) {
      return
    }
    // Remembered even when the pane does not exist yet: after a StrictMode remount this runs
    // before the lazy create effect, which then opens the pane into this element.
    viewportsRef.current.set(id, element)
    const pane = panesRef.current.get(id)
    if (pane === undefined) {
      return
    }
    openPane(pane, element)
  }, [openPane])

  const fitPanes = useCallback((ids: readonly Id[]): void => {
    for (const id of ids) {
      const pane = panesRef.current.get(id)
      if (pane !== undefined && pane.opened && pane.element !== null && !pane.disposed) {
        scheduleTerminalFit(pane.view, pane.element)
      }
    }
  }, [])

  const focusPane = useCallback((id: Id | null): void => {
    if (id === null) {
      return
    }
    window.api.clearAttention(id)
    const pane = panesRef.current.get(id)
    if (pane !== undefined && pane.opened && pane.element !== null && !pane.disposed) {
      scheduleTerminalFit(pane.view, pane.element)
      pane.view.term.focus()
    }
  }, [])

  return { panesRef, createdIds, handleViewportRef, fitPanes, focusPane }
}
