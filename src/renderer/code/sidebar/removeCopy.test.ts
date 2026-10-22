import { describe, expect, it } from 'vitest'
import { repoRemoveMessage, sessionCountPhrase, sessionRemoveCopy, worktreeRemoveMessage } from './removeCopy'

describe('sessionCountPhrase', () => {
  it('uses the singular for one session', () => {
    expect(sessionCountPhrase(1)).toBe('1 session')
  })

  it('uses the plural for zero and many', () => {
    expect(sessionCountPhrase(0)).toBe('0 sessions')
    expect(sessionCountPhrase(3)).toBe('3 sessions')
  })
})

describe('repoRemoveMessage', () => {
  it('names the stopped sessions and says folders and branches stay', () => {
    expect(repoRemoveMessage('billing', 2)).toBe(
      'Stops its 2 sessions and removes billing and its worktrees from SessionDeck. Folders and branches stay on disk.'
    )
  })

  it('leaves out the stop clause when the repo has no sessions', () => {
    expect(repoRemoveMessage('billing', 0)).toBe(
      'removes billing and its worktrees from SessionDeck. Folders and branches stay on disk.'
    )
  })
})

describe('worktreeRemoveMessage', () => {
  it('names the stopped sessions and the folder that stays on disk', () => {
    expect(worktreeRemoveMessage('Refunds', 1, 'C:\\wt\\refunds')).toBe(
      'Stops its 1 session and removes Refunds from SessionDeck. The folder and branch stay on disk: C:\\wt\\refunds'
    )
  })

  it('leaves out the stop clause when the worktree has no sessions', () => {
    expect(worktreeRemoveMessage('Refunds', 0, 'C:\\wt\\refunds')).toBe(
      'removes Refunds from SessionDeck. The folder and branch stay on disk: C:\\wt\\refunds'
    )
  })
})

describe('sessionRemoveCopy', () => {
  it('asks to remove an open session', () => {
    expect(sessionRemoveCopy('Auth', false)).toEqual({
      title: 'Remove session',
      message: 'Remove session "Auth"?',
      confirmLabel: 'Remove'
    })
  })

  it('warns that a closed session is deleted for good', () => {
    const copy = sessionRemoveCopy('Auth', true)
    expect(copy.title).toBe('Delete session')
    expect(copy.message).toContain('cannot be undone')
    expect(copy.confirmLabel).toBe('Delete')
  })
})
