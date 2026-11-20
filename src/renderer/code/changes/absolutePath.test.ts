import { describe, expect, it } from 'vitest'
import { absoluteChangedPath, canOpenInViewer } from './absolutePath'

describe('absoluteChangedPath', () => {
  it('joins a Windows worktree root and a forward-slash path with backslashes', () => {
    expect(absoluteChangedPath('C:\\wt\\checkout', 'src/app/main.ts')).toBe('C:\\wt\\checkout\\src\\app\\main.ts')
  })

  it('ignores a trailing separator on the root', () => {
    expect(absoluteChangedPath('C:\\wt\\checkout\\', 'README.md')).toBe('C:\\wt\\checkout\\README.md')
  })

  it('keeps a path that is already absolute', () => {
    expect(absoluteChangedPath('C:\\wt\\checkout', 'D:\\other\\file.md')).toBe('D:\\other\\file.md')
    expect(absoluteChangedPath('C:\\wt\\checkout', '\\\\share\\file.md')).toBe('\\\\share\\file.md')
  })

  it('drops a leading separator of the relative path', () => {
    expect(absoluteChangedPath('C:\\wt\\checkout', '\\README.md')).toBe('C:\\wt\\checkout\\README.md')
  })
})

describe('canOpenInViewer', () => {
  it('accepts a known type that is not deleted', () => {
    expect(canOpenInViewer({ path: 'docs/notes.md', kind: 'modified' })).toBe(true)
    expect(canOpenInViewer({ path: 'data/table.xlsx', kind: 'added' })).toBe(true)
  })

  it('refuses a deleted file or an unknown type', () => {
    expect(canOpenInViewer({ path: 'docs/notes.md', kind: 'deleted' })).toBe(false)
    expect(canOpenInViewer({ path: 'src/main.ts', kind: 'modified' })).toBe(false)
  })
})
