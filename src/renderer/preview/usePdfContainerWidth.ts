// Width of the PDF scroll container (D75): fit-to-width follows it, and a resize is debounced so
// dragging the side panel does not re-lay-out every page on every frame.
import { useEffect, useState, type RefObject } from 'react'

const RESIZE_DEBOUNCE_MS = 80

export function usePdfContainerWidth(root: RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0)

  useEffect((): (() => void) => {
    const node = root.current
    if (node === null) return (): void => undefined
    setWidth(node.clientWidth)
    let timer = 0
    const observer = new ResizeObserver((entries: readonly ResizeObserverEntry[]): void => {
      const entry = entries[0]
      if (entry === undefined) return
      const next = entry.contentRect.width
      window.clearTimeout(timer)
      timer = window.setTimeout((): void => setWidth(next), RESIZE_DEBOUNCE_MS)
    })
    observer.observe(node)
    return (): void => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [root])

  return width
}
