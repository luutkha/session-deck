import { describe, it, expect, vi } from 'vitest'
import { createLoginItem, type LoginItemApp } from './loginItem'

function fakeApp(isPackaged: boolean, openAtLogin = false): LoginItemApp & {
  setLoginItemSettings: ReturnType<typeof vi.fn>
  getLoginItemSettings: ReturnType<typeof vi.fn>
} {
  return {
    isPackaged,
    getLoginItemSettings: vi.fn(() => ({ openAtLogin })),
    setLoginItemSettings: vi.fn()
  }
}

describe('createLoginItem', () => {
  it('unpackaged: not supported, reports false, and never touches the OS setting', () => {
    const app = fakeApp(false, true)
    const item = createLoginItem(app)
    expect(item.get()).toEqual({ supported: false, openAtLogin: false })
    expect(app.getLoginItemSettings).not.toHaveBeenCalled()
  })

  it('unpackaged: set() is ignored and returns the unsupported state', () => {
    const app = fakeApp(false)
    const item = createLoginItem(app)
    expect(item.set(true)).toEqual({ supported: false, openAtLogin: false })
    expect(app.setLoginItemSettings).not.toHaveBeenCalled()
  })

  it('packaged: get() reads openAtLogin from the OS', () => {
    const item = createLoginItem(fakeApp(true, true))
    expect(item.get()).toEqual({ supported: true, openAtLogin: true })
  })

  it('packaged: set() calls setLoginItemSettings with only openAtLogin and returns the new state', () => {
    const app = fakeApp(true, false)
    app.setLoginItemSettings.mockImplementation(() => {
      app.getLoginItemSettings.mockReturnValue({ openAtLogin: true })
    })
    const item = createLoginItem(app)
    const state = item.set(true)
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true })
    expect(state).toEqual({ supported: true, openAtLogin: true })
  })
})
