// D53: Jarvis lives in a right-side panel that floats over whatever the window shows, in Ops and Code mode alike.
// Mounted once per window by App (outside the mode workspace), so it survives session, tab and mode switches. The
// terminal is created on first open and then only slid out of view (never resized to zero), so Claude never redraws
// for a tiny width while the panel is closed.
import { Bot, Mic, RotateCcw, Square, Undo2, Volume2, VolumeX, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import type { Id, RuntimeState, StoreData } from '../../shared/types'
import { Button } from '../components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { cn } from '../lib/utils'
import { useTerminalPanes } from '../Terminal/useTerminalPanes'
import '../Terminal/Terminal.css'
import { clampJarvisWidth, findJarvis, jarvisRowState } from './jarvisLogic'
import {
  closeJarvisPanel,
  readJarvisPanelWidth,
  setJarvisPanelWidth,
  setJarvisPanelWidthLive,
  useJarvisPanelOpen,
  useJarvisPanelWidth
} from './jarvisPanelStore'
import { JarvisSchedules } from './JarvisSchedules'
import { onSpeakSettingChange, readSpeakSetting, writeSpeakSetting } from './JarvisSpeaker'

const NO_IDS: readonly Id[] = []
const NOTICE_MS = 5000

export interface JarvisPanelProps {
  readonly data: StoreData | null
  readonly runtime: ReadonlyMap<Id, RuntimeState>
}

export function JarvisPanel({ data, runtime }: JarvisPanelProps): ReactElement | null {
  const open = useJarvisPanelOpen()
  const [mounted, setMounted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const width = useJarvisPanelWidth()
  // D54: the last Undo result, shown under the header for a few seconds.
  const [notice, setNotice] = useState<string | null>(null)
  // D54: voice input (listening now) and reading replies aloud.
  const [listening, setListening] = useState(false)
  const [speak, setSpeak] = useState<boolean>(readSpeakSetting)
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
    const onResize = (): void => setJarvisPanelWidthLive(clampJarvisWidth(readJarvisPanelWidth(), window.innerWidth))
    window.addEventListener('resize', onResize)
    return (): void => window.removeEventListener('resize', onResize)
  }, [])

  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const onMove = (move: PointerEvent): void => setJarvisPanelWidthLive(clampJarvisWidth(window.innerWidth - move.clientX, window.innerWidth))
    const onUp = (up: PointerEvent): void => {
      handle.releasePointerCapture(up.pointerId)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      setJarvisPanelWidth(clampJarvisWidth(readJarvisPanelWidth(), window.innerWidth))
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
  }, [])

  const restart = useCallback((): void => {
    setError(null)
    window.api.openJarvis().catch((err: unknown): void => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  useEffect((): (() => void) | undefined => {
    if (notice === null) return undefined
    const timer = window.setTimeout((): void => setNotice(null), NOTICE_MS)
    return (): void => window.clearTimeout(timer)
  }, [notice])

  const talk = useCallback((): void => {
    if (listening) {
      void window.api.cancelJarvisVoice()
      return
    }
    setListening(true)
    setNotice('Listening… say one sentence.')
    window.api.jarvisVoice().then(
      (voice): void => setNotice(voice.heard === null ? 'Nothing was understood.' : `Heard: “${voice.heard}”`),
      (err: unknown): void => setNotice(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    ).finally((): void => setListening(false))
  }, [listening])

  const toggleSpeak = useCallback((): void => {
    const next = !readSpeakSetting()
    writeSpeakSetting(next)
    setSpeak(next)
  }, [])

  // A change made elsewhere (Jarvis's own panel tool) reaches this mounted panel.
  useEffect((): (() => void) => onSpeakSettingChange(setSpeak), [])

  const undo = useCallback((): void => {
    window.api.undoJarvis().then(setNotice, (err: unknown): void => setNotice(err instanceof Error ? err.message : String(err)))
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className={cn('text-muted-foreground', listening && 'bg-destructive/15 text-destructive motion-safe:animate-pulse')}
                aria-label={listening ? 'Stop listening' : 'Talk to Jarvis'}
                aria-pressed={listening}
                data-jarvis-mic=""
                onClick={talk}
              >
                {listening ? <Square size={12} aria-hidden="true" /> : <Mic size={13} aria-hidden="true" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>{listening ? 'Stop listening' : 'Talk to Jarvis (Windows speech recognition)'}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="Read Jarvis's replies aloud" aria-pressed={speak} data-jarvis-speak="" onClick={toggleSpeak}>
                {speak ? <Volume2 size={13} aria-hidden="true" /> : <VolumeX size={13} aria-hidden="true" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>{speak ? 'Replies are read aloud (click to stop)' : 'Read replies aloud'}</TooltipContent>
          </Tooltip>
          <JarvisSchedules />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="Undo Jarvis's last action" data-jarvis-undo="" onClick={undo}>
                <Undo2 size={13} aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>Undo Jarvis's last action</TooltipContent>
          </Tooltip>
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
      {notice !== null ? <p role="status" data-jarvis-notice="" className="shrink-0 border-b border-border bg-card px-3 py-1 text-[11px] text-muted-foreground">{notice}</p> : null}
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
