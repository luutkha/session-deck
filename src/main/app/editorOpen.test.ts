import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { clampLine, openInEditor, resolveInside, type EditorDeps } from './editorOpen'

const root = path.resolve('C:/wt/app')

function deps(extra: Partial<EditorDeps> = {}): EditorDeps {
  return {
    runCode: vi.fn(async () => true),
    openPath: vi.fn(async () => ''),
    isFile: vi.fn(async () => true),
    ...extra
  }
}

describe('resolveInside', () => {
  it('accepts a nested relative path', () => {
    expect(resolveInside(root, 'src/a.ts')).toBe(path.join(root, 'src', 'a.ts'))
  })
  it('refuses parent escapes, absolute paths and empty paths', () => {
    expect(resolveInside(root, '../x.ts')).toBeNull()
    expect(resolveInside(root, 'src/../../x.ts')).toBeNull()
    expect(resolveInside(root, path.resolve('C:/other/x.ts'))).toBeNull()
    expect(resolveInside(root, '')).toBeNull()
    expect(resolveInside(root, '.')).toBeNull()
  })
})

describe('clampLine', () => {
  it('floors and defaults to 1', () => {
    expect(clampLine(12.9)).toBe(12)
    expect(clampLine(0)).toBe(1)
    expect(clampLine(-4)).toBe(1)
    expect(clampLine(Number.NaN)).toBe(1)
  })
})

describe('openInEditor', () => {
  it('uses VS Code at the line when it works', async () => {
    const d = deps()
    const result = await openInEditor(d, root, 'src/a.ts', 42)
    expect(result).toEqual({ via: 'vscode', file: path.join(root, 'src', 'a.ts'), line: 42 })
    expect(d.runCode).toHaveBeenCalledWith(path.join(root, 'src', 'a.ts'), 42)
    expect(d.openPath).not.toHaveBeenCalled()
  })
  it('falls back to the default app when VS Code is missing', async () => {
    const d = deps({ runCode: vi.fn(async () => false) })
    const result = await openInEditor(d, root, 'a.ts', 3)
    expect(result.via).toBe('default')
    expect(d.openPath).toHaveBeenCalledWith(path.join(root, 'a.ts'))
  })
  it('refuses a path outside the worktree and a missing file without opening anything', async () => {
    const d = deps({ isFile: vi.fn(async () => false) })
    await expect(openInEditor(d, root, '../x', 1)).rejects.toThrow('outside the worktree')
    await expect(openInEditor(d, root, 'gone.ts', 1)).rejects.toThrow('no longer exists')
    expect(d.runCode).not.toHaveBeenCalled()
    expect(d.openPath).not.toHaveBeenCalled()
  })
  it('reports the OS error when even the default app fails', async () => {
    const d = deps({ runCode: vi.fn(async () => false), openPath: vi.fn(async () => 'No application') })
    await expect(openInEditor(d, root, 'a.ts', 1)).rejects.toThrow('No application')
  })
})
