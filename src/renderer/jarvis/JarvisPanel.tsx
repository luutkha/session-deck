// D53: Jarvis lives in a right-side panel that floats over whatever the window shows, in Ops and Code mode alike.
// Mounted once per window by App (outside the mode workspace), so it survives session, tab and mode switches. The
// terminal is created on first open and then only slid out of view (never resized to zero), so Claude never redraws
// for a tiny width while the panel is closed.
import { Bot, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import type { Id, RuntimeState, StoreData } from '../../shared/types'
import { Button } from '../components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { cn } from '../lib/utils'
import { useTerminalPanes } from '../Terminal/useTerminalPanes'
import '../Terminal/Terminal.css'
import { clampJarvisWidth, findJarvis, JARVIS_WIDTH_DEFAULT, jarvisRowState, parseJarvisWidth } from './jarvisLogic'
import { closeJarvisPanel, useJarvisPanelOpen } from './jarvisPanelStore'
import { JarvisSchedules } from './JarvisSchedules'

const WIDTH_KEY = 'sessiondeck.jarvis.width.v1'
const NO_IDS: readonly Id[] = []

function readWidth(): number {
  try {
    return parseJarvisWidth(window.localStorage.getItem(WIDTH_KEY))
  } catch {
    return JARVIS_WIDTH_DEFAULT
  }
}

function writeWidth(width: number): void {
  try {
    window.localStorage.setItem(WIDTH_KEY, String(width))
  } catch {
    // a remembered width is a convenience only
  }
}

export interface JarvisPanelProps {
  readonly data: StoreData | null
  readonly runtime: ReadonlyMap<Id, RuntimeState>
}

export function JarvisPanel({ data, runtime }: JarvisPanelProps): ReactElement | null {
  const open = useJarvisPanelOpen()
  const [mounted, setMounted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [width, setWidth] = useState<number>(readWidth)
  const jarvis = findJarvis(data)
  const jarvisId = jarvis?.id ?? null
  const state = jarvisId === null ? undefined : runtime.get(jarvisId)
  const ids = useMemo((): readonly Id[] => (jarvisId === null ? NO_IDS : [jarvisId]), [jarvisId])
  const panes = useTerminalPanes(mounted ? ids : NO_IDS, ids, runtime)
  const panelRef = useRef<HTMLElement | null>(null)

  // Opening makes sure Jarvis exists and runs (main creates, wakes or starts it), then focuses its terminal.
  useEffect((): void => {
    if (!open) return
    setMounted(true)
    setError(null)
    window.api.openJarvis().catch((err: unknown): void => setError(err instanceof Error ? err.message : String(err)))
  }, [open])

  useEffect((): (() => void) | undefined => {
    if (!open || jarvisId === null) return undefined
    const timer = window.setTimeout((): void => panes.focusPane(jarvisId), 60)
    return (): void => window.clearTimeout(timer)
  }, [open, jarvisId, panes.createdIds, panes.focusPane])

  // Closing hands the keyboard back to the page (the hidden terminal must not keep typing focus).
  useEffect((): void => {
    if (open) return
    const active = document.activeElement
    if (active instanceof HTMLElement && panelRef.current?.contains(active)) active.blur()
  }, [open])

  useEffect((): (() => void) => {
    const onResize = (): void => setWidth((current) => clampJarvisWidth(current, window.innerWidth))
    window.addEventListener('resize', onResize)
    return (): void => window.removeEventListener('resize', onResize)
  }, [])

  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const onMove = (move: PointerEvent): void => setWidth(clampJarvisWidth(window.innerWidth - move.clientX, window.innerWidth))
    const onUp = (up: PointerEvent): void => {
      handle.releasePointerCapture(up.pointerId)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      setWidth((current) => {
        writeWidth(current)
        return current
      })
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
  }, [])

  const restart = useCallback((): void => {
    setError(null)
    window.api.openJarvis().catch((err: unknown): void => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  const newConversation = useCallback((): void => {
    setError(null)
    window.api.resetJarvis().catch((err: unknown): void => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  if (!mounted) return null
  const stopped = jarvis !== null && (state === undefined || state.run !== 'running') && state?.sleeping !== true
  const created = jarvisId !== null && panes.createdIds.includes(jarvisId)

  return (
    <aside
      ref={panelRef}
      aria-label="Jarvis"
      aria-hidden={!open}
      data-jarvis-panel={open ? 'open' : 'closed'}
      style={{ width }}
      className={cn(
        'fixed bottom-6 right-0 top-9 z-40 flex flex-col border-l border-border bg-background shadow-2xl transition-transform duration-150 ease-out',
        open ? 'translate-x-0' : 'pointer-events-none invisible translate-x-full'
      )}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Jarvis panel"
        onPointerDown={startResize}
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-primary/30"
      />
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card pl-3 pr-1.5">
        <Bot className={cn('size-4 shrink-0 text-muted-foreground', state?.activity === 'working' && 'text-sky-400 motion-safe:animate-pulse')} strokeWidth={1.75} aria-hidden="true" />
        <span className="text-[13px] font-medium">Jarvis</span>
        <span className="truncate text-[11px] text-muted-foreground" data-jarvis-state="">{jarvisRowState(jarvis, state)}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <JarvisSchedules />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="New Jarvis conversation" onClick={newConversation}>
                <RotateCcw size={13} aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>New conversation</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="Close Jarvis" onClick={closeJarvisPanel}>
                <X size={14} aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>Close (Ctrl+Shift+J)</TooltipContent>
          </Tooltip>
        </div>
      </header>
      <div className="terminal-pane__stage">
        {created && jarvisId !== null ? (
          <div key={jarvisId} className="terminal-pane__viewport" data-session-id={jarvisId} ref={panes.handleViewportRef} />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
            {error ?? 'Starting Jarvis…'}
          </div>
        )}
        {stopped && created ? (
          <div className="terminal-pane__overlay">
            <span className="terminal-pane__overlay-label">Jarvis is not running.</span>
            <button type="button" className="terminal-pane__restart" onClick={restart}>Start</button>
          </div>
        ) : null}
      </div>
      {error !== null && created ? <p role="alert" className="shrink-0 border-t border-border px-3 py-1 text-xs text-destructive">{error}</p> : null}
    </aside>
  )
}
