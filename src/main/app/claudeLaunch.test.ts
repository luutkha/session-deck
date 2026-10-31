import { describe, it, expect } from 'vitest'
import { chooseClaudeLaunch, shouldFallbackToNew, RESUME_FAILURE_WINDOW_MS, REPLAY_TAIL_CHARS, NO_CONVERSATION_RE } from './claudeLaunch'

describe('chooseClaudeLaunch', () => {
  it('starts a fork with --resume <parent> --fork-session --session-id <new> (D52)', () => {
    expect(chooseClaudeLaunch({ claudeSessionId: 'new-id', everStarted: false, forkFrom: 'parent-id' })).toEqual({
      args: ['--resume', 'parent-id', '--fork-session', '--session-id', 'new-id'],
      mode: 'new'
    })
  })

  it('resumes a fork by its own id once it has started', () => {
    expect(chooseClaudeLaunch({ claudeSessionId: 'new-id', everStarted: true, forkFrom: 'parent-id' }).args).toEqual(['--resume', 'new-id'])
  })

  it('returns resume mode when everStarted is true', () => {
    const result = chooseClaudeLaunch({ claudeSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', everStarted: true })
    expect(result).toEqual({
      args: ['--resume', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'],
      mode: 'resume'
    })
  })

  it('returns new mode when everStarted is false', () => {
    const result = chooseClaudeLaunch({ claudeSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', everStarted: false })
    expect(result).toEqual({
      args: ['--session-id', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'],
      mode: 'new'
    })
  })
})

describe('shouldFallbackToNew', () => {
  it('returns false when mode is new', () => {
    expect(
      shouldFallbackToNew({ mode: 'new', runMs: 100, exitCode: 1, outputTail: 'no conversation found' })
    ).toBe(false)
  })

  it('returns false when runMs >= threshold', () => {
    expect(
      shouldFallbackToNew({
        mode: 'resume',
        runMs: RESUME_FAILURE_WINDOW_MS,
        exitCode: 1,
        outputTail: 'no conversation found'
      })
    ).toBe(false)
    expect(
      shouldFallbackToNew({
        mode: 'resume',
        runMs: RESUME_FAILURE_WINDOW_MS + 1,
        exitCode: 1,
        outputTail: 'no conversation found'
      })
    ).toBe(false)
  })

  it('returns false when exitCode is null', () => {
    expect(
      shouldFallbackToNew({
        mode: 'resume',
        runMs: 100,
        exitCode: null,
        outputTail: 'no conversation found'
      })
    ).toBe(false)
  })

  it('returns false when exitCode is 0', () => {
    expect(
      shouldFallbackToNew({
        mode: 'resume',
        runMs: 100,
        exitCode: 0,
        outputTail: 'no conversation found'
      })
    ).toBe(false)
  })

  it('returns true for fast non-zero exit with matching output', () => {
    expect(
      shouldFallbackToNew({
        mode: 'resume',
        runMs: 100,
        exitCode: 1,
        outputTail: 'Error: No conversation found for session'
      })
    ).toBe(true)
    expect(
      shouldFallbackToNew({
        mode: 'resume',
        runMs: 500,
        exitCode: 130,
        outputTail: 'Could not find conversation'
      })
    ).toBe(true)
    expect(
      shouldFallbackToNew({
        mode: 'resume',
        runMs: 1000,
        exitCode: 2,
        outputTail: 'not found'
      })
    ).toBe(true)
  })

  it('returns false for fast non-zero exit without matching output', () => {
    expect(
      shouldFallbackToNew({
        mode: 'resume',
        runMs: 100,
        exitCode: 1,
        outputTail: 'Some other error message'
      })
    ).toBe(false)
  })

  it('matches case-insensitively', () => {
    expect(
      shouldFallbackToNew({
        mode: 'resume',
        runMs: 100,
        exitCode: 1,
        outputTail: 'NO CONVERSATION FOUND'
      })
    ).toBe(true)
    expect(
      shouldFallbackToNew({
        mode: 'resume',
        runMs: 100,
        exitCode: 1,
        outputTail: 'Could Not Find Session'
      })
    ).toBe(true)
  })

  it('returns false for slow non-zero exit even with matching output', () => {
    expect(
      shouldFallbackToNew({
        mode: 'resume',
        runMs: RESUME_FAILURE_WINDOW_MS + 100,
        exitCode: 1,
        outputTail: 'no conversation found'
      })
    ).toBe(false)
  })
})

describe('constants', () => {
  it('RESUME_FAILURE_WINDOW_MS is 8000', () => {
    expect(RESUME_FAILURE_WINDOW_MS).toBe(8000)
  })

  it('REPLAY_TAIL_CHARS is 2000', () => {
    expect(REPLAY_TAIL_CHARS).toBe(2000)
  })

  it('NO_CONVERSATION_RE matches expected phrases', () => {
    expect(NO_CONVERSATION_RE.test('no conversation found')).toBe(true)
    expect(NO_CONVERSATION_RE.test('could not find')).toBe(true)
    expect(NO_CONVERSATION_RE.test('not found')).toBe(true)
    expect(NO_CONVERSATION_RE.test('unrelated error')).toBe(false)
  })
})