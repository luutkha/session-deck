// Side-panel file viewer (D73, find/zoom D74 #6): renders one FileView. It does no IPC and reads no
// disk: main read the file and this shows it. Find, zoom and the table live in their own files.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import type { FileView, Id } from '../../shared/types'
import { cn } from '../lib/utils'
import './preview.css'
import { FileViewBody } from './FileViewBody'
import { FileViewFooter } from './FileViewFooter'
import { FindBar } from './FindBar'
import { TextZoomToolbar } from './TextZoomToolbar'
import { nextMatchIndex } from './fileViewFind'
import { IMAGE_ZOOM_STEPS, nextZoomStep } from './fileViewZoom'
import { useTextZoom } from './useTextZoom'

export interface FileViewPaneProps {
  readonly view: FileView
  /** Links inside a docx open through the app pipeline with this session's context (D12). */
  readonly sessionId: Id
  readonly className?: string
}

/**
 * A new file starts over (first sheet, fit to the pane, no stale natural size), so the state lives in
 * a component keyed by the path: an effect that reset it would run AFTER paint and could wipe a size
 * an image's onLoad had just reported.
 */
export function FileViewPane(props: FileViewPaneProps): ReactElement {
  return <FileViewPaneBody key={props.view.path} {...props} />
}

function FileViewPaneBody({ view, sessionId, className }: FileViewPaneProps): ReactElement {
  const sectionRef = useRef<HTMLElement | null>(null)
  const findInputRef = useRef<HTMLInputElement | null>(null)
  const [activeSheet, setActiveSheet] = useState(0)
  const [fit, setFit] = useState(true)
  const [imageZoom, setImageZoom] = useState(100)
  const [natural, setNatural] = useState<{ readonly width: number; readonly height: number } | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [total, setTotal] = useState(0)
  const [textZoom, zoomBy] = useTextZoom()
  const canFind = view.kind !== 'image' && view.kind !== 'pdf'
  const activeIndex = total <= 0 ? 0 : Math.min(active, total - 1)
  const findQuery = findOpen ? query : ''

  function openFind(): void {
    if (!canFind) return
    setFindOpen(true)
    window.requestAnimationFrame((): void => {
      findInputRef.current?.focus()
      findInputRef.current?.select()
    })
  }

  function closeFind(): void {
    setFindOpen(false)
    setQuery('')
    setActive(0)
    setTotal(0)
    sectionRef.current?.focus()
  }

  function stepMatch(direction: 1 | -1): void {
    if (total <= 0) return
    setActive(nextMatchIndex(activeIndex, total, direction))
    findInputRef.current?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey)) return
    if (event.key.toLowerCase() !== 'f' || !canFind) return
    event.preventDefault()
    openFind()
  }

  function changeFit(next: boolean): void {
    setFit(next)
    if (!next) setImageZoom(100)
  }

  function changeImageZoom(direction: 1 | -1): void {
    setFit(false)
    setImageZoom((current: number): number => nextZoomStep(current, direction, IMAGE_ZOOM_STEPS))
  }

  // Ctrl+wheel must be a native passive:false listener: React's synthetic wheel cannot stop the
  // window's own zoom/scroll default.
  useEffect((): (() => void) => {
    const node = sectionRef.current
    if (node === null) return (): void => undefined
    function onWheel(event: WheelEvent): void {
      if (!event.ctrlKey || event.deltaY === 0) return
      event.preventDefault()
      const direction: 1 | -1 = event.deltaY < 0 ? 1 : -1
      if (view.kind === 'image') changeImageZoom(direction)
      else if (view.kind !== 'pdf') zoomBy(direction)
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return (): void => node.removeEventListener('wheel', onWheel)
  }, [view.kind, zoomBy])

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-label={`Preview: ${view.name}`}
      data-file-view={view.kind}
      onKeyDown={onKeyDown}
      className={cn('flex min-h-0 flex-col bg-card text-xs focus:outline-none', className)}
    >
      {findOpen ? (
        <FindBar
          query={query}
          active={activeIndex}
          total={total}
          inputRef={findInputRef}
          onQueryChange={(next: string): void => {
            setQuery(next)
            setActive(0)
          }}
          onNext={(): void => stepMatch(1)}
          onPrevious={(): void => stepMatch(-1)}
          onClose={closeFind}
        />
      ) : null}
      {view.kind === 'image' || view.kind === 'pdf' ? null : <TextZoomToolbar zoomPercent={textZoom} onZoom={zoomBy} />}
      <div className="flex min-h-0 flex-1 flex-col">
        <FileViewBody
          view={view}
          sessionId={sessionId}
          activeSheet={activeSheet}
          onSelectSheet={setActiveSheet}
          query={findQuery}
          active={activeIndex}
          onCount={setTotal}
          zoomPercent={textZoom}
          fit={fit}
          imageZoom={imageZoom}
          natural={natural}
          onFitChange={changeFit}
          onImageZoom={changeImageZoom}
          onLoaded={setNatural}
        />
      </div>
      <FileViewFooter view={view} />
    </section>
  )
}
