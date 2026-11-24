import type { BrowserWindow } from 'electron'
import { describe, expect, it } from 'vitest'
import { createChangesWindowSet, pickSessionForChanges } from './changesWindows'

interface FakeWindow {
  readonly win: BrowserWindow
  close: () => void
  destroy: () => void
  minimize: () => void
  focused: () => number
  restored: () => number
}

function fake(): FakeWindow {
  let destroyed = false
  let minimized = false
  let focus = 0
  let restore = 0
  let onClosed: (() => void) | null = null
  const win = {
    isDestroyed: (): boolean => destroyed,
    isMinimized: (): boolean => minimized,
    restore: (): void => { restore++; minimized = false },
    focus: (): void => { focus++ },
    close: (): void => { destroyed = true; onClosed?.() },
    once: (_event: string, cb: () => void): void => { onClosed = cb }
  } as unknown as BrowserWindow
  return {
    win,
    close: (): void => { destroyed = true; onClosed?.() },
    destroy: (): void => { destroyed = true },
    minimize: (): void => { minimized = true },
    focused: (): number => focus,
    restored: (): number => restore
  }
}

describe('detached Changes windows', () => {
  it('opens one window per worktree and focuses it on a second request', () => {
    const set = createChangesWindowSet()
    const a = fake()
    let created = 0
    expect(set.request('wt-a', () => { created++; return a.win })).toBe(true)
    expect(set.request('wt-a', () => { created++; return fake().win })).toBe(false)
    expect(created).toBe(1)
    expect(a.focused()).toBe(1)
  })

  it('restores a minimised window of the same worktree', () => {
    const set = createChangesWindowSet()
    const a = fake()
    expect(set.request('wt-a', () => a.win)).toBe(true)
    a.minimize()
    expect(set.request('wt-a', () => fake().win)).toBe(false)
    expect(a.restored()).toBe(1)
    expect(a.focused()).toBe(1)
  })

  it('opens a different worktree in its own window', () => {
    const set = createChangesWindowSet()
    const a = fake()
    const b = fake()
    expect(set.request('wt-a', () => a.win)).toBe(true)
    expect(set.request('wt-b', () => b.win)).toBe(true)
  })

  it('at the cap focuses the oldest instead of opening another', () => {
    const set = createChangesWindowSet(2)
    const a = fake()
    const b = fake()
    expect(set.request('wt-a', () => a.win)).toBe(true)
    expect(set.request('wt-b', () => b.win)).toBe(true)
    let created = 0
    expect(set.request('wt-c', () => { created++; return fake().win })).toBe(false)
    expect(created).toBe(0)
    expect(a.focused()).toBe(1)
  })

  it('a closed window frees its slot', () => {
    const set = createChangesWindowSet(1)
    const a = fake()
    expect(set.request('wt-a', () => a.win)).toBe(true)
    a.close()
    expect(set.request('wt-b', () => fake().win)).toBe(true)
  })

  it('a destroyed window that never reported closed is pruned', () => {
    const set = createChangesWindowSet(1)
    const a = fake()
    expect(set.request('wt-a', () => a.win)).toBe(true)
    a.destroy()
    expect(set.request('wt-a', () => fake().win)).toBe(true)
  })

  it('close returns whether the worktree had a window and frees its slot', () => {
    const set = createChangesWindowSet(1)
    const a = fake()
    expect(set.request('wt-a', () => a.win)).toBe(true)
    expect(set.close('wt-a')).toBe(true)
    expect(set.close('wt-a')).toBe(false)
    expect(set.request('wt-b', () => fake().win)).toBe(true)
  })

  it('close ignores a destroyed window that never reported closed', () => {
    const set = createChangesWindowSet()
    const a = fake()
    expect(set.request('wt-a', () => a.win)).toBe(true)
    a.destroy()
    expect(set.close('wt-a')).toBe(false)
  })
})

describe('pickSessionForChanges', () => {
  const session = (id: string, worktreeId: string | undefined, extra: { readonly closedAt?: number } = {}) => ({ id, worktreeId, ...extra })

  it('prefers the session already on screen', () => {
    const sessions = [session('a', 'wt'), session('b', 'wt'), session('c', 'wt')]
    expect(pickSessionForChanges(sessions, 'wt', 'b', (id) => id === 'a')?.id).toBe('b')
  })

  it('otherwise prefers a running one', () => {
    const sessions = [session('a', 'wt'), session('b', 'wt'), session('c', 'wt')]
    expect(pickSessionForChanges(sessions, 'wt', null, (id) => id === 'c')?.id).toBe('c')
  })

  it('otherwise takes the first open session of that worktree', () => {
    const sessions = [session('closed', 'wt', { closedAt: 1 }), session('other', 'wt-2'), session('first', 'wt'), session('second', 'wt')]
    expect(pickSessionForChanges(sessions, 'wt', null)?.id).toBe('first')
  })

  it('returns undefined when the worktree has no open session', () => {
    expect(pickSessionForChanges([session('a', 'wt', { closedAt: 1 })], 'wt', 'a')).toBeUndefined()
    expect(pickSessionForChanges([], 'wt', null)).toBeUndefined()
  })
})
