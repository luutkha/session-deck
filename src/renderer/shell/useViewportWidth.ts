// The window's inner width, kept current on resize (the side panel's drawn width depends on it).
import { useEffect, useState } from 'react'

const FALLBACK_WIDTH = 1280

function readWidth(): number {
  return typeof window === 'undefined' ? FALLBACK_WIDTH : window.innerWidth
}

export function useViewportWidth(): number {
  const [width, setWidth] = useState<number>(readWidth)
  useEffect((): (() => void) => {
    const update = (): void => setWidth(readWidth())
    window.addEventListener('resize', update)
    return (): void => window.removeEventListener('resize', update)
  }, [])
  return width
}
