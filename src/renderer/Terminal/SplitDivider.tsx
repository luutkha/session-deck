// Draggable divider between two visible panes. Its line is 1px, its hit area
// is 6px. Drag converts pixels to a fraction of the container; arrows nudge by 2%.
import { useRef, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react'
import type { SplitDirection } from '../split/splitLogic'
import { cn } from '@/lib/utils'

const KEYBOARD_STEP = 0.02
const HIT_AREA_CLASS = 'w-1.5' // 6px
const HIT_AREA_CLASS_VERTICAL = 'h-1.5'

export interface SplitDividerProps {
  readonly index: number
  readonly direction: SplitDirection
  readonly order: number
  readonly onResize: (dividerIndex: number, delta: number) => void
  readonly onEqualize: () => void
}

interface DragState {
  active: boolean
  last: number
  size: number
}

export function SplitDivider(props: SplitDividerProps): ReactElement {
  const { index, direction, order, onResize, onEqualize } = props
  const vertical = direction === 'row'
  const drag = useRef<DragState>({ active: false, last: 0, size: 1 })

  const measure = (element: HTMLElement): number => {
    const parent = element.parentElement
    if (parent === null) {
      return 1
    }
    const value = vertical ? parent.clientWidth : parent.clientHeight
    return value > 0 ? value : 1
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      active: true,
      last: vertical ? event.clientX : event.clientY,
      size: measure(event.currentTarget)
    }
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current.active) {
      return
    }
    const position = vertical ? event.clientX : event.clientY
    const delta = (position - drag.current.last) / drag.current.size
    if (delta !== 0) {
      drag.current.last = position
      onResize(index, delta)
    }
  }

  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current.active) {
      return
    }
    drag.current.active = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const negative = vertical ? 'ArrowLeft' : 'ArrowUp'
    const positive = vertical ? 'ArrowRight' : 'ArrowDown'
    if (event.key === negative) {
      event.preventDefault()
      onResize(index, -KEYBOARD_STEP)
    } else if (event.key === positive) {
      event.preventDefault()
      onResize(index, KEYBOARD_STEP)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      onEqualize()
    }
  }

  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label="Resize panes"
      tabIndex={0}
      style={{ order }}
      className={cn(
        'group relative z-10 flex shrink-0 items-center justify-center outline-none',
        vertical ? `${HIT_AREA_CLASS} cursor-col-resize` : `${HIT_AREA_CLASS_VERTICAL} cursor-row-resize`
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onEqualize}
      onKeyDown={handleKeyDown}
    >
      <span
        aria-hidden="true"
        className={cn(
          'bg-border transition-colors motion-reduce:transition-none group-hover:bg-muted-foreground group-focus-visible:bg-primary',
          vertical ? 'h-full w-px' : 'h-px w-full'
        )}
      />
    </div>
  )
}
