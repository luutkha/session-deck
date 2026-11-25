import { describe, expect, it, vi } from 'vitest'
import xtermHeadless from '@xterm/headless'
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

  // --- memoization (performance review): an idle replay must not rebuild a headless xterm

  it('renders an unchanged replay once and reuses the text', async () => {
    const writes = vi.spyOn(xtermHeadless.Terminal.prototype, 'write')
    try {
      const data = 'one idle session\n' + 'x'.repeat(1000)
      const first = await renderScreenText(data, 80, 24, 10)
      const second = await renderScreenText(data, 80, 24, 10)
      expect(second).toBe(first)
      expect(writes).toHaveBeenCalledTimes(1)
    } finally {
      writes.mockRestore()
    }
  })

  it('rebuilds when the tail of the replay changes', async () => {
    const writes = vi.spyOn(xtermHeadless.Terminal.prototype, 'write')
    try {
      const head = 'a'.repeat(600) + '\n' + 'b'.repeat(600) + '\n'
      await renderScreenText(head + 'before', 80, 24, 10)
      await renderScreenText(head + 'before', 80, 24, 10)
      expect(writes).toHaveBeenCalledTimes(1)
      await renderScreenText(head + 'AFTERX', 80, 24, 10) // same length, different last-512 fingerprint
      expect(writes).toHaveBeenCalledTimes(2)
    } finally {
      writes.mockRestore()
    }
  })

  it('rebuilds when a sampled middle slice changes but head, tail and length do not', async () => {
    const writes = vi.spyOn(xtermHeadless.Terminal.prototype, 'write')
    try {
      const chars = Array.from({ length: 2500 }, (_, i) => String.fromCharCode(97 + (i % 26)))
      const data = chars.join('')
      await renderScreenText(data, 80, 24, 10)
      const start = Math.floor((data.length - 32) * 8 / 15)
      chars[start] = chars[start] === '#' ? '@' : '#'
      const changed = chars.join('')
      expect(changed.length).toBe(data.length)
      expect(changed.slice(0, 512)).toBe(data.slice(0, 512))
      expect(changed.slice(-512)).toBe(data.slice(-512))
      await renderScreenText(changed, 80, 24, 10)
      expect(writes).toHaveBeenCalledTimes(2)
    } finally {
      writes.mockRestore()
    }
  })

  it('rebuilds when cols, rows or the requested line count changes', async () => {
    const writes = vi.spyOn(xtermHeadless.Terminal.prototype, 'write')
    try {
      const data = 'dimensions matter'
      await renderScreenText(data, 80, 24, 10)
      await renderScreenText(data, 81, 24, 10)
      await renderScreenText(data, 81, 25, 10)
      await renderScreenText(data, 81, 25, 11)
      expect(writes).toHaveBeenCalledTimes(4)
    } finally {
      writes.mockRestore()
    }
  })

  it('bounds the memo cache to 32 replays', async () => {
    const writes = vi.spyOn(xtermHeadless.Terminal.prototype, 'write')
    try {
      for (let i = 0; i <= 32; i += 1) await renderScreenText(`bounded ${i}`, 40, 10, 5)
      expect(writes).toHaveBeenCalledTimes(33)
      await renderScreenText('bounded 0', 40, 10, 5) // evicted by the 33rd distinct replay
      expect(writes).toHaveBeenCalledTimes(34)
    } finally {
      writes.mockRestore()
    }
  })
})
