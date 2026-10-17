import { describe, it, expect } from 'vitest'
import { attentionNotice, MAX_ACTIVITY_CHARS } from './attentionNotice'

describe('attentionNotice', () => {
  it('uses the session name as title and a finished text for done', () => {
    expect(attentionNotice({ name: 'Api work', reason: 'done' })).toEqual({
      title: 'Api work',
      body: 'Finished, waiting for you'
    })
  })

  it('uses the permission text for permission', () => {
    expect(attentionNotice({ name: 'Api work', reason: 'permission' })).toEqual({
      title: 'Api work',
      body: 'Needs your permission'
    })
  })

  it('appends the permission message when present', () => {
    const notice = attentionNotice({ name: 'Api', reason: 'permission', activityMessage: 'Run npm test?' })
    expect(notice?.body).toBe('Needs your permission: Run npm test?')
  })

  it('ignores a blank activity message', () => {
    const notice = attentionNotice({ name: 'Api', reason: 'permission', activityMessage: '   ' })
    expect(notice?.body).toBe('Needs your permission')
  })

  it('truncates a long message', () => {
    const long = 'x'.repeat(MAX_ACTIVITY_CHARS + 50)
    const notice = attentionNotice({ name: 'Api', reason: 'permission', activityMessage: long })
    expect(notice?.body).toBe(`Needs your permission: ${'x'.repeat(MAX_ACTIVITY_CHARS)}...`)
  })

  it('returns null for idle and bell (not worth a desktop notification)', () => {
    expect(attentionNotice({ name: 'Api', reason: 'idle' })).toBeNull()
    expect(attentionNotice({ name: 'Api', reason: 'bell' })).toBeNull()
  })

  it('falls back to a generic title for an empty name', () => {
    expect(attentionNotice({ name: '  ', reason: 'done' })?.title).toBe('Claude session')
  })
})
