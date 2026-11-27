import { afterEach, describe, expect, it } from 'vitest'
import type { Session } from '../../shared/types'
import type { AttentionService } from '../attention'
import { setCommandProbeForTests, asCliCommand } from './cliCommand'
import { buildStartOptions } from './startOptions'

// D92: a shell session with cliAgent runs the agent CLI of the registry instead of a shell program.
const attention = { workerEnv: (): Record<string, string> => ({ WORKER: '1' }) } as unknown as AttentionService
const session = (cliAgent: string | undefined): Session =>
  ({ id: 's1', cwd: 'C:\proj', agent: 'shell', claudeArgs: [], ...(cliAgent !== undefined ? { cliAgent } : {}) }) as unknown as Session

afterEach(() => setCommandProbeForTests(null))

describe('extra agent CLI sessions', () => {
  it('start the registry command with its fixed and yolo arguments', () => {
    setCommandProbeForTests(() => true)
    const opts = buildStartOptions(session('codex'), false, attention)
    expect(opts.command).toBe('codex')
    expect(opts.internalArgs).toEqual(['--dangerously-bypass-approvals-and-sandbox'])
    expect(opts.claudeArgs).toEqual([])
  })
  it('carry the agent yolo env (goose)', () => {
    setCommandProbeForTests(() => true)
    expect(buildStartOptions(session('goose'), false, attention).env).toMatchObject({ GOOSE_MODE: 'auto', WORKER: '1' })
  })
  it('fail with the install hint when the CLI is not on PATH', () => {
    setCommandProbeForTests(() => false)
    expect(() => buildStartOptions(session('codex'), false, attention)).toThrow(/Codex CLI not found \("codex"\)/)
  })
  it('a plain shell session (no cliAgent, or an id the registry dropped) still starts a shell', () => {
    setCommandProbeForTests(() => false)
    expect(buildStartOptions(session(undefined), false, attention, 'pwsh').command).toBe('pwsh')
    expect(buildStartOptions(session('gone-agent'), false, attention, 'pwsh').command).toBe('pwsh')
  })
  it('asCliCommand refuses anything but a plain program name', () => {
    expect(asCliCommand('kiro-cli')).toBe('kiro-cli')
    expect(() => asCliCommand('codex & calc')).toThrow('Unsafe agent command')
    expect(() => asCliCommand('')).toThrow()
  })
})
