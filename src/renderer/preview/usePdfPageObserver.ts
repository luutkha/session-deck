// Which PDF pages keep a canvas (D75): an IntersectionObserver rooted at the scroll container with
// one viewport of margin, so a page is ready just before it scrolls into view and freed after it
// leaves. The pane passes each page element to the returned `observe` ref callback.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

export interface PdfPageObserver {
  readonly visible: ReadonlySet<number>
  readonly observe: (index: number, element: HTMLDivElement | null) => void
}

export function usePdfPageObserver(
  root: RefObject<HTMLDivElement | null>,
  active: boolean
): PdfPageObserver {
  const elements = useRef(new Map<number, HTMLDivElement>())
  const observerRef = useRef<IntersectionObserver | null>(null)
  const [visible, setVisible] = useState<ReadonlySet<number>>((): ReadonlySet<number> => new Set([0, 1]))

  useEffect((): (() => void) => {
    const node = root.current
    if (!active || node === null) return (): void => undefined
    const seen = new Set<number>()
    const observer = new IntersectionObserver(
      (entries: readonly IntersectionObserverEntry[]): void => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.pdfPage)
          if (!Number.isInteger(index)) continue
          if (entry.isIntersecting) seen.add(index)
          else seen.delete(index)
        }
        setVisible(new Set(seen))
      },
      { root: node, rootMargin: '100% 0px 100% 0px', threshold: 0 }
    )
    observerRef.current = observer
    for (const element of elements.current.values()) observer.observe(element)
    setVisible(new Set([0, 1]))
    return (): void => {
      observer.disconnect()
      if (observerRef.current === observer) observerRef.current = null
    }
  }, [root, active])

  const observe = useCallback((index: number, element: HTMLDivElement | null): void => {
    const previous = elements.current.get(index)
    if (previous !== undefined && previous !== element) {
      observerRef.current?.unobserve(previous)
      elements.current.delete(index)
    }
    if (element === null) return
    elements.current.set(index, element)
    observerRef.current?.observe(element)
  }, [])

  return { visible, observe }
}
