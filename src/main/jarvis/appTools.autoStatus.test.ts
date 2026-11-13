import { describe, expect, it } from 'vitest'
import type { StoreData } from '../../shared/types'
import { emptyStore } from '../store/reducers'
import { withStatusIds } from './appTools'

function dataWithStatuses(): StoreData {
  return {
    ...emptyStore(),
    statuses: [
      { id: 'st-1', name: 'Working', color: '#2255ff' },
      { id: 'st-2', name: 'Waiting for me', color: '#ffaa00' },
      { id: 'st-3', name: 'Review', color: '#22aa44' }
    ]
  }
}

describe('withStatusIds (update_settings autoStatus by name)', () => {
  it('turns status names into ids, case-insensitively, and keeps ids as they are', () => {
    const out = withStatusIds(dataWithStatuses(), { autoStatus: { working: 'working', needsInput: 'st-2', finished: 'REVIEW' } })
    expect(out).toEqual({ autoStatus: { working: 'st-1', needsInput: 'st-2', finished: 'st-3' } })
  })

  it('leaves null (no mapping), booleans and other sections alone', () => {
    const changes = { autoStatus: { enabled: false, finished: null }, tray: { closeToTray: false } }
    expect(withStatusIds(dataWithStatuses(), changes)).toEqual(changes)
  })

  it('returns the same object when there is no autoStatus change', () => {
    const changes = { sleep: { enabled: true } }
    expect(withStatusIds(dataWithStatuses(), changes)).toBe(changes)
    expect(withStatusIds(dataWithStatuses(), { autoStatus: 'x' })).toEqual({ autoStatus: 'x' })
  })

  it('rejects a status that does not exist and lists the real ones', () => {
    expect(() => withStatusIds(dataWithStatuses(), { autoStatus: { working: 'Nope' } })).toThrow(/No status matches "Nope"|Nope/)
  })

  it('does not change its input', () => {
    const changes = { autoStatus: { working: 'Working' } }
    withStatusIds(dataWithStatuses(), changes)
    expect(changes).toEqual({ autoStatus: { working: 'Working' } })
  })
})
