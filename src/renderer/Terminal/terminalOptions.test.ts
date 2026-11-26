import { DEFAULT_TERM_VIEW } from './termView'
import {
  LIGHT_TERMINAL_THEME,
  TERMINAL_OPTIONS,
  TERMINAL_THEME,
  terminalOptionsFor,
  terminalThemeFor
} from './terminalOptions'

const ANSI_COLOR_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
] as const

const HEX_COLOR = /^#[0-9a-f]{6}$/i

describe('TERMINAL_OPTIONS', () => {
  it('uses the Cascadia-first monospace font stack', () => {
    expect(TERMINAL_OPTIONS.fontFamily).toBe(
      "'Cascadia Code', 'Cascadia Mono', Consolas, 'Courier New', monospace"
    )
  })

  it('uses font size 14 with a tight 1.0 line height', () => {
    expect(TERMINAL_OPTIONS.fontSize).toBe(14)
    expect(TERMINAL_OPTIONS.lineHeight).toBe(1.0)
  })

  it('uses a blinking block cursor', () => {
    expect(TERMINAL_OPTIONS.cursorBlink).toBe(true)
    expect(TERMINAL_OPTIONS.cursorStyle).toBe('block')
  })

  it('keeps 10k lines of scrollback', () => {
    expect(TERMINAL_OPTIONS.scrollback).toBe(10_000)
  })

  it('enables the proposed API (required by the unicode11 addon)', () => {
    expect(TERMINAL_OPTIONS.allowProposedApi).toBe(true)
  })

  it('does not convert EOLs; ConPTY output is passed through verbatim', () => {
    expect(TERMINAL_OPTIONS.convertEol).toBe(false)
  })

  it('disables windowsMode because ConPTY handles win32 quirks itself', () => {
    expect(TERMINAL_OPTIONS.windowsMode).toBe(false)
  })

  it('disables smooth scrolling so output never lags', () => {
    expect(TERMINAL_OPTIONS.smoothScrollDuration).toBe(0)
  })

  it('points theme at the exported dark theme', () => {
    expect(TERMINAL_OPTIONS.theme).toBe(TERMINAL_THEME)
  })
})

describe('terminalOptionsFor', () => {
  it('keeps the profile scrollback when no reduced-effects context is given', () => {
    expect(terminalOptionsFor(DEFAULT_TERM_VIEW).scrollback).toBe(10_000)
  })

  it('uses the smaller scrollback only for reduced effects without a saved profile', () => {
    expect(terminalOptionsFor(DEFAULT_TERM_VIEW, { reducedEffects: true, explicit: false }).scrollback).toBe(2_000)
    expect(terminalOptionsFor(DEFAULT_TERM_VIEW, { reducedEffects: true, explicit: true }).scrollback).toBe(10_000)
    expect(terminalOptionsFor(DEFAULT_TERM_VIEW, { reducedEffects: false, explicit: false }).scrollback).toBe(10_000)
  })

  it('keeps the dark palette by default and builds a light pane on request (D89)', () => {
    expect(terminalOptionsFor(DEFAULT_TERM_VIEW).theme).toBe(TERMINAL_THEME)
    expect(terminalOptionsFor(DEFAULT_TERM_VIEW, undefined, 'light').theme).toBe(LIGHT_TERMINAL_THEME)
  })
})

describe('TERMINAL_THEME', () => {
  it('uses the VS Code dark background and foreground', () => {
    expect(TERMINAL_THEME.background).toBe('#000000')
    expect(TERMINAL_THEME.foreground).toBe('#cccccc')
  })

  it('defines all 16 ANSI colors as hex colors', () => {
    for (const name of ANSI_COLOR_KEYS) {
      const value = TERMINAL_THEME[name]
      expect(typeof value, `theme.${name} must be set`).toBe('string')
      expect(value, `theme.${name} must be a #rrggbb color`).toMatch(HEX_COLOR)
    }
  })

  it('uses the VS Code dark ANSI palette', () => {
    expect(TERMINAL_THEME.red).toBe('#cd3131')
    expect(TERMINAL_THEME.green).toBe('#0dbc79')
    expect(TERMINAL_THEME.blue).toBe('#2472c8')
    expect(TERMINAL_THEME.brightBlue).toBe('#3b8eea')
    expect(TERMINAL_THEME.brightWhite).toBe('#e5e5e5')
  })
})

describe('LIGHT_TERMINAL_THEME (D89)', () => {
  it('is selected only for the light preference', () => {
    expect(terminalThemeFor('dark')).toBe(TERMINAL_THEME)
    expect(terminalThemeFor('light')).toBe(LIGHT_TERMINAL_THEME)
  })

  it('has a light background with dark text and all 16 ANSI colours', () => {
    expect(LIGHT_TERMINAL_THEME.background).toBe('#ffffff')
    expect(LIGHT_TERMINAL_THEME.foreground).toBe('#1e1e1e')
    for (const name of ANSI_COLOR_KEYS) {
      expect(LIGHT_TERMINAL_THEME[name], `theme.${name} must be a #rrggbb color`).toMatch(HEX_COLOR)
    }
  })

  it('keeps the ANSI inks dark enough to read on white', () => {
    expect(LIGHT_TERMINAL_THEME.green).toBe('#137800')
    expect(LIGHT_TERMINAL_THEME.blue).toBe('#0451a5')
    expect(LIGHT_TERMINAL_THEME.white).toBe('#595959')
  })
})
