import { describe, it, expect } from 'vitest'
import { CONTINUE_FAILED_TITLE, continueFailedBody } from './continueFailedNotice'

describe('continueFailedNotice', () => {
  it('uses a title that stands on its own in the notification tray', () => {
    expect(CONTINUE_FAILED_TITLE).toBe('SessionDeck needs you')
  })

  it('names the session so the user knows where to look', () => {
    expect(continueFailedBody('alpha refactor')).toBe(
      'SessionDeck could not continue alpha refactor after the reset — it needs you.'
    )
  })
})
