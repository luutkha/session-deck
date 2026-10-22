import { describe, expect, it } from 'vitest'
import type { Session } from '../../shared/types'
import type { AttentionService } from '../attention'
import { buildStartOptions } from './startOptions'

const attention = {
  claudeArgs: (): string[] => ['--settings', 'x.json'],
  envFor: (): Record<string, string> => ({ SESSIONDECK_SESSION_ID: 's' }),
  opencodeEnv: (): Record<string, string> => ({ OPENCODE_CONFIG_CONTENT: '{}' }),
  workerEnv: (): Record<string, string> => ({ OPENCODE_CONFIG_CONTENT: '{"plugin":["w"]}' })
} as unknown as AttentionService

const shellSession = (overrides: Partial<Session> = {}): Session =>
  ({
    id: 'sh1',
    name: 'Shell',
    cwd: 'C:\\wt\\feature',
    groupId: null,
    statusId: null,
    order: 0,
    createdAt: 1,
    claudeArgs: ['--model', 'opus'],
    agent: 'shell',
    worktreeId: 'w1',
    ...overrides
  }) as unknown as Session

describe('buildStartOptions for a shell session', () => {
  it('starts powershell with -NoLogo in the worktree folder', () => {
    const opts = buildStartOptions(shellSession(), true, attention)
    expect(opts).toEqual({
      sessionId: 'sh1',
      cwd: 'C:\\wt\\feature',
      claudeArgs: [],
      internalArgs: ['-NoLogo'],
      command: 'powershell',
      env: { OPENCODE_CONFIG_CONTENT: '{"plugin":["w"]}' },
      cols: 120,
      rows: 30
    })
  })

  it('uses the shell from settings: pwsh gets -NoLogo, cmd gets no arguments', () => {
    expect(buildStartOptions(shellSession(), false, attention, 'pwsh')).toMatchObject({ command: 'pwsh', internalArgs: ['-NoLogo'] })
    expect(buildStartOptions(shellSession(), false, attention, 'cmd')).toMatchObject({ command: 'cmd', internalArgs: [] })
  })

  it('has no hook env, no Claude flags and no conversation arguments', () => {
    const opts = buildStartOptions(shellSession(), false, attention, 'powershell')
    expect(opts.env).not.toHaveProperty('SESSIONDECK_SESSION_ID')
    expect(opts.claudeArgs).toEqual([])
    expect(JSON.stringify(opts.internalArgs)).not.toContain('--resume')
    expect(JSON.stringify(opts.internalArgs)).not.toContain('--session-id')
  })

  it('a restart after an exit is the same fresh shell (everStarted changes nothing)', () => {
    expect(buildStartOptions(shellSession(), true, attention, 'cmd')).toEqual(
      buildStartOptions(shellSession(), false, attention, 'cmd')
    )
  })
})
