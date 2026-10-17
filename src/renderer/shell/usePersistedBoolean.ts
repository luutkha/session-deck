import { useEffect, useState } from 'react'
import { parseBooleanPref, readStorageItem, writeStorageItem } from './shellPrefs'

/** A boolean kept in React state and mirrored to localStorage. Reads once on mount. */
export function usePersistedBoolean(
  key: string,
  fallback: boolean
): readonly [boolean, (next: boolean) => void] {
  const [value, setValue] = useState<boolean>((): boolean =>
    parseBooleanPref(readStorageItem(key), fallback)
  )

  useEffect((): void => {
    writeStorageItem(key, String(value))
  }, [key, value])

  return [value, setValue]
}
