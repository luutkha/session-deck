import { describe, expect, it } from 'vitest'
import { isCursorChatId, isCursorModel } from './cursorValues'

describe('isCursorChatId', () => {
  it('accepts 8 to 80 letters, digits, _ and -', () => {
    expect(isCursorChatId('abcdefgh')).toBe(true)
    expect(isCursorChatId('chat_ABCDEF-12')).toBe(true)
    expect(isCursorChatId('a'.repeat(80))).toBe(true)
  })

  it('rejects anything shorter, longer or outside the shape', () => {
    expect(isCursorChatId('abcdefg')).toBe(false)
    expect(isCursorChatId('a'.repeat(81))).toBe(false)
    expect(isCursorChatId('bad id')).toBe(false)
    expect(isCursorChatId('chat/../id')).toBe(false)
    expect(isCursorChatId('')).toBe(false)
    expect(isCursorChatId('--api-key')).toBe(false)
    expect(isCursorChatId('-abcdefgh')).toBe(false)
    expect(isCursorChatId(42)).toBe(false)
    expect(isCursorChatId(null)).toBe(false)
    expect(isCursorChatId(undefined)).toBe(false)
  })
})

describe('isCursorModel', () => {
  it('accepts plain model names (letters, digits and . _ : / @ -)', () => {
    expect(isCursorModel('gpt-5')).toBe(true)
    expect(isCursorModel('sonnet-4-thinking')).toBe(true)
    expect(isCursorModel('vendor/model@1.2_3:x-y')).toBe(true)
    expect(isCursorModel('a'.repeat(100))).toBe(true)
  })

  it('rejects an empty name, one over 100 chars and shell-special characters', () => {
    expect(isCursorModel('')).toBe(false)
    expect(isCursorModel('--evil')).toBe(false)
    expect(isCursorModel('-m')).toBe(false)
    expect(isCursorModel('a'.repeat(101))).toBe(false)
    expect(isCursorModel('model name')).toBe(false)
    expect(isCursorModel('model&calc')).toBe(false)
    expect(isCursorModel('$(whoami)')).toBe(false)
    expect(isCursorModel(5)).toBe(false)
  })
})
