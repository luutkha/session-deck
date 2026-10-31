import { describe, expect, it } from 'vitest'
import { WORKTREE_NAME_MAX } from '../../shared/types'
import { branchNameFor, folderNameFor, repoFolderName, validateWorktreeName } from './branchName'

describe('branchNameFor', () => {
  it.each([
    ['Fix Login!', 'fix-login'],
    ['feat/New  API', 'feat/new-api'],
    ['..hidden', 'hidden'],
    ['Ünïcode', 'n-code'],
    ['name.lock', 'name'],
    ['a/../b', 'a/b'],
    ['x//y', 'x/y'],
    ['feat/-x', 'feat/x'],
    ['.dot/.seg', 'dot/seg'],
    ['--lead--trail--', 'lead-trail'],
    ['v1.2_beta', 'v1.2_beta']
  ])('turns %j into %j', (input, expected) => {
    expect(branchNameFor(input)).toBe(expected)
  })

  it('cuts long names to 60 characters and strips a dangling separator', () => {
    const name = `${'a'.repeat(59)} b`
    const branch = branchNameFor(name)
    expect(branch).toBe('a'.repeat(59))
    expect(branch.length).toBeLessThanOrEqual(60)
  })

  it.each([
    ['con', 'con-wt'],
    ['Nul', 'nul-wt'],
    ['feat/aux', 'feat/aux-wt'],
    ['com1/x', 'com1-wt/x'],
    ['aux.v1', 'aux-wt.v1'],
    ['console', 'console']
  ])('makes the Windows reserved segment in %j safe: %j', (input, expected) => {
    expect(branchNameFor(input)).toBe(expected)
  })

  it('keeps a 60-character name unchanged', () => {
    expect(branchNameFor('b'.repeat(60))).toBe('b'.repeat(60))
  })

  it.each(['', '---', '...', '/ /', '!!!'])('throws when %j has no letter or digit', (input) => {
    expect(() => branchNameFor(input)).toThrow('Name must contain a letter or digit')
  })
})

describe('folderNameFor', () => {
  it('replaces slashes with dashes', () => {
    expect(folderNameFor('feat/new-api')).toBe('feat-new-api')
  })

  it('leaves a branch without slashes unchanged', () => {
    expect(folderNameFor('fix-login')).toBe('fix-login')
  })

  it.each([
    ['con', 'con-wt'],
    ['nul', 'nul-wt'],
    ['aux.v1', 'aux-wt.v1'],
    ['com1', 'com1-wt'],
    ['lpt9.x.y', 'lpt9-wt.x.y'],
    ['PRN', 'PRN-wt']
  ])('makes the Windows reserved name %j safe as %j', (branch, expected) => {
    expect(folderNameFor(branch)).toBe(expected)
  })

  it.each(['console', 'connect', 'nullable', 'com10', 'aux-tools', 'lpt'])('keeps the ordinary name %j', (branch) => {
    expect(folderNameFor(branch)).toBe(branch)
  })

  it('checks the folder after slashes became dashes', () => {
    expect(folderNameFor('con/x')).toBe('con-x')
    expect(folderNameFor('x/con')).toBe('x-con')
  })
})

describe('repoFolderName', () => {
  it('sanitises spaces and slashes into dashes', () => {
    expect(repoFolderName('My Repo')).toBe('my-repo')
    expect(repoFolderName('org/repo')).toBe('org-repo')
  })

  it('makes a Windows reserved repository name safe', () => {
    expect(repoFolderName('AUX')).toBe('aux-wt')
    expect(repoFolderName('nul.js')).toBe('nul-wt.js')
  })

  it('falls back to "repo" when nothing usable is left', () => {
    expect(repoFolderName('')).toBe('repo')
    expect(repoFolderName('!!!')).toBe('repo')
  })
})

describe('validateWorktreeName', () => {
  it('trims surrounding whitespace', () => {
    expect(validateWorktreeName('  Fix Login  ')).toBe('Fix Login')
  })

  it('accepts a name of exactly WORKTREE_NAME_MAX characters', () => {
    const name = 'n'.repeat(WORKTREE_NAME_MAX)
    expect(validateWorktreeName(name)).toBe(name)
  })

  it.each(['', '   ', 'n'.repeat(WORKTREE_NAME_MAX + 1), '\n', 'a\nb', 'tab\there'])(
    'rejects %j',
    (input) => {
      expect(() => validateWorktreeName(input)).toThrow(
        `Worktree name must be 1 to ${WORKTREE_NAME_MAX} characters`
      )
    }
  )

  it('rejects values that are not strings', () => {
    expect(() => validateWorktreeName(42)).toThrow(`Worktree name must be 1 to ${WORKTREE_NAME_MAX} characters`)
    expect(() => validateWorktreeName(undefined)).toThrow(
      `Worktree name must be 1 to ${WORKTREE_NAME_MAX} characters`
    )
  })
})
