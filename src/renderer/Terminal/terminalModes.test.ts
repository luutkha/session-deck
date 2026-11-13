import { describe, expect, it } from 'vitest'
import { RESET_TERMINAL_MODES } from './terminalModes'

describe('RESET_TERMINAL_MODES', () => {
  const sequences = RESET_TERMINAL_MODES.split('\u001b').filter((part: string): boolean => part.length > 0)

  it('only contains CSI private-mode reset sequences and the cursor-show sequence', () => {
    for (const sequence of sequences) {
      expect(sequence).toMatch(/^\[\?\d+[lh]$/)
    }
  })

  it('leaves the alternate screen in every variant (1049, 1047, 47)', () => {
    for (const mode of [1049, 1047, 47]) {
      expect(sequences).toContain(`[?${String(mode)}l`)
    }
  })

  it('turns off every mouse reporting mode and the SGR/urxvt encodings', () => {
    for (const mode of [9, 1000, 1001, 1002, 1003, 1005, 1006, 1015]) {
      expect(sequences).toContain(`[?${String(mode)}l`)
    }
  })

  it('turns the cursor back on and never switches a mode on except the cursor', () => {
    expect(sequences).toContain('[?25h')
    expect(sequences.filter((sequence: string): boolean => sequence.endsWith('h'))).toEqual(['[?25h'])
  })

  it('does not erase anything (no screen/scrollback clear, no reset)', () => {
    expect(RESET_TERMINAL_MODES).not.toMatch(/\[[0-9;]*[JK]/)
    expect(RESET_TERMINAL_MODES).not.toContain('\u001bc')
  })
})
