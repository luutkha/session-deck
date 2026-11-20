import { describe, expect, it } from 'vitest'
import { parseSupportsStandalone } from './capabilities'

// Help output shapes, trimmed to the lines that matter (the probe itself is cached and not spawned in tests).
const HELP_V2 = `opencode [project]

Commands:
  opencode [project]                                  start the TUI

Options:
  -s, --session <id>                                  resume a session
      --standalone                                    use a private server for this process
  -h, --help                                          show help
`

const HELP_V1 = `opencode [project]

Options:
  -s, --session <id>                                  resume a session
  -h, --help                                          show help
`

describe('parseSupportsStandalone', () => {
  it('finds the flag in v2.x help text', () => {
    expect(parseSupportsStandalone(HELP_V2)).toBe(true)
  })
  it('reports no support for v1-style help without the flag', () => {
    expect(parseSupportsStandalone(HELP_V1)).toBe(false)
  })
  it('reports no support for empty help text', () => {
    expect(parseSupportsStandalone('')).toBe(false)
  })
})
