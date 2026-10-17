import { describe, it, expect } from 'vitest'
import type { AppSettings, Session, StatusDef } from '../../shared/types'
import { DEFAULT_APP_SETTINGS } from '../../shared/types'
import { decideAutoStatus } from './autoStatus'

const STATUSES: readonly StatusDef[] = [
  { id: 'todo', name: 'Todo', color: '#9e9e9e' },
  { id: 'working', name: 'Working', color: '#42a5f5' },
  { id: 'waiting', name: 'Waiting', color: '#ffb300' },
  { id: 'review', name: 'Review', color: '#ab47bc' },
  { id: 'done', name: 'Done', color: '#66bb6a' }
]

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    name: 'one',
    cwd: '/tmp/one',
    groupId: null,
    statusId: 'todo',
    order: 0,
    createdAt: 1,
    claudeArgs: [],
    ...overrides
  }
}

function settingsWith(patch: Partial<AppSettings['autoStatus']>): AppSettings {
  return { ...DEFAULT_APP_SETTINGS, autoStatus: { ...DEFAULT_APP_SETTINGS.autoStatus, ...patch } }
}

describe('decideAutoStatus', () => {
  it('working -> the working mapping when the session is on another status', () => {
    expect(
      decideAutoStatus({ settings: DEFAULT_APP_SETTINGS, statuses: STATUSES, session: session(), activity: 'working' })
    ).toBe('working')
  })

  it('needs-input -> the needsInput mapping', () => {
    expect(
      decideAutoStatus({ settings: DEFAULT_APP_SETTINGS, statuses: STATUSES, session: session(), activity: 'needs-input' })
    ).toBe('waiting')
  })

  it('finished -> the finished mapping', () => {
    expect(
      decideAutoStatus({ settings: DEFAULT_APP_SETTINGS, statuses: STATUSES, session: session(), activity: 'finished' })
    ).toBe('review')
  })

  it('uses custom mappings', () => {
    const settings = settingsWith({ working: 'done', needsInput: 'review', finished: 'working' })
    expect(decideAutoStatus({ settings, statuses: STATUSES, session: session(), activity: 'working' })).toBe('done')
    expect(decideAutoStatus({ settings, statuses: STATUSES, session: session(), activity: 'needs-input' })).toBe('review')
    expect(decideAutoStatus({ settings, statuses: STATUSES, session: session(), activity: 'finished' })).toBe('working')
  })

  it('disabled auto status -> undefined (leave unchanged)', () => {
    const settings = settingsWith({ enabled: false })
    expect(decideAutoStatus({ settings, statuses: STATUSES, session: session(), activity: 'working' })).toBeUndefined()
  })

  it('closed session -> undefined', () => {
    const closed = session({ closedAt: 5 })
    expect(
      decideAutoStatus({ settings: DEFAULT_APP_SETTINGS, statuses: STATUSES, session: closed, activity: 'working' })
    ).toBeUndefined()
  })

  it('missing mapped status -> undefined', () => {
    const withoutReview = STATUSES.filter((s) => s.id !== 'review')
    expect(
      decideAutoStatus({ settings: DEFAULT_APP_SETTINGS, statuses: withoutReview, session: session(), activity: 'finished' })
    ).toBeUndefined()
  })

  it('session already on the mapped status -> undefined', () => {
    expect(
      decideAutoStatus({
        settings: DEFAULT_APP_SETTINGS,
        statuses: STATUSES,
        session: session({ statusId: 'working' }),
        activity: 'working'
      })
    ).toBeUndefined()
  })

  it('null mapping -> undefined (leave unchanged)', () => {
    const settings = settingsWith({ needsInput: null })
    expect(decideAutoStatus({ settings, statuses: STATUSES, session: session(), activity: 'needs-input' })).toBeUndefined()
  })

  it('a session with no status (null) gets the mapped status', () => {
    expect(
      decideAutoStatus({
        settings: DEFAULT_APP_SETTINGS,
        statuses: STATUSES,
        session: session({ statusId: null }),
        activity: 'finished'
      })
    ).toBe('review')
  })
})
