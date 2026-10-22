import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SIDE_PANEL_TAB,
  SIDE_PANEL_TAB_KEY,
  parseSidePanelTab,
  readSidePanelTab,
  storeSidePanelTab
} from './sidePanelTab'

function stubStorage(storage: Partial<Storage>): void {
  vi.stubGlobal('window', { localStorage: storage })
}

describe('parseSidePanelTab', () => {
  it('reads activity as the Activity tab', () => {
    expect(parseSidePanelTab('activity')).toBe('activity')
  })

  it('reads notes as the Notes tab', () => {
    expect(parseSidePanelTab('notes')).toBe('notes')
  })

  it('falls back to Notes for a missing value', () => {
    expect(parseSidePanelTab(null)).toBe('notes')
  })

  it('falls back to Notes for an unknown value', () => {
    expect(parseSidePanelTab('settings')).toBe(DEFAULT_SIDE_PANEL_TAB)
  })
})

describe('readSidePanelTab and storeSidePanelTab', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation((): void => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reads the tab stored under the versioned key', () => {
    const getItem = vi.fn((): string => 'activity')
    stubStorage({ getItem })
    expect(readSidePanelTab()).toBe('activity')
    expect(getItem).toHaveBeenCalledWith(SIDE_PANEL_TAB_KEY)
  })

  it('writes the chosen tab under the versioned key', () => {
    const setItem = vi.fn()
    stubStorage({ setItem })
    storeSidePanelTab('activity')
    expect(setItem).toHaveBeenCalledWith(SIDE_PANEL_TAB_KEY, 'activity')
  })

  it('uses Notes when reading throws (storage blocked)', () => {
    stubStorage({
      getItem: (): string => {
        throw new Error('SecurityError')
      }
    })
    expect(readSidePanelTab()).toBe('notes')
    expect(console.warn).toHaveBeenCalled()
  })

  it('does not throw when writing fails (storage full or blocked)', () => {
    stubStorage({
      setItem: (): void => {
        throw new Error('QuotaExceededError')
      }
    })
    expect(() => storeSidePanelTab('notes')).not.toThrow()
    expect(console.warn).toHaveBeenCalled()
  })

  it('uses Notes when there is no window at all', () => {
    expect(readSidePanelTab()).toBe('notes')
  })
})
