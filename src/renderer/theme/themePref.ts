// Optional light theme (D89). Dark stays the default: the only thing that changes is the
// `dark` class on <html>, which switches the Orca token palettes and every `dark:` utility.
// Renderer-only, per-viewer preference in localStorage; all access is wrapped in try/catch
// (private mode / quota can throw), and a failed read means Dark. Pure logic only (no React).
export type Theme = 'dark' | 'light'

export const DEFAULT_THEME: Theme = 'dark'
export const THEME_STORAGE_KEY = 'sessiondeck.theme'

/** The two storage methods this module needs, kept small so a test can pass a fake. */
export interface ThemeStorage {
  readonly getItem: (key: string) => string | null
  readonly setItem: (key: string, value: string) => void
}

/** The part of Document we touch, kept small so a test can pass a fake. */
export interface ThemeDocument {
  readonly documentElement: {
    readonly classList: {
      add: (token: string) => void
      remove: (token: string) => void
    }
  }
}

function globalStorage(): ThemeStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Anything but the exact string 'light' is Dark (an old or hand-edited key never breaks the UI). */
export function parseTheme(raw: string | null): Theme {
  return raw === 'light' ? 'light' : DEFAULT_THEME
}

/** A failed or unavailable read means Dark. */
export function readThemePref(storage: ThemeStorage | null = globalStorage()): Theme {
  if (storage === null) {
    return DEFAULT_THEME
  }
  try {
    return parseTheme(storage.getItem(THEME_STORAGE_KEY))
  } catch {
    return DEFAULT_THEME
  }
}

/** Persists the choice and tells every local subscriber; a write failure still applies it this session. */
export function writeThemePref(theme: Theme, storage: ThemeStorage | null = globalStorage()): void {
  if (storage !== null) {
    try {
      storage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Storage can be blocked or full: keep the choice in memory for this window only.
    }
  }
  notify(theme)
}

/** Toggles the class Tailwind's `@custom-variant dark` reads. Idempotent. */
export function applyTheme(doc: ThemeDocument, theme: Theme): void {
  if (theme === 'light') {
    doc.documentElement.classList.remove('dark')
  } else {
    doc.documentElement.classList.add('dark')
  }
}

/** Snapshot for useSyncExternalStore: a primitive, so re-reading storage each time is stable. */
export function getTheme(): Theme {
  return readThemePref()
}

const listeners = new Set<(theme: Theme) => void>()

function notify(theme: Theme): void {
  for (const listener of listeners) {
    listener(theme)
  }
}

// Another window (main, viewer, detached Changes) changed the shared key: re-read it here.
// Rebinding when the window object changes keeps this testable without a DOM.
let boundWindow: unknown = null

function bindStorage(): void {
  const target: unknown = typeof window === 'undefined' ? null : window
  if (target === null || target === boundWindow) {
    return
  }
  boundWindow = target
  try {
    (target as Window).addEventListener('storage', (event: StorageEvent): void => {
      if (event.key !== null && event.key !== THEME_STORAGE_KEY) {
        return
      }
      notify(readThemePref())
    })
  } catch {
    // A stubbed or restricted window: the in-process subscription still works.
  }
}

/** Subscribes to local writes and cross-window storage events; returns an unsubscribe. */
export function subscribeTheme(listener: (theme: Theme) => void): () => void {
  bindStorage()
  listeners.add(listener)
  return (): void => {
    listeners.delete(listener)
  }
}
