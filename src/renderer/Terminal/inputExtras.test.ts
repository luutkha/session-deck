import { describe, expect, it } from 'vitest'
import { CLAUDE_PASTE_IMAGE_KEYS, OPENCODE_PASTE_IMAGE_KEYS, pasteImageKeysFor } from './inputExtras'

describe('pasteImageKeysFor (D81)', () => {
  it('uses OpenCode\'s Ctrl+V keys only for OpenCode', () => {
    expect(pasteImageKeysFor('opencode')).toBe(OPENCODE_PASTE_IMAGE_KEYS)
  })

  it('uses Claude\'s Alt+V keys for Claude, Cursor, Shell and an absent agent', () => {
    for (const agent of ['claude', 'cursor', 'shell', undefined] as const) {
      expect(pasteImageKeysFor(agent)).toBe(CLAUDE_PASTE_IMAGE_KEYS)
    }
  })
})
