import { describe, expect, it } from 'vitest'
import { beginFileViewLive, fileViewNotice, noteFileViewStat } from './fileViewState'

describe('a failed stat that does not say the file is gone', () => {
  it('shows NO "File no longer exists" notice (a locked or briefly unreadable file is still there)', () => {
    const locked = noteFileViewStat(beginFileViewLive(), { ok: false, error: 'File is not readable right now' })
    expect(locked.missing).toBe(false)
    expect(fileViewNotice(locked)).toBeNull()
  })

  it('a gone file shows the notice, and a later lock error does not clear it by itself being "found"', () => {
    const gone = noteFileViewStat(beginFileViewLive(), { ok: false, error: 'File not found', gone: true })
    expect(gone.missing).toBe(true)
    const after = noteFileViewStat(gone, { ok: false, error: 'File is not readable right now' })
    expect(after.missing).toBe(false)
  })
})
