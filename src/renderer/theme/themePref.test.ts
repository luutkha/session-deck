import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyTheme,
  DEFAULT_THEME,
  getTheme,
  parseTheme,
  readThemePref,
  subscribeTheme,
  THEME_STORAGE_KEY,
  writeThemePref,
  type Theme,
  type ThemeDocument,
  type ThemeStorage
} from './themePref'

function fakeStorage(initial: string | null = null): {
  readonly storage: ThemeStorage
  readonly getItem: ReturnType<typeof vi.fn>
  readonly setItem: ReturnType<typeof vi.fn>
} {
  let value = initial
  const getItem = vi.fn((key: string): string | null => {
    expect(key).toBe(THEME_STORAGE_KEY)
    return value
  })
  const setItem = vi.fn((key: string, next: string): void => {
    expect(key).toBe(THEME_STORAGE_KEY)
    value = next
  })
  return { storage: { getItem, setItem }, getItem, setItem }
}

function fakeDocument(darkInitially: boolean): ThemeDocument & { readonly classes: Set<string> } {
  const classes = new Set<string>(darkInitially ? ['dark'] : [])
  return {
    classes,
    documentElement: {
      classList: {
        add: (token: string): void => { classes.add(token) },
        remove: (token: string): void => { classes.delete(token) }
      }
    }
  }
}

afterEach((): void => {
  vi.unstubAllGlobals()
})

describe('theme preference parsing', () => {
  it('defaults to dark', () => {
    expect(DEFAULT_THEME).toBe('dark')
    expect(parseTheme(null)).toBe('dark')
    expect(parseTheme('dark')).toBe('dark')
    expect(parseTheme('anything else')).toBe('dark')
  })

  it('accepts only the exact light value', () => {
    expect(parseTheme('light')).toBe('light')
    expect(parseTheme('LIGHT')).toBe('dark')
  })
})

describe('readThemePref', () => {
  it('reads the stored choice through a fake storage', () => {
    expect(readThemePref(fakeStorage('light').storage)).toBe('light')
    expect(readThemePref(fakeStorage('dark').storage)).toBe('dark')
  })

  it('falls back to dark on a missing, unavailable or throwing storage', () => {
    const broken: ThemeStorage = {
      getItem: (): string | null => { throw new Error('blocked') },
      setItem: (): void => { throw new Error('blocked') }
    }
    expect(readThemePref(null)).toBe('dark')
    expect(readThemePref(broken)).toBe('dark')
  })
})

describe('writeThemePref', () => {
  it('writes the choice under sessiondeck.theme', () => {
    const fake = fakeStorage()
    writeThemePref('light', fake.storage)
    expect(fake.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'light')
    expect(readThemePref(fake.storage)).toBe('light')
  })

  it('never throws when storage is blocked', () => {
    const broken: ThemeStorage = {
      getItem: (): string | null => { throw new Error('blocked') },
      setItem: (): void => { throw new Error('blocked') }
    }
    expect(() => writeThemePref('light', broken)).not.toThrow()
  })

  it('notifies local subscribers, and stops after unsubscribe', () => {
    const seen: Theme[] = []
    const unsubscribe = subscribeTheme((theme: Theme): void => { seen.push(theme) })
    try {
      writeThemePref('light', null)
      expect(seen).toEqual(['light'])
      writeThemePref('dark', null)
      expect(seen).toEqual(['light', 'dark'])
    } finally {
      unsubscribe()
    }
    writeThemePref('light', null)
    expect(seen).toEqual(['light', 'dark'])
  })
})

describe('applyTheme', () => {
  it('adds the dark class for dark and removes it for light', () => {
    const darkDoc = fakeDocument(false)
    applyTheme(darkDoc, 'dark')
    expect(darkDoc.classes.has('dark')).toBe(true)
    applyTheme(darkDoc, 'dark')
    expect(darkDoc.classes.has('dark')).toBe(true)

    const lightDoc = fakeDocument(true)
    applyTheme(lightDoc, 'light')
    expect(lightDoc.classes.has('dark')).toBe(false)
    applyTheme(lightDoc, 'light')
    expect(lightDoc.classes.has('dark')).toBe(false)
  })
})

describe('getTheme and cross-window storage events', () => {
  it('reports dark in an environment without localStorage', () => {
    expect(getTheme()).toBe('dark')
  })

  it('reacts to a theme saved by another window, ignoring other keys', () => {
    const handlers: Array<(event: StorageEvent) => void> = []
    vi.stubGlobal('window', {
      addEventListener: (type: string, handler: (event: StorageEvent) => void): void => {
        if (type === 'storage') {
          handlers.push(handler)
        }
      }
    })
    vi.stubGlobal('localStorage', fakeStorage('light').storage)
    const seen: Theme[] = []
    const unsubscribe = subscribeTheme((theme: Theme): void => { seen.push(theme) })
    try {
      expect(handlers).toHaveLength(1)
      handlers[0]({ key: THEME_STORAGE_KEY } as StorageEvent)
      expect(seen).toEqual(['light'])
      handlers[0]({ key: 'sessiondeck.other' } as StorageEvent)
      expect(seen).toEqual(['light'])
      handlers[0]({ key: null } as StorageEvent)
      expect(seen).toEqual(['light', 'light'])
    } finally {
      unsubscribe()
    }
  })
})
