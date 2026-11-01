// What a session's terminal shows, as plain text (D53 read_screen): the pty replay is drawn into a headless xterm of
// the same size, so cursor moves and redraws of a full-screen TUI end up as the lines a person would see.
import xtermHeadless from '@xterm/headless'

const { Terminal } = xtermHeadless

export const SCREEN_LINES_DEFAULT = 40
export const SCREEN_LINES_MAX = 300

/** The last `lines` lines of the rendered screen (scrollback included), trailing blank lines dropped. */
export function renderScreenText(data: string, cols: number, rows: number, lines: number): Promise<string> {
  const term = new Terminal({ cols, rows, scrollback: SCREEN_LINES_MAX, allowProposedApi: true })
  return new Promise((resolve) => {
    term.write(data, () => {
      const buffer = term.buffer.active
      const all: string[] = []
      for (let i = 0; i < buffer.length; i += 1) all.push(buffer.getLine(i)?.translateToString(true) ?? '')
      while (all.length > 0 && all[all.length - 1].trim() === '') all.pop()
      term.dispose()
      resolve(all.slice(-lines).join('\n'))
    })
  })
}
