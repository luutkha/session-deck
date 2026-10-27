import { describe, it, expect } from 'vitest'
import {
  appendTrustBuffer,
  isTrustPrompt,
  shouldAnswerTrustPrompt,
  TRUST_ANSWER_INPUT,
  TRUST_BUFFER_MAX
} from './trustPrompt'

const MENU = [
  'Do you trust the files in this folder?',
  '',
  '  Yes, I trust this folder',
  '  No, exit',
  ''
].join('\r\n')

function yes(overrides: Partial<Parameters<typeof shouldAnswerTrustPrompt>[0]> = {}) {
  return shouldAnswerTrustPrompt({
    enabled: true,
    agent: undefined,
    worktreeId: 'wt-1',
    firstStart: true,
    answered: false,
    ...overrides
  })
}

describe('isTrustPrompt', () => {
  it('recognises the real menu (both options on one screen)', () => {
    expect(isTrustPrompt(MENU)).toBe(true)
  })

  it('tolerates ANSI cursor movement between the words', () => {
    const styled = '\x1b[1mDo you trust the files in this folder?\x1b[0m\r\n\x1b[2mYes, I\x1b[0m trust this folder\r\nNo,\x1b[0m exit'
    expect(isTrustPrompt(styled)).toBe(true)
  })

  it('needs BOTH options, so ordinary prose mentioning trust is not enough', () => {
    expect(isTrustPrompt('Do you trust this folder? Yes, I trust this folder')).toBe(false)
    expect(isTrustPrompt('No, exit')).toBe(false)
  })

  it('is false for Claude\'s normal prompt', () => {
    expect(isTrustPrompt('> Try "how do I log an error?"')).toBe(false)
  })
})

describe('shouldAnswerTrustPrompt', () => {
  it('answers a fresh Claude worktree session when the setting is on', () => {
    expect(yes()).toBe(true)
    expect(yes({ agent: 'claude' })).toBe(true)
  })

  it('is off by default', () => {
    expect(yes({ enabled: false })).toBe(false)
  })

  it('never touches an Ops session (no worktree)', () => {
    expect(yes({ worktreeId: undefined })).toBe(false)
  })

  it('never touches OpenCode or Shell sessions', () => {
    expect(yes({ agent: 'opencode' })).toBe(false)
    expect(yes({ agent: 'shell' })).toBe(false)
  })

  it('never answers a resumed or restarted process', () => {
    expect(yes({ firstStart: false })).toBe(false)
  })

  it('answers at most once per process', () => {
    expect(yes({ answered: true })).toBe(false)
  })
})

describe('appendTrustBuffer', () => {
  it('appends stripped output', () => {
    expect(appendTrustBuffer('hello ', '\x1b[1mworld\x1b[0m')).toBe('hello world')
  })

  it('keeps only the tail', () => {
    const long = 'x'.repeat(TRUST_BUFFER_MAX + 50)
    expect(appendTrustBuffer('', long)).toHaveLength(TRUST_BUFFER_MAX)
    expect(appendTrustBuffer('', long)).toBe('x'.repeat(TRUST_BUFFER_MAX))
  })

  it('recognises a prompt split across two chunks', () => {
    const first = appendTrustBuffer('', 'Do you trust the files in this folder?\r\n  Yes, I trust this folder')
    const second = appendTrustBuffer(first, '\r\n  No, exit\r\n')
    expect(isTrustPrompt(second)).toBe(true)
    expect(isTrustPrompt(first)).toBe(false)
  })
})

describe('TRUST_ANSWER_INPUT', () => {
  it('is the Down + Enter sequence the real TUI expects', () => {
    expect(TRUST_ANSWER_INPUT).toBe('\x1b[B\r')
  })
})
