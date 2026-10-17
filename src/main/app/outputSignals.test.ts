import { describe, expect, it } from 'vitest'
import { detectOutputSignals, stripAnsi } from './outputSignals'

describe('stripAnsi', () => {
  it('removes colour, cursor and OSC sequences', () => {
    expect(stripAnsi('\x1b[33mhi\x1b[39m\x1b[2K\x1b]0;title\x07 there')).toBe('hi there')
  })
})

describe('detectOutputSignals', () => {
  it('sees the Remote Control footer, even with spaces squeezed out by cursor moves', () => {
    expect(detectOutputSignals('\x1b[2m/rc active\x1b[0m').remoteControl).toBe(true)
    expect(detectOutputSignals('effort/rcactive').remoteControl).toBe(true)
    expect(detectOutputSignals('  /remote-control is active · Continue here').remoteControl).toBe(true)
  })

  it('does not report Remote Control while it is only connecting or absent', () => {
    expect(detectOutputSignals('/rc connecting…').remoteControl).toBe(false)
    expect(detectOutputSignals('plain output').remoteControl).toBe(false)
  })

  it('sees the spinner of a running turn', () => {
    expect(detectOutputSignals('Kerfuffling… (3s · ↓ 25 tokens)').working).toBe(true)
    expect(detectOutputSignals('(12s · ↑ 1.2k tokens)').working).toBe(true)
  })

  it('does not call a quiet prompt working', () => {
    expect(detectOutputSignals('❯ Try "how do I log an error?"').working).toBe(false)
  })
})
