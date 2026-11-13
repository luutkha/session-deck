// The draggable edge of the sessions sidebar (D70). A 1px line with a 6px hit area, like the terminal split divider: drag
// resizes live, the final width is kept when the pointer is released; arrows / Home / End resize from the keyboard and a
// double-click goes back to the default width.
import { useRef, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react'
import { cn } from '@/lib/utils'
import { SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN, widthForDrag, widthForKey } from './sidebarWidth'

export interface SidebarResizeHandleProps {
  readonly width: number
  readonly onDrag: (width: number) => void
  readonly onCommit: (width: number) => void
  readonly onReset: () => void
  /** Told when a drag starts / ends, so the width transition can be switched off while the pointer moves it. */
  readonly onDraggingChange: (dragging: boolean) => void
}

interface DragState {
  readonly startX: number
  readonly startWidth: number
  last: number
}

export function SidebarResizeHandle(props: SidebarResizeHandleProps): ReactElement {
  const { width, onDrag, onCommit, onReset, onDraggingChange } = props
  const drag = useRef<DragState | null>(null)

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { startX: event.clientX, startWidth: width, last: width }
    onDraggingChange(true)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const state = drag.current
    if (state === null) return
    const next = widthForDrag(state.startWidth, state.startX, event.clientX)
    if (next !== state.last) {
      state.last = next
      onDrag(next)
    }
  }

  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const state = drag.current
    if (state === null) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    onDraggingChange(false)
    onCommit(state.last)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = widthForKey(width, event.key, event.shiftKey)
    if (next === null) return
    event.preventDefault()
    onCommit(next)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sessions sidebar"
      aria-valuemin={SIDEBAR_WIDTH_MIN}
      aria-valuemax={SIDEBAR_WIDTH_MAX}
      aria-valuenow={width}
      tabIndex={0}
      data-testid="sidebar-resize-handle"
      title="Drag to resize, double-click to reset"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
      className={cn(
        'app-no-drag absolute inset-y-0 -left-[3px] z-30 w-1.5 cursor-col-resize touch-none select-none outline-none',
        'after:absolute after:inset-y-0 after:left-[2px] after:w-px after:bg-transparent after:transition-colors',
        'hover:after:bg-ring/60 focus-visible:after:bg-ring active:after:bg-ring'
      )}
    />
  )
}
