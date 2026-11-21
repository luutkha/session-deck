import type { BrowserWindow } from 'electron'
import { describe, expect, it } from 'vitest'
import { createViewerWindowSet } from './viewerWindows'

function fake(): { win: BrowserWindow; close: () => void; focused: () => number } {
  let destroyed = false
  let focus = 0
  let onClosed: (() => void) | null = null
  const win = {
    isDestroyed: (): boolean => destroyed,
    isMinimized: (): boolean => false,
    restore: (): void => undefined,
    focus: (): void => { focus++ },
    once: (_event: string, cb: () => void): void => { onClosed = cb }
  } as unknown as BrowserWindow
  return { win, close: (): void => { destroyed = true; onClosed?.() }, focused: (): number => focus }
}

describe('viewer window cap', () => {
  it('opens up to the cap, then focuses the oldest instead of opening another', () => {
    const set = createViewerWindowSet(2)
    const a = fake()
    const b = fake()
    expect(set.request(() => a.win)).toBe(true)
    expect(set.request(() => b.win)).toBe(true)
    let created = 0
    expect(set.request(() => { created++; return fake().win })).toBe(false)
    expect(created).toBe(0)
    expect(a.focused()).toBe(1)
  })

  it('a closed window frees its slot', () => {
    const set = createViewerWindowSet(1)
    const a = fake()
    expect(set.request(() => a.win)).toBe(true)
    a.close()
    expect(set.request(() => fake().win)).toBe(true)
  })
})
