import { describe, expect, it } from 'vitest'
import { renderScreenText } from './screenText'

describe('renderScreenText', () => {
  it('applies cursor moves and overwrites like a real terminal', async () => {
    // "hello" on row 1, "world" on row 2, then the cursor goes home and overwrites "he".
    expect(await renderScreenText('hello\x1b[2;1Hworld\x1b[1;1HHE', 20, 5, 10)).toBe('HEllo\nworld')
  })

  it('keeps only the last lines and drops trailing blank ones', async () => {
    const data = Array.from({ length: 8 }, (_, i) => `line ${i}`).join('\r\n') + '\r\n\r\n'
    expect(await renderScreenText(data, 20, 5, 3)).toBe('line 5\nline 6\nline 7')
  })
})
