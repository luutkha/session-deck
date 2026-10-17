import { describe, it, expect } from 'vitest'
import { shouldHideOnClose } from './closeToTray'

describe('shouldHideOnClose', () => {
  it('hides when not quitting, close-to-tray is on and a tray exists', () => {
    expect(shouldHideOnClose({ quitting: false, closeToTray: true, trayAvailable: true })).toBe(true)
  })

  it('does not hide during an explicit quit', () => {
    expect(shouldHideOnClose({ quitting: true, closeToTray: true, trayAvailable: true })).toBe(false)
  })

  it('does not hide when close-to-tray is off', () => {
    expect(shouldHideOnClose({ quitting: false, closeToTray: false, trayAvailable: true })).toBe(false)
  })

  it('does not hide when there is no tray (so the close quits the app)', () => {
    expect(shouldHideOnClose({ quitting: false, closeToTray: true, trayAvailable: false })).toBe(false)
  })

  it('does not hide when every condition fails', () => {
    expect(shouldHideOnClose({ quitting: true, closeToTray: false, trayAvailable: false })).toBe(false)
  })
})
