// The current time, refreshed every second while something is running (so durations tick).
import { useEffect, useState } from 'react'

const TICK_MS = 1000

export function useNow(ticking: boolean): number {
  const [now, setNow] = useState<number>((): number => Date.now())

  useEffect((): (() => void) | undefined => {
    if (!ticking) return undefined
    setNow(Date.now())
    const timer = window.setInterval((): void => setNow(Date.now()), TICK_MS)
    return (): void => window.clearInterval(timer)
  }, [ticking])

  return now
}
