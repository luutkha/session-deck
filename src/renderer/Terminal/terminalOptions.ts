import type { ITerminalOptions, ITheme } from '@xterm/xterm'
import { effectiveScrollback, fontSizeFor, type TermView } from './termView'

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
export function terminalOptionsFor(view: TermView, scrollback?: ScrollbackContext): ITerminalOptions {
  return {
    ...TERMINAL_OPTIONS,
    fontSize: fontSizeFor(view.zoomPercent),
    scrollback: scrollback === undefined
      ? view.scrollbackLines
      : effectiveScrollback({ reducedEffects: scrollback.reducedEffects, view, explicit: scrollback.explicit })
  }
}
