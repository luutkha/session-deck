import { afterEach, describe, expect, it } from 'vitest'
import type { Session } from '../../shared/types'
import type { AttentionService } from '../attention'
import { CURSOR_INSTALL_HINT, resetCursorCommandCache, setCursorCommandRunnerForTests } from '../cursor/command'
import { buildCursorStartOptions, buildStartOptions } from './startOptions'

// The detection seam replaces the PATH probe: these tests never spawn `where`/`command -v`.
const DETECTED_ENV = {
  SESSIONDECK_SESSION_ID: 'deck1',
  SESSIONDECK_PORT: '4321',
  SESSIONDECK_TOKEN: 'token'
}
const attention = { envFor: (): Record<string, string> => DETECTED_ENV } as unknown as AttentionService

const cursorSession = (overrides: Partial<Session> = {}): Session =>
  ({ id: 'deck1', cwd: 'C:\\proj', agent: 'cursor', claudeArgs: [], ...overrides }) as unknown as Session

function installed(names: Array<'cursor-agent' | 'agent'>): void {
  setCursorCommandRunnerForTests((command) => names.includes(command))
}

afterEach(() => {
  setCursorCommandRunnerForTests(null)
  resetCursorCommandCache()
})

describe('buildCursorStartOptions', () => {
  it('a new session starts cursor-agent --yolo --trust with the SESSIONDECK_* env', () => {
    installed(['cursor-agent'])
    const opts = buildCursorStartOptions(cursorSession(), attention)

    expect(opts).toEqual({
      sessionId: 'deck1',
      cwd: 'C:\\proj',
      claudeArgs: [],
      internalArgs: ['--yolo', '--trust'],
      command: 'cursor-agent',
      env: DETECTED_ENV,
      cols: 120,
      rows: 30
    })
    expect(opts.env.SESSIONDECK_SESSION_ID).toBe('deck1')
    expect(opts.env.SESSIONDECK_PORT).toBe('4321')
    expect(opts.env.SESSIONDECK_TOKEN).toBe('token')
  })

  it('falls back to the agent binary', () => {
    installed(['agent'])
    expect(buildCursorStartOptions(cursorSession(), attention).command).toBe('agent')
  })

  it('passes a plain model name with --model', () => {
    installed(['cursor-agent'])
    expect(buildCursorStartOptions(cursorSession({ model: 'gpt-5' }), attention).internalArgs).toEqual([
      '--yolo',
      '--trust',
      '--model',
      'gpt-5'
    ])
  })

  it('resumes a known chat with --resume <chatId>', () => {
    installed(['cursor-agent'])
    expect(buildCursorStartOptions(cursorSession({ cursorChatId: 'abcdefgh-1234' }), attention).internalArgs).toEqual([
      '--yolo',
      '--trust',
      '--resume',
      'abcdefgh-1234'
    ])
  })

  it('model and chat id together keep the contract order: --yolo, --trust, --model, --resume', () => {
    installed(['cursor-agent'])
    expect(
      buildCursorStartOptions(cursorSession({ model: 'sonnet-4-thinking', cursorChatId: 'abcdefgh-1234' }), attention)
        .internalArgs
    ).toEqual(['--yolo', '--trust', '--model', 'sonnet-4-thinking', '--resume', 'abcdefgh-1234'])
  })

  it('an empty model or chat id is ignored', () => {
    installed(['cursor-agent'])
    expect(buildCursorStartOptions(cursorSession({ model: '', cursorChatId: '' }), attention).internalArgs).toEqual([
      '--yolo',
      '--trust'
    ])
  })

  it('throws with the install hint when neither binary is installed', () => {
    installed([])
    expect(() => buildCursorStartOptions(cursorSession(), attention)).toThrow(
      `Cursor CLI not found. ${CURSOR_INSTALL_HINT}`
    )
  })
})

describe('buildStartOptions cursor routing', () => {
  it('routes a cursor session before the Claude branch (no claudeSessionId needed)', () => {
    installed(['cursor-agent'])
    const opts = buildStartOptions(cursorSession({ claudeSessionId: undefined }), false, attention)

    expect(opts.command).toBe('cursor-agent')
    expect(opts.internalArgs).toEqual(['--yolo', '--trust'])
    expect(opts.internalArgs).not.toContain('--session-id')
  })

  it('never adds Claude flags or the Claude settings file to cursor', () => {
    installed(['cursor-agent'])
    const opts = buildStartOptions(cursorSession({ model: 'gpt-5' }), true, attention)

    expect(opts.claudeArgs).toEqual([])
    expect(JSON.stringify(opts.internalArgs)).not.toContain('--settings')
    expect(JSON.stringify(opts.internalArgs)).not.toContain('--dangerously-skip-permissions')
    expect(opts.env).toEqual(DETECTED_ENV)
  })
})
