// The xterm pane registry for a terminal workspace. Keeps one xterm instance
// per session mounted for the session's whole lifetime (hidden via CSS, never
// destroyed) so scrollback and render state survive switching and splitting.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Id, RuntimeState, SessionRun } from '../../shared/types'
import type { PtyReplay } from '../../shared/ipc'
import { SeqGate } from './seqGate'
import type { TermView } from './termView'
import type { ZoomAction } from './paneFactory'
import {
  buildTerminalView,
  disposeTerminalView,
  fitTerminalView,
  observeTerminalResize,
  openTerminalView,
  scheduleTerminalFit,
  type TerminalView
} from './paneFactory'

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
    chunks = pane.gate.push(seq, data)
  } catch (error) {
    console.error(`SessionDeck: dropping a malformed PTY chunk for session ${id}`, error)
    return
  }
  for (const chunk of chunks) {
    pane.view.term.write(chunk)
  }
}

function disposePane(pane: TerminalPaneHandle): void {
  pane.disposed = true
  if (pane.cleanupResize !== null) {
    pane.cleanupResize()
    pane.cleanupResize = null
  }
  if (pane.opened) {
    disposeTerminalView(pane.view)
    pane.opened = false
  }
}

/** Restarts a pane's process and returns focus to its terminal. */
export function restartPane(pane: TerminalPaneHandle): void {
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
  const [createdIds, setCreatedIds] = useState<readonly Id[]>([])
  // Panes are built with the profile current at CREATION; later zooms are applied live, never rebuilt.
  const optionsRef = useRef<TerminalPanesOptions>(options)
  optionsRef.current = options

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
      if (!sessionIds.includes(id) || panesRef.current.has(id)) {
        continue
      }
      const pane: TerminalPaneHandle = {
        id,
        view: buildTerminalView(id, {
          termView: optionsRef.current.termView,
          onZoom: optionsRef.current.onZoom,
          onSearch: optionsRef.current.onSearch
        }),
        gate: new SeqGate(),
        lastRun: runtime.get(id)?.run ?? null,
        opened: false,
        disposed: false,
        element: null,
        cleanupResize: null,
        hydration: 0
      }
      panesRef.current.set(id, pane)
      setCreatedIds((prev: readonly Id[]): readonly Id[] => [...prev, id])
    }
  }, [visibleKey, sessionIds, runtime])

  // Dispose panes whose session is gone.
  useEffect((): void => {
    const alive = new Set(sessionIds)
    const removed: Id[] = []
    for (const [id, pane] of panesRef.current) {
      if (!alive.has(id)) {
        disposePane(pane)
        panesRef.current.delete(id)
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

  // Restart: a session that went exited -> running gets a fresh screen and a
  // fresh replay; the seq gate keeps its last seq (main keeps increasing it).
  useEffect((): void => {
    for (const pane of panesRef.current.values()) {
      const next: SessionRun | null = runtime.get(pane.id)?.run ?? null
      if (pane.lastRun === 'exited' && next === 'running' && pane.opened) {
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
    const pane = panesRef.current.get(id)
    if (pane === undefined || pane.opened || pane.disposed) {
      return
    }
    pane.opened = true
    pane.element = element
    openTerminalView(pane.view, element)
    fitTerminalView(pane.view, element)
    window.api.ptyResize(id, pane.view.term.cols, pane.view.term.rows)
    pane.cleanupResize = observeTerminalResize(pane.view, element)
    void hydratePane(pane)
  }, [])

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
