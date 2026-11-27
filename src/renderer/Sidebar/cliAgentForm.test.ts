import { describe, expect, it } from 'vitest'
import { worktreeSessionInput } from '../code/dialogs/worktreeDialogLogic'
import { buildCreateInput } from './dialogLogic'

// D92: the dialogs turn a picked extra agent into a shell session input carrying the registry id.
describe('extra agent CLI in the dialogs', () => {
  it('the New Session form builds a shell input with the id', () => {
    const built = buildCreateInput({ folder: 'C:\p', name: '', groupId: null, statusId: null, argsRaw: '', agent: 'shell', cliAgent: 'kimi' })
    expect(built).toMatchObject({ ok: true, input: { agent: 'shell', cliAgent: 'kimi' } })
  })
  it('the worktree session input uses a shell agent with the id', () => {
    expect(worktreeSessionInput({ id: 'w', path: 'C:\w' }, 'claude', undefined, 'droid')).toMatchObject({ agent: 'shell', cliAgent: 'droid' })
  })
})
