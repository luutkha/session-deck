import { describe, expect, it } from 'vitest'
import type { TranscriptMessage } from './conversationSearch'
import {
  READ_DEFAULT_CHARS,
  READ_DEFAULT_MESSAGES,
  READ_MAX_CHARS,
  READ_MAX_MESSAGES,
  readConversation
} from './conversationRead'

const at = Date.parse('2026-10-30T10:00:00.000Z')
const message = (text: string, role: 'user' | 'assistant' = 'user', time: number | null = null): TranscriptMessage =>
  ({ role, text, at: time })

/** A conversation of `count` alternating messages whose text is `m1`, `m2`, ... */
const conversation = (count: number): TranscriptMessage[] =>
  Array.from({ length: count }, (_, i) => message(`m${i + 1}`, i % 2 === 0 ? 'user' : 'assistant'))

describe('readConversation', () => {
  it('shows the newest READ_DEFAULT_MESSAGES by default, oldest first, numbered in the whole conversation', () => {
    const result = readConversation(conversation(12))
    expect(result).toMatchObject({ shown: READ_DEFAULT_MESSAGES, total: 12, olderLeft: 2 })
    expect(result.text.startsWith('[3/12] USER (time unknown):\nm3\n\n')).toBe(true)
    expect(result.text.endsWith('[12/12] ASSISTANT (time unknown):\nm12')).toBe(true)
  })

  it('pages back in time with last and skip, keeping chronological order', () => {
    const result = readConversation(conversation(5), { last: 2, skip: 1 })
    expect(result).toEqual({
      text: '[3/5] USER (time unknown):\nm3\n\n[4/5] ASSISTANT (time unknown):\nm4',
      shown: 2,
      total: 5,
      olderLeft: 2
    })
  })

  it('clamps last to 1..READ_MAX_MESSAGES and skip to 0 or more', () => {
    expect(readConversation(conversation(3), { last: 0 })).toMatchObject({ shown: 1, olderLeft: 2 })
    expect(readConversation(conversation(3), { last: 0 }).text.startsWith('[3/3]')).toBe(true)
    const capped = readConversation(conversation(60), { last: 999 })
    expect(capped).toMatchObject({ shown: READ_MAX_MESSAGES, total: 60, olderLeft: 10 })
    expect(capped.text.startsWith('[11/60]')).toBe(true)
    expect(readConversation(conversation(3), { skip: -5 })).toEqual(readConversation(conversation(3)))
  })

  it('drops the oldest messages of the window first when the budget is exceeded', () => {
    const messages = [message('a'.repeat(60)), message('b'.repeat(60)), message('c'.repeat(60))]
    const two = readConversation(messages, { maxChars: 200 })
    expect(two).toMatchObject({ shown: 2, olderLeft: 1 })
    expect(two.text.startsWith('[2/3]')).toBe(true)
    expect(two.text).not.toContain('a'.repeat(60))

    const one = readConversation([message('a'.repeat(120)), message('b'.repeat(120)), message('c'.repeat(120))], { maxChars: 200 })
    expect(one).toMatchObject({ shown: 1, olderLeft: 2 })
    expect(one.text.startsWith('[3/3]')).toBe(true)
  })

  it('keeps the end of one message longer than the budget, marked as cut', () => {
    const result = readConversation([message(`${'x'.repeat(500)}THE END`)], { maxChars: 200 })
    expect(result).toMatchObject({ shown: 1, total: 1, olderLeft: 0 })
    expect(result.text.startsWith('…(start cut)\n')).toBe(true)
    expect(result.text.endsWith('THE END')).toBe(true)
    expect(result.text.length).toBe(200)
  })

  it('clamps maxChars to 200..READ_MAX_CHARS', () => {
    expect(readConversation([message('y'.repeat(1000))], { maxChars: 1 }).text.length).toBe(200)
    expect(readConversation([message('z')], { maxChars: 1_000_000 }).text.length).toBeLessThan(READ_MAX_CHARS)
    expect(readConversation(conversation(2)).text.length).toBeLessThan(READ_DEFAULT_CHARS)
  })

  it('returns nothing for an empty conversation', () => {
    expect(readConversation([])).toEqual({ text: '', shown: 0, total: 0, olderLeft: 0 })
  })

  it('writes the ISO time of a message, and time unknown when it has none', () => {
    const result = readConversation([message('with time', 'assistant', at), message('no time')], { last: 2 })
    expect(result.text).toContain('[1/2] ASSISTANT (2026-10-30T10:00:00.000Z):\nwith time')
    expect(result.text).toContain('[2/2] USER (time unknown):\nno time')
  })
})
