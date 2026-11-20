import { describe, expect, it } from 'vitest'
import type { FileView, FileViewResult } from '../../shared/types'
import {
  beginFileViewLoad,
  failFileViewLoad,
  fileNameFromText,
  FILE_VIEW_LOAD_FAILED,
  finishFileViewLoad
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
    truncated: false
  }
}

const READY: FileViewResult = { ok: true, view: fileView() }
const FAILED: FileViewResult = { ok: false, error: 'That file is not readable.' }

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
