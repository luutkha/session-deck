import { describe, expect, it } from 'vitest'
import type { OpenLinkResult } from '../../shared/types'
import {
  clearCopyFeedback,
  copyPathLabel,
  COPY_FEEDBACK_IDLE,
  isCopyConfirmed,
  noteCopySuccess,
  OPEN_FAILED_TEXT,
  openLinkMessage,
  REVEAL_FAILED_TEXT
} from './fileActionsLogic'

describe('copy feedback', () => {
  it('shows the check after a copy until its own timer clears it', () => {
    const copied = noteCopySuccess(1000)
    expect(isCopyConfirmed(copied)).toBe(true)
    expect(clearCopyFeedback(copied, 999)).toBe(copied)
    expect(clearCopyFeedback(copied, 1000)).toEqual(COPY_FEEDBACK_IDLE)
  })

  it('starts idle (no check)', () => {
    expect(isCopyConfirmed(COPY_FEEDBACK_IDLE)).toBe(false)
  })

  it('labels the button with what just happened', () => {
    expect(copyPathLabel(false)).toBe('Copy path')
    expect(copyPathLabel(true)).toBe('Path copied')
  })
})

describe('openLinkMessage', () => {
  it('says nothing when the action worked', () => {
    expect(openLinkMessage({ ok: true }, 'open')).toBeNull()
    expect(openLinkMessage({ ok: true, revealed: true }, 'reveal')).toBeNull()
  })

  it('shows the reason main gave, else a short fallback per action', () => {
    const failed: OpenLinkResult = { ok: false, error: '  No program is registered.  ' }
    expect(openLinkMessage(failed, 'open')).toBe('No program is registered.')
    expect(openLinkMessage({ ok: false }, 'open')).toBe(OPEN_FAILED_TEXT)
    expect(openLinkMessage({ ok: false }, 'reveal')).toBe(REVEAL_FAILED_TEXT)
    expect(openLinkMessage({ ok: false, error: '   ' }, 'reveal')).toBe(REVEAL_FAILED_TEXT)
  })
})
