import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { storageKeyFor } from '../mode/modeLogic'
import { SESSION_SORT_STORAGE_KEY, useSessionSort } from './useSessionSort'
import type { SessionSort } from './sessionSort'

// The sort hook is React-only except for its localStorage read/write, and the suite runs in node (no DOM, no
// renderer). So React's hooks are replaced by the smallest stub that runs the initial state and the effects:
// that exercises the persistence code itself without rendering a component.
const reactMock = vi.hoisted(() => {
  const state: { values: unknown[]; cursor: number } = { values: [], cursor: 0 }
  return {
    reset(): void {
      state.values = []
      state.cursor = 0
    },
    useState<T>(initial: T | (() => T)): readonly [T, (next: T) => void] {
      const index = state.cursor++
      if (!(index in state.values)) {
        state.values[index] = typeof initial === 'function' ? (initial as () => T)() : initial
      }
      const set = (next: T): void => {
        state.values[index] = next
      }
      return [state.values[index] as T, set] as const
    },
    useRef<T>(initial: T): { current: T } {
      const index = state.cursor++
      if (!(index in state.values)) state.values[index] = { current: initial }
      return state.values[index] as { current: T }
    },
    useCallback<T>(callback: T): T {
      state.cursor++
      return callback
    },
    useEffect(effect: () => void): void {
      effect()
    }
  }
})

vi.mock('react', () => reactMock)

interface StorageStub {
  readonly values: Map<string, string>
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function storageStub(initial: Record<string, string> = {}): StorageStub {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      values.set(key, value)
    }
  }
}

const OPS_KEY = storageKeyFor(SESSION_SORT_STORAGE_KEY, 'ops')
const CODE_KEY = storageKeyFor(SESSION_SORT_STORAGE_KEY, 'code')

describe('useSessionSort persistence (D61)', () => {
  let store: StorageStub

  beforeEach(() => {
    reactMock.reset()
    store = storageStub()
    vi.stubGlobal('window', { localStorage: store })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    reactMock.reset()
  })

  /** Mounts the hook once, like a fresh window would, and returns the sort it starts with. */
  function mountSort(mode: 'ops' | 'code'): SessionSort {
    reactMock.reset()
    return useSessionSort(mode)[0]
  }

  it('reads the sort saved for each mode from its own key', () => {
    store = storageStub({ [OPS_KEY]: 'name', [CODE_KEY]: 'recent' })
    vi.stubGlobal('window', { localStorage: store })
    expect(mountSort('ops')).toBe('name')
    expect(mountSort('code')).toBe('recent')
  })

  it('defaults to manual when nothing was saved, and saves that choice', () => {
    expect(mountSort('ops')).toBe('manual')
    expect(store.values.get(OPS_KEY)).toBe('manual')
    expect(mountSort('code')).toBe('manual')
    expect(store.values.get(CODE_KEY)).toBe('manual')
  })

  it('writing one mode does not touch the other mode key', () => {
    store = storageStub({ [CODE_KEY]: 'recent' })
    vi.stubGlobal('window', { localStorage: store })
    expect(mountSort('ops')).toBe('manual')
    expect(store.values.get(OPS_KEY)).toBe('manual')
    expect(store.values.get(CODE_KEY)).toBe('recent')
  })

  it('falls back to manual when the stored value is not a known sort', () => {
    store = storageStub({ [OPS_KEY]: 'sideways' })
    vi.stubGlobal('window', { localStorage: store })
    expect(mountSort('ops')).toBe('manual')
    expect(store.values.get(OPS_KEY)).toBe('manual')
  })

  it('falls back to manual when reading localStorage throws', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (): string | null => {
          throw new Error('blocked')
        },
        setItem: (): void => {}
      }
    })
    expect(mountSort('ops')).toBe('manual')
  })

  it('keeps the sort for this run when writing localStorage throws', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (): string | null => null,
        setItem: (): void => {
          throw new Error('quota')
        }
      }
    })
    expect(() => mountSort('code')).not.toThrow()
    expect(mountSort('code')).toBe('manual')
  })
})
