import { useEffect, useState } from 'react'

/** The filter follows the search box after a short quiet period; the input itself stays instant. */
export const SEARCH_FILTER_DEBOUNCE_MS = 120

/**
 * Pure timer step shared with the tests: `apply` runs once `value` has been quiet for `delayMs`, and the returned
 * cancel function drops a pending update (the next change reschedules it).
 */
export function scheduleDebouncedValue<T>(value: T, delayMs: number, apply: (value: T) => void): () => void {
  const timer = setTimeout((): void => apply(value), delayMs)
  return (): void => clearTimeout(timer)
}

export function useDebouncedValue<T>(value: T, delayMs: number = SEARCH_FILTER_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value)
  useEffect((): () => void => scheduleDebouncedValue(value, delayMs, setDebounced), [value, delayMs])
  return debounced
}
