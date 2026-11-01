import { describe, expect, it } from 'vitest'
import type { Session } from '../../shared/types'
import type { AttentionService } from '../attention'
import { buildOpencodeStartOptions, buildStartOptions, YOLO_FLAG } from './startOptions'

const attention = {
  claudeArgs: (): string[] => ['--settings', 'x.json'],
  envFor: (): Record<string, string> => ({ SESSIONDECK_SESSION_ID: 's' }),
  opencodeEnv: (): Record<string, string> => ({ OPENCODE_CONFIG_CONTENT: '{}' }),
  workerEnv: (): Record<string, string> => ({ OPENCODE_CONFIG_CONTENT: '{"plugin":["w"]}' })
} as unknown as AttentionService

const session = (claudeArgs?: string[]): Session =>
  ({ id: 's', cwd: '.', claudeSessionId: 'c', claudeArgs } as unknown as Session)

describe('buildStartOptions yolo mode', () => {
  it('adds --dangerously-skip-permissions to every launch', () => {
    expect(buildStartOptions(session(), false, attention).claudeArgs).toEqual([YOLO_FLAG])
    expect(buildStartOptions(session(['--model', 'opus']), true, attention).claudeArgs).toEqual([YOLO_FLAG, '--model', 'opus'])
  })
  it('does not duplicate or override an explicit permission flag', () => {
    expect(buildStartOptions(session([YOLO_FLAG]), false, attention).claudeArgs).toEqual([YOLO_FLAG])
    expect(buildStartOptions(session(['--permission-mode', 'plan']), false, attention).claudeArgs).toEqual(['--permission-mode', 'plan'])
  })
})

// The everStarted argument is irrelevant on the OpenCode path (the conversation id is stored on the session).
describe('buildStartOptions opencode branch', () => {
  const ocSession = (overrides: Partial<Session>): Session =>
    ({
      id: 'deck1',
      cwd: 'C:\\proj',
      claudeSessionId: 'c',
      claudeArgs: [],
      ...overrides
    }) as unknown as Session

  it('a new session launches opencode --standalone (private server), no Claude flags ever', () => {
    const opts = buildStartOptions(ocSession({ agent: 'opencode' }), true, attention)
    expect(opts).toEqual({
      sessionId: 'deck1',
      cwd: 'C:\\proj',
      claudeArgs: [],
      internalArgs: ['--standalone'],
      command: 'opencode',
      env: { SESSIONDECK_SESSION_ID: 's', OPENCODE_CONFIG_CONTENT: '{}' },
      cols: 120,
      rows: 30
    })
  })

  it('a known conversation id resumes with --standalone -s (never --resume and never --continue)', () => {
    const opts = buildOpencodeStartOptions(ocSession({ agent: 'opencode', opencodeSessionId: 'ses_abcdef12345678' }), attention)
    expect(opts.internalArgs).toEqual(['--standalone', '-s', 'ses_abcdef12345678'])
    expect(JSON.stringify(opts.internalArgs)).not.toContain('--resume')
    expect(JSON.stringify(opts.internalArgs)).not.toContain('--continue')
  })

  it('an unknown conversation id starts a fresh opencode (--continue would pick a random conversation)', () => {
    const opts = buildOpencodeStartOptions(ocSession({ agent: 'opencode', opencodeSessionId: undefined }), attention)
    expect(opts.internalArgs).toEqual(['--standalone'])
  })

  it('the session model travels in the config content (the TUI CLI has no --model flag)', () => {
    expect(buildOpencodeStartOptions(ocSession({ agent: 'opencode', model: 'opencode/deepseek-v4.1-flash-free' }), attention).internalArgs).toEqual(['--standalone'])
    const withModel = buildOpencodeStartOptions(ocSession({ agent: 'opencode', opencodeSessionId: 'ses_abcdef12345678', model: 'p/m' }), attention)
    expect(withModel.internalArgs).toEqual(['--standalone', '-s', 'ses_abcdef12345678'])
    expect(JSON.parse(withModel.env.OPENCODE_CONFIG_CONTENT)).toEqual({ model: 'p/m' })
    expect(buildOpencodeStartOptions(ocSession({ agent: 'opencode', model: '' }), attention).env.OPENCODE_CONFIG_CONTENT).toBe('{}')
  })

  it('merges extra config keys for Jarvis on OpenCode (D54), next to the model', () => {
    const opts = buildOpencodeStartOptions(ocSession({ agent: 'opencode', model: 'p/m' }), attention, { mcp: { sessiondeck: { type: 'remote' } }, instructions: ['C:/j/p.md'] })
    expect(JSON.parse(opts.env.OPENCODE_CONFIG_CONTENT)).toEqual({ model: 'p/m', mcp: { sessiondeck: { type: 'remote' } }, instructions: ['C:/j/p.md'] })
  })

  it('user claudeArgs are validated but NEVER forwarded to opencode (they are Claude flags)', () => {
    const opts = buildOpencodeStartOptions(ocSession({ agent: 'opencode', claudeArgs: ['--continue'] }), attention)
    expect(opts.claudeArgs).toEqual([])
    expect(opts.internalArgs).toEqual(['--standalone'])
    expect(buildStartOptions(ocSession({ agent: 'opencode', claudeArgs: ['--continue'] }), false, attention).claudeArgs).toEqual([])
  })

  it('a claude session still produces the byte-for-byte claude launch', () => {
    const opts = buildStartOptions(ocSession({ claudeSessionId: '556f1ce0-0000-0000-0000-000000000000' }), false, attention)
    expect(opts.claudeArgs).toEqual(['--dangerously-skip-permissions'])
    expect(opts.internalArgs).toEqual(['--settings', 'x.json', '--session-id', '556f1ce0-0000-0000-0000-000000000000'])
    expect(opts.env).toEqual({ SESSIONDECK_SESSION_ID: 's', OPENCODE_CONFIG_CONTENT: '{"plugin":["w"]}' })
    expect(opts.command).toBeUndefined()
  })

  it('absent agent (old sessions) stays claude', () => {
    const opts = buildStartOptions(ocSession({}), true, attention)
    expect(opts.internalArgs).toEqual(['--settings', 'x.json', '--resume', 'c'])
    expect(opts.internalArgs).not.toContain('./resume.c')
  })
})

