import { describe, expect, it } from 'vitest'
import { moveToCodeNote } from './NewWorktreeDialog'

describe('moveToCodeNote (D88/D89)', () => {
  it('names the one session that moves in', () => {
    expect(moveToCodeNote(1, 'Login fix')).toBe(
      '“Login fix” moves into this worktree and restarts there with a new conversation.'
    )
  })

  it('shows the count when several sessions move in', () => {
    expect(moveToCodeNote(3, 'Login fix')).toBe(
      '3 sessions move in. Each restarts there with a new conversation.'
    )
  })
})
