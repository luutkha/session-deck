// "Reset Terminal Modes" (right-click menu): the escape sequences that undo the terminal modes a full-screen program
// turns on. A program that dies (or fails to start, like Claude's fullscreen UI on a PC where it keeps failing) can leave
// them on: the alternate screen has no scrollback, and mouse reporting makes the wheel and text selection go to the
// program instead of the terminal. The sequences are written to the terminal only (never to the program), and nothing
// on screen is erased: leaving the alternate screen brings the normal buffer with its scrollback back.
const ESC = '\u001b'

/** Private modes to switch off: alt screen (1049, 1047, 47), mouse reporting (9, 1000-1003, 1005, 1006, 1015), focus events (1004). */
const PRIVATE_MODES_OFF = [1049, 1047, 47, 9, 1000, 1001, 1002, 1003, 1005, 1006, 1015, 1004] as const

/** Switches the full-screen modes off and shows the cursor again. Safe to send to a terminal that has none of them on. */
export const RESET_TERMINAL_MODES = `${PRIVATE_MODES_OFF.map((mode: number): string => `${ESC}[?${String(mode)}l`).join('')}${ESC}[?25h`
