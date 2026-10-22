import { describe, expect, it } from 'vitest'
import { WORKTREE_NAME_MAX } from '../../../shared/types'
import {
  checkModel,
  pickBaseBranch,
  sessionNamePlaceholder,
  validateSessionName,
  validateWorktreeName,
  worktreePathHint,
  SESSION_NAME_MAX
} from './worktreeDialogLogic'

describe('validateWorktreeName', () => {
  it('rejects an empty name with a reason', () => {
    expect(validateWorktreeName('')).toEqual({ ok: false, error: 'Name required' })
  })

  it('rejects a whitespace-only name', () => {
    expect(validateWorktreeName('   \t ')).toEqual({ ok: false, error: 'Name required' })
  })

  it('accepts a name at exactly WORKTREE_NAME_MAX characters', () => {
    const name = 'a'.repeat(WORKTREE_NAME_MAX)
    expect(validateWorktreeName(name)).toEqual({ ok: true, value: name })
  })

  it('rejects a name one character over the limit', () => {
    const result = validateWorktreeName('a'.repeat(WORKTREE_NAME_MAX + 1))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain(String(WORKTREE_NAME_MAX))
  })

  it('returns the trimmed value', () => {
    expect(validateWorktreeName('  fix login  ')).toEqual({ ok: true, value: 'fix login' })
  })
})

describe('validateSessionName', () => {
  it('treats an empty name as absent so the agent names it', () => {
    expect(validateSessionName('  ')).toEqual({ ok: true, value: undefined })
  })

  it('rejects a name over the session limit', () => {
    const result = validateSessionName('x'.repeat(SESSION_NAME_MAX + 1))
    expect(result.ok).toBe(false)
  })

  it('returns the trimmed name', () => {
    expect(validateSessionName(' review ')).toEqual({ ok: true, value: 'review' })
  })
})

describe('pickBaseBranch', () => {
  it('prefers the repo current branch when it is a local branch', () => {
    expect(pickBaseBranch('develop', ['main', 'develop'])).toBe('develop')
  })

  it('falls back to main when the current branch is detached', () => {
    expect(pickBaseBranch(null, ['feature', 'main', 'master'])).toBe('main')
  })

  it('falls back to master when there is no main', () => {
    expect(pickBaseBranch(null, ['feature', 'master'])).toBe('master')
  })

  it('falls back to the first branch when neither main nor master exists', () => {
    expect(pickBaseBranch(null, ['release', 'feature'])).toBe('release')
  })

  it('ignores a current branch that is not in the list', () => {
    expect(pickBaseBranch('gone', ['main'])).toBe('main')
  })

  it('returns null when the repo has no branches', () => {
    expect(pickBaseBranch(null, [])).toBeNull()
  })
})

describe('worktreePathHint', () => {
  it('joins the worktrees root, repo and name with backslashes', () => {
    expect(worktreePathHint('D:\\wt', 'billing', 'fix-login')).toBe('D:\\wt\\billing\\fix-login')
  })

  it('uses the default root when none is set', () => {
    expect(worktreePathHint('', 'billing', 'fix')).toBe('~/SessionDeck/worktrees\\billing\\fix')
  })

  it('drops a trailing separator from the root', () => {
    expect(worktreePathHint('D:\\wt\\', 'billing', 'fix')).toBe('D:\\wt\\billing\\fix')
  })

  it('shows a placeholder while the name is empty', () => {
    expect(worktreePathHint('', 'billing', '  ')).toBe('~/SessionDeck/worktrees\\billing\\<name>')
  })
})

describe('sessionNamePlaceholder', () => {
  it('names the agent the session will run', () => {
    expect(sessionNamePlaceholder('claude')).toBe('Claude Code')
    expect(sessionNamePlaceholder('opencode')).toBe('OpenCode')
    expect(sessionNamePlaceholder('shell')).toBe('Shell')
  })
})

describe('checkModel', () => {
  it('sends no model for Claude, even when text is typed', () => {
    expect(checkModel('claude', 'bad model!!')).toEqual({ ok: true, model: undefined })
  })

  it('sends no model for Shell', () => {
    expect(checkModel('shell', 'anything')).toEqual({ ok: true, model: undefined })
  })

  it('leaves the model out for OpenCode when it is empty', () => {
    expect(checkModel('opencode', '   ')).toEqual({ ok: true, model: undefined })
  })

  it('passes a valid OpenCode model through trimmed', () => {
    expect(checkModel('opencode', ' opencode/deepseek-v4 ')).toEqual({ ok: true, model: 'opencode/deepseek-v4' })
  })

  it('rejects an OpenCode model with unsupported characters', () => {
    const result = checkModel('opencode', 'bad model!')
    expect(result.ok).toBe(false)
  })
})
