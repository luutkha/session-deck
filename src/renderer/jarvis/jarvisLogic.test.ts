import { describe, expect, it } from 'vitest'
import type { RuntimeState, Session, StoreData } from '../../shared/types'
import { clampJarvisWidth, findJarvis, isJarvisShortcut, JARVIS_WIDTH_DEFAULT, JARVIS_WIDTH_MIN, jarvisRowState, parseJarvisWidth, SPEAK_MAX_CHARS, speakableText } from './jarvisLogic'

const session = (id: string, extra: Partial<Session> = {}): Session => ({
  id, name: id, cwd: 'C:/p', groupId: null, statusId: null, order: 0, createdAt: 0, claudeArgs: [], ...extra
})
const data = { sessions: [session('a'), session('j', { role: 'jarvis' })], groups: [], statuses: [] } as unknown as StoreData
const key = (k: string, extra: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) =>
  ({ key: k, ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, ...extra })

describe('jarvisLogic', () => {
  it('finds Jarvis', () => {
    expect(findJarvis(data)?.id).toBe('j')
    expect(findJarvis({ ...data, sessions: [session('a')] })).toBeNull()
    expect(findJarvis(null)).toBeNull()
  })

  it('keeps the panel width between the minimum and 75% of the window', () => {
    expect(clampJarvisWidth(600, 1600)).toBe(600)
    expect(clampJarvisWidth(100, 1600)).toBe(JARVIS_WIDTH_MIN)
    expect(clampJarvisWidth(1500, 1600)).toBe(1200)
    expect(clampJarvisWidth(Number.NaN, 1600)).toBe(JARVIS_WIDTH_DEFAULT)
    expect(clampJarvisWidth(500, 300)).toBe(JARVIS_WIDTH_MIN)
    expect(parseJarvisWidth('640')).toBe(640)
    expect(parseJarvisWidth(null)).toBe(JARVIS_WIDTH_DEFAULT)
    expect(parseJarvisWidth('wide')).toBe(JARVIS_WIDTH_DEFAULT)
    expect(parseJarvisWidth('10')).toBe(JARVIS_WIDTH_DEFAULT)
  })

  it('turns a markdown reply into plain speech (D54)', () => {
    expect(speakableText('## Done' + String.fromCharCode(10) + '- **API** is asleep' + String.fromCharCode(10) + 'Run `npm test` or see [docs](http://x).')).toBe('Done API is asleep Run npm test or see docs.')
    expect(speakableText('Here: ' + '```ts' + String.fromCharCode(10) + 'const a = 1' + String.fromCharCode(10) + '```' + ' ok')).toBe('Here: (code) ok')
    const long = 'This is a sentence. '.repeat(100)
    const spoken = speakableText(long)
    expect(spoken.length).toBeLessThanOrEqual(SPEAK_MAX_CHARS)
    expect(spoken.endsWith('.')).toBe(true)
  })
  it('opens on Ctrl+Shift+J only, never over a dialog', () => {
    expect(isJarvisShortcut(key('J'), false)).toBe(true)
    expect(isJarvisShortcut(key('j'), false)).toBe(true)
    expect(isJarvisShortcut(key('J'), true)).toBe(false)
    expect(isJarvisShortcut(key('j', { shiftKey: false }), false)).toBe(false) // plain Ctrl+J is a newline in Claude
    expect(isJarvisShortcut(key('J', { altKey: true }), false)).toBe(false)
  })

  it('describes the row state', () => {
    const run = (extra: Partial<RuntimeState>): RuntimeState => ({ sessionId: 'j', run: 'running', exitCode: null, attention: null, ...extra })
    const jarvis = session('j', { role: 'jarvis' })
    expect(jarvisRowState(null, undefined)).toBe('Not started')
    expect(jarvisRowState({ ...jarvis, closedAt: 1 }, undefined)).toBe('Closed')
    expect(jarvisRowState(jarvis, run({ sleeping: true }))).toBe('Sleeping')
    expect(jarvisRowState(jarvis, run({ run: 'exited' }))).toBe('Stopped')
    expect(jarvisRowState(jarvis, run({ activity: 'working' }))).toBe('Working…')
    expect(jarvisRowState(jarvis, run({ activity: 'needs-input' }))).toBe('Needs you')
    expect(jarvisRowState(jarvis, run({ activity: 'finished' }))).toBe('Ready')
  })
})
