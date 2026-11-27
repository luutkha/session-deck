import { describe, expect, it } from 'vitest'
import { createSession } from '../store/reducers'
import { asCreateSessionInput, asCreateWorktreeInput } from './ipcValidation'

// D92: the extra-agent id is validated on the way in and stored with the session.
describe('cliAgent through validation and the store', () => {
  it('createSession input keeps a known id on a shell session and refuses an unknown one', () => {
    expect(asCreateSessionInput({ cwd: 'C:\p', agent: 'shell', cliAgent: 'aider' })).toMatchObject({ agent: 'shell', cliAgent: 'aider' })
    expect(() => asCreateSessionInput({ cwd: 'C:\p', agent: 'shell', cliAgent: 'nope' })).toThrow('unknown cliAgent')
    expect(asCreateSessionInput({ cwd: 'C:\p', agent: 'claude' })).not.toHaveProperty('cliAgent')
  })
  it('createWorktree input does the same', () => {
    const base = { repoId: 'r1', name: 'x', baseBranch: 'main', agent: 'shell' }
    expect(asCreateWorktreeInput({ ...base, cliAgent: 'codex' })).toMatchObject({ cliAgent: 'codex' })
    expect(() => asCreateWorktreeInput({ ...base, cliAgent: 'zzz' })).toThrow('unknown cliAgent')
  })
  it('the store names the session after the agent and keeps the id', () => {
    const data = { groups: [], statuses: [], sessions: [] } as never
    const result = createSession(data, { cwd: 'C:\p', agent: 'shell', cliAgent: 'codex' }, { id: 'a', now: 1 } as never)
    expect(result.session).toMatchObject({ agent: 'shell', cliAgent: 'codex', name: 'Codex' })
  })
})
