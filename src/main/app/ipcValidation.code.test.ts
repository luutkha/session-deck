import { describe, expect, it } from 'vitest'
import { WORKTREE_NAME_MAX } from '../../shared/types'
import { asCreateSessionInput, asCreateWorktreeInput } from './ipcValidation'

const base = { repoId: 'r1', name: 'feature', baseBranch: 'main', agent: 'claude' }

describe('asCreateWorktreeInput', () => {
  it('accepts a plain input and returns the trimmed name', () => {
    expect(asCreateWorktreeInput({ ...base, name: '  feature  ' })).toEqual({
      repoId: 'r1',
      name: 'feature',
      baseBranch: 'main',
      agent: 'claude'
    })
  })

  it('accepts the D57 sources and drops "branch" unless the source is existing', () => {
    expect(asCreateWorktreeInput({ ...base, source: 'existing', branch: 'feat/x' })).toMatchObject({ source: 'existing', branch: 'feat/x' })
    expect(asCreateWorktreeInput({ ...base, source: 'main' })).toMatchObject({ source: 'main' })
    expect(asCreateWorktreeInput({ ...base, source: 'new' })).not.toHaveProperty('source')
    expect(asCreateWorktreeInput({ ...base, source: 'main', branch: 'x' })).not.toHaveProperty('branch')
    expect(() => asCreateWorktreeInput({ ...base, source: 'bogus' })).toThrow('source must be')
    expect(() => asCreateWorktreeInput({ ...base, source: 'existing' })).toThrow('Invalid base branch')
    expect(() => asCreateWorktreeInput({ ...base, source: 'existing', branch: '--force' })).toThrow('Invalid base branch')
  })

  it('accepts branch names with slashes, dots and dashes', () => {
    expect(asCreateWorktreeInput({ ...base, baseBranch: 'release/2.0-rc' }).baseBranch).toBe('release/2.0-rc')
  })

  it('rejects a base branch that starts with a dash (option injection) such as --force', () => {
    expect(() => asCreateWorktreeInput({ ...base, baseBranch: '--force' })).toThrow('Invalid base branch')
    expect(() => asCreateWorktreeInput({ ...base, baseBranch: '-b' })).toThrow('Invalid base branch')
  })

  it('rejects a base branch with ".." in it', () => {
    expect(() => asCreateWorktreeInput({ ...base, baseBranch: 'a..b' })).toThrow('Invalid base branch')
  })

  it('rejects whitespace, control characters and the other forbidden marks', () => {
    for (const bad of ['a b', 'a\tb', 'a\nb', 'a\u0007b', '~main', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b']) {
      expect(() => asCreateWorktreeInput({ ...base, baseBranch: bad }), bad).toThrow('Invalid base branch')
    }
  })

  it('rejects an empty base branch and one longer than 255 characters', () => {
    expect(() => asCreateWorktreeInput({ ...base, baseBranch: '' })).toThrow('Invalid base branch')
    expect(() => asCreateWorktreeInput({ ...base, baseBranch: 'a'.repeat(256) })).toThrow('Invalid base branch')
    expect(asCreateWorktreeInput({ ...base, baseBranch: 'a'.repeat(255) }).baseBranch).toHaveLength(255)
  })

  it('rejects a name that is blank or longer than WORKTREE_NAME_MAX after trim', () => {
    expect(() => asCreateWorktreeInput({ ...base, name: '   ' })).toThrow('name must be 1 to')
    expect(() => asCreateWorktreeInput({ ...base, name: 'x'.repeat(WORKTREE_NAME_MAX + 1) })).toThrow('name must be')
    expect(asCreateWorktreeInput({ ...base, name: 'x'.repeat(WORKTREE_NAME_MAX) }).name).toHaveLength(WORKTREE_NAME_MAX)
  })

  it('rejects an unknown key', () => {
    expect(() => asCreateWorktreeInput({ ...base, path: 'C:\\x' })).toThrow('unknown key "path"')
  })

  it('rejects a repoId that is not a non-empty string', () => {
    expect(() => asCreateWorktreeInput({ ...base, repoId: '' })).toThrow('repoId')
    expect(() => asCreateWorktreeInput({ ...base, repoId: 4 })).toThrow('repoId')
  })

  it('accepts shell as the agent and rejects anything outside AgentKind', () => {
    expect(asCreateWorktreeInput({ ...base, agent: 'shell' }).agent).toBe('shell')
    expect(() => asCreateWorktreeInput({ ...base, agent: 'bash' })).toThrow('agent must be')
  })

  it('keeps the model only for opencode and rejects a bad opencode model', () => {
    expect(asCreateWorktreeInput({ ...base, agent: 'opencode', model: 'opencode/big-pickle' }).model).toBe(
      'opencode/big-pickle'
    )
    expect(asCreateWorktreeInput({ ...base, agent: 'claude', model: 'opus' })).not.toHaveProperty('model')
    expect(() => asCreateWorktreeInput({ ...base, agent: 'opencode', model: 'x'.repeat(201) })).toThrow('model')
    expect(() => asCreateWorktreeInput({ ...base, agent: 'opencode', model: 'a&b' })).toThrow('model')
  })

  it('rejects a non-object payload', () => {
    expect(() => asCreateWorktreeInput('x')).toThrow('must be an object')
    expect(() => asCreateWorktreeInput(null)).toThrow('must be an object')
  })
})

describe('asCreateSessionInput shell and worktree', () => {
  it('accepts agent shell', () => {
    expect(asCreateSessionInput({ cwd: 'C:\\x', agent: 'shell' }).agent).toBe('shell')
  })

  it('keeps an optional worktreeId and rejects an empty one', () => {
    expect(asCreateSessionInput({ cwd: 'C:\\x', worktreeId: 'w1' }).worktreeId).toBe('w1')
    expect(asCreateSessionInput({ cwd: 'C:\\x' })).not.toHaveProperty('worktreeId')
    expect(() => asCreateSessionInput({ cwd: 'C:\\x', worktreeId: '' })).toThrow('worktreeId')
  })

  it('still rejects an agent outside claude, opencode and shell', () => {
    expect(() => asCreateSessionInput({ cwd: 'C:\\x', agent: 'bash' })).toThrow('"shell"')
  })
})
