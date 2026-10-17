import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { resolveIconPath, type IconPathDeps } from './iconPaths'

function deps(overrides: Partial<IconPathDeps> = {}): IconPathDeps {
  return {
    isPackaged: false,
    resourcesPath: path.join('C:', 'app', 'resources'),
    appPath: path.join('C:', 'project'),
    exists: () => true,
    ...overrides
  }
}

describe('resolveIconPath', () => {
  it('uses <appPath>/build in development', () => {
    expect(resolveIconPath('tray.png', deps())).toBe(path.join('C:', 'project', 'build', 'tray.png'))
  })

  it('uses <resourcesPath>/build when packaged', () => {
    const result = resolveIconPath('icon.png', deps({ isPackaged: true }))
    expect(result).toBe(path.join('C:', 'app', 'resources', 'build', 'icon.png'))
  })

  it('returns null when the file is missing', () => {
    expect(resolveIconPath('tray-attention.png', deps({ exists: () => false }))).toBeNull()
  })

  it('checks the exact candidate path that would be returned', () => {
    const checked: string[] = []
    const result = resolveIconPath('tray.png', deps({
      isPackaged: true,
      exists: (p) => {
        checked.push(p)
        return true
      }
    }))
    expect(checked).toEqual([result])
  })

  it('does not look in the other location', () => {
    const checked: string[] = []
    resolveIconPath('icon.png', deps({
      isPackaged: false,
      exists: (p) => {
        checked.push(p)
        return false
      }
    }))
    expect(checked.every((p) => p.startsWith(path.join('C:', 'project')))).toBe(true)
  })
})
