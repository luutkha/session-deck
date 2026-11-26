import type { ITerminalOptions, ITheme } from '@xterm/xterm'
import { effectiveScrollback, fontSizeFor, type TermView } from './termView'
import { DEFAULT_THEME, type Theme } from '../theme/themePref'

const FONT_FAMILY = "'Cascadia Code', 'Cascadia Mono', Consolas, 'Courier New', monospace"
const FONT_SIZE = 14
const LINE_HEIGHT = 1.0
const SCROLLBACK_LINES = 10_000
const SMOOTH_SCROLL_OFF = 0

/** VS Code Dark+ terminal palette. */
export const TERMINAL_THEME: ITheme = {
  background: '#000000',
  foreground: '#cccccc',
  cursor: '#cccccc',
  cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5'
}

/** VS Code Light+-style terminal palette (D89): dark ANSI inks readable on a white background. */
export const LIGHT_TERMINAL_THEME: ITheme = {
  background: '#ffffff',
  foreground: '#1e1e1e',
  cursor: '#1e1e1e',
  cursorAccent: '#ffffff',
  selectionBackground: '#b4d5fe',
  black: '#1e1e1e',
  red: '#cd3131',
  green: '#137800',
  yellow: '#8a6d00',
  blue: '#0451a5',
  magenta: '#a315a3',
  cyan: '#0e7490',
  white: '#595959',
  brightBlack: '#666666',
  brightRed: '#c00000',
  brightGreen: '#008000',
  brightYellow: '#8a6d00',
  brightBlue: '#0451a5',
  brightMagenta: '#a315a3',
  brightCyan: '#0e7490',
  brightWhite: '#262626'
}

/** The palette a pane is built with; the dark object is unchanged (D89). */
export function terminalThemeFor(theme: Theme): ITheme {
  return theme === 'light' ? LIGHT_TERMINAL_THEME : TERMINAL_THEME
}

/**
 * Options every terminal pane is constructed with. `convertEol` and
 * `windowsMode` stay off: ConPTY already emits CRLF and handles win32
 * quirks. `smoothScrollDuration` is 0 so burst output never lags behind.
 */
export const TERMINAL_OPTIONS: ITerminalOptions = {
  fontFamily: FONT_FAMILY,
  fontSize: FONT_SIZE,
  lineHeight: LINE_HEIGHT,
  cursorBlink: true,
  cursorStyle: 'block',
  scrollback: SCROLLBACK_LINES,
  allowProposedApi: true,
  convertEol: false,
  windowsMode: false,
  smoothScrollDuration: SMOOTH_SCROLL_OFF,
  theme: TERMINAL_THEME
}

/** Whether reduced effects are on and whether the profile came from a saved user value. */
export interface ScrollbackContext {
  readonly reducedEffects: boolean
  readonly explicit: boolean
}

/**
 * The options a NEW pane is constructed with for a terminal profile (zoom + scrollback, D-Bar):
 * the base options with the profile's font size and scrollback. Live zoom changes fontSize on
 * mounted panes (paneFactory.applyTerminalFontSize); scrollback is a construction option, so
 * reduced effects can only lower it here (W4-H). Without a context the profile is used as-is.
 */
export function terminalOptionsFor(
  view: TermView,
  scrollback?: ScrollbackContext,
  theme: Theme = DEFAULT_THEME
): ITerminalOptions {
  return {
    ...TERMINAL_OPTIONS,
    fontSize: fontSizeFor(view.zoomPercent),
    theme: terminalThemeFor(theme),
    scrollback: scrollback === undefined
      ? view.scrollbackLines
      : effectiveScrollback({ reducedEffects: scrollback.reducedEffects, view, explicit: scrollback.explicit })
  }
}
