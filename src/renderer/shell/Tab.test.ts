import { describe, expect, it } from 'vitest'
import { tabPropsEqual, type TabProps } from './Tab'

const noop = (): void => undefined
const base: TabProps = {
  tab: { id: 'a', title: 'A', run: 'running', attention: null },
  active: false,
  onActivate: noop,
  onClose: noop,
  onCloseOthers: noop,
  onCloseAll: noop
}

describe('tabPropsEqual', () => {
  it('is equal for a rebuilt tab model with the same content', () => {
    expect(tabPropsEqual(base, { ...base, tab: { ...base.tab } })).toBe(true)
  })

  it('differs when anything the tab shows changes', () => {
    for (const change of [{ title: 'B' }, { run: 'exited' as const }, { attention: 'permission' as const }, { exitCode: 1 }, { sleeping: true },
      { activity: 'working' as const }, { agent: 'opencode' as const }, { remote: true }]) {
      expect(tabPropsEqual(base, { ...base, tab: { ...base.tab, ...change } })).toBe(false)
    }
  })

  it('differs when the active flag or a callback changes', () => {
    expect(tabPropsEqual(base, { ...base, active: true })).toBe(false)
    expect(tabPropsEqual(base, { ...base, onActivate: () => undefined })).toBe(false)
    expect(tabPropsEqual(base, { ...base, onClose: () => undefined })).toBe(false)
    expect(tabPropsEqual(base, { ...base, onCloseOthers: () => undefined })).toBe(false)
    expect(tabPropsEqual(base, { ...base, onCloseAll: () => undefined })).toBe(false)
  })

  it('compares the split info by content, not by object identity', () => {
    const split = { visible: true, canOpenToSide: true, onOpenToSide: noop }
    expect(tabPropsEqual({ ...base, split }, { ...base, split: { ...split } })).toBe(true)
    expect(tabPropsEqual({ ...base, split }, { ...base, split: { ...split, visible: false } })).toBe(false)
    expect(tabPropsEqual({ ...base, split }, { ...base, split: { ...split, onOpenToSide: () => undefined } })).toBe(false)
    expect(tabPropsEqual({ ...base, split }, base)).toBe(false)
    expect(tabPropsEqual(base, { ...base })).toBe(true)
  })
})
