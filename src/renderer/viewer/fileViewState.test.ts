import { describe, expect, it } from 'vitest'
import type { FileView, FileViewResult, FileViewStat } from '../../shared/types'
import {
  beginFileViewLive,
  beginFileViewLoad,
  clearFileViewUpdated,
  failFileViewLoad,
  fileNameFromText,
  FILE_VIEW_LOAD_FAILED,
  FILE_VIEW_MISSING_TEXT,
  FILE_VIEW_UPDATED_TEXT,
  fileViewNotice,
  fileViewRequestKey,
  finishFileViewLoad,
  noteFileViewStat,
  noteFileViewUpdated,
  shouldReload,
  shownFileViewState
} from './fileViewState'

function fileView(name = 'notes.md'): FileView {
  return {
    path: `C:\\work\\${name}`,
    name,
    kind: 'markdown',
    size: 12,
    content: '# hi',
    base64: '',
    mime: '',
    sheets: [],
    truncated: false,
    mtimeMs: 1500
  }
}

const READY: FileViewResult = { ok: true, view: fileView() }
const FAILED: FileViewResult = { ok: false, error: 'That file is not readable.' }
const STAT: FileViewStat = { ok: true, mtimeMs: 1500, size: 12 }

describe('beginFileViewLoad', () => {
  it('starts loading for the given nonce', () => {
    expect(beginFileViewLoad(3)).toEqual({ status: 'loading', nonce: 3 })
  })
})

describe('finishFileViewLoad', () => {
  it('shows the file of the newest request', () => {
    const done = finishFileViewLoad(beginFileViewLoad(1), 1, READY)
    expect(done.status).toBe('ready')
    expect(done.status === 'ready' ? done.view.name : '').toBe('notes.md')
  })

  it('shows the error text main gave', () => {
    expect(finishFileViewLoad(beginFileViewLoad(1), 1, FAILED)).toEqual({
      status: 'error',
      nonce: 1,
      error: 'That file is not readable.'
    })
  })

  it('ignores a stale reply when a newer request already started', () => {
    const current = beginFileViewLoad(2)
    expect(finishFileViewLoad(current, 1, READY)).toBe(current)
    expect(finishFileViewLoad(current, 1, FAILED)).toBe(current)
  })

  it('ignores a stale reply over a file that is already shown', () => {
    const shown = finishFileViewLoad(beginFileViewLoad(2), 2, READY)
    expect(finishFileViewLoad(shown, 1, FAILED)).toBe(shown)
  })
})

describe('failFileViewLoad', () => {
  it('reports a failed IPC call and ignores a stale one', () => {
    const loading = beginFileViewLoad(4)
    expect(failFileViewLoad(loading, 4)).toEqual({ status: 'error', nonce: 4, error: FILE_VIEW_LOAD_FAILED })
    expect(failFileViewLoad(beginFileViewLoad(5), 4)).toEqual({ status: 'loading', nonce: 5 })
  })
})

describe('fileNameFromText', () => {
  it('keeps the last path segment and drops a line suffix', () => {
    expect(fileNameFromText('notes.md')).toBe('notes.md')
    expect(fileNameFromText('docs\\notes.md')).toBe('notes.md')
    expect(fileNameFromText('C:\\work dir\\src\\a.ts:12:5')).toBe('a.ts')
    expect(fileNameFromText('src/readme.md')).toBe('readme.md')
  })
})

describe('shownFileViewState', () => {
  it('draws loading, never the old file, while the stored state belongs to another request', () => {
    const shown = finishFileViewLoad(beginFileViewLoad(1), 1, READY)
    const loaded = { key: 'a', state: shown }
    expect(shownFileViewState(loaded, 'a')).toBe(shown)
    expect(shownFileViewState(loaded, 'b')).toEqual({ status: 'loading', nonce: 1 })
    expect(shownFileViewState(null, 'a')).toBeNull()
  })

  it('keys a load by request and reload counter', () => {
    const base = fileViewRequestKey('s1', 'a.md', 1, 0)
    expect(fileViewRequestKey('s1', 'a.md', 1, 0)).toBe(base)
    expect(fileViewRequestKey('s1', 'a.md', 2, 0)).not.toBe(base)
    expect(fileViewRequestKey('s1', 'a.md', 1, 1)).not.toBe(base)
    expect(fileViewRequestKey('s2', 'a.md', 1, 0)).not.toBe(base)
    expect(fileViewRequestKey('s1', 'b.md', 1, 0)).not.toBe(base)
  })
})

describe('shouldReload', () => {
  it('reloads only when mtime or size differ', () => {
    expect(shouldReload(fileView(), STAT)).toBe(false)
    expect(shouldReload(fileView(), { ok: true, mtimeMs: 1600, size: 12 })).toBe(true)
    expect(shouldReload(fileView(), { ok: true, mtimeMs: 1500, size: 13 })).toBe(true)
  })

  it('does not reload when the stat failed', () => {
    expect(shouldReload(fileView(), { ok: false, error: 'gone' })).toBe(false)
  })
})

describe('live notice state', () => {
  it('shows the missing notice until a stat says the file is back', () => {
    const gone = noteFileViewStat(beginFileViewLive(), { ok: false, error: 'gone', gone: true })
    expect(gone.missing).toBe(true)
    expect(fileViewNotice(gone)).toEqual({ kind: 'missing', text: FILE_VIEW_MISSING_TEXT })
    expect(noteFileViewStat(gone, STAT).missing).toBe(false)
  })

  it('keeps the same object while the stat says nothing new', () => {
    const idle = beginFileViewLive()
    expect(noteFileViewStat(idle, STAT)).toBe(idle)
  })

  it('flashes Updated, then clears only the flash its timer was started for', () => {
    const updated = noteFileViewUpdated(1000)
    expect(fileViewNotice(updated)).toEqual({ kind: 'updated', text: FILE_VIEW_UPDATED_TEXT })
    expect(clearFileViewUpdated(updated, 999)).toBe(updated)
    expect(clearFileViewUpdated(updated, 1000).updatedAt).toBeNull()
    expect(fileViewNotice(clearFileViewUpdated(updated, 1000))).toBeNull()
  })

  it('lets "gone" win over the Updated flash', () => {
    const gone = noteFileViewStat(noteFileViewUpdated(1000), { ok: false, error: 'gone', gone: true })
    expect(fileViewNotice(gone)?.kind).toBe('missing')
  })
})
