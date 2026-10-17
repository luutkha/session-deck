import { describe, expect, it } from 'vitest'
import { readChecklistDraft, writeChecklistDraft } from './checklistDrafts'

describe('checklist drafts', () => {
  it('keeps an unsent step per session', () => {
    writeChecklistDraft('a', 'write tests')
    writeChecklistDraft('b', 'ship it')
    expect(readChecklistDraft('a')).toBe('write tests')
    expect(readChecklistDraft('b')).toBe('ship it')
  })

  it('forgets the draft once it is cleared', () => {
    writeChecklistDraft('c', 'temp')
    writeChecklistDraft('c', '')
    expect(readChecklistDraft('c')).toBe('')
  })

  it('returns an empty draft for an unknown session', () => {
    expect(readChecklistDraft('never')).toBe('')
  })
})
