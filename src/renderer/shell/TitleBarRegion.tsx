import type { ReactElement, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface TitleBarRegionProps {
  readonly className?: string
  /** Leave room for the native min/max/close buttons drawn by the title bar overlay (top-right). */
  readonly reserveWindowControls?: boolean
  readonly children?: ReactNode
}

/**
 * A window drag area (Electron `app-region: drag`). Interactive children must add `app-no-drag`,
 * otherwise clicks on them start a window move instead.
 */
export function TitleBarRegion({
  className,
  reserveWindowControls = false,
  children
}: TitleBarRegionProps): ReactElement {
  return (
    <div
      className={cn(
        'app-drag',
        reserveWindowControls && 'shell-window-controls-reserve',
        className
      )}
    >
      {children}
    </div>
  )
}
