import { describe, expect, it } from 'vitest'
import type { ChangedFile, ChangeKind } from '../../../shared/types'
import {
  buildTree,
  dirsOf,
  flattenVisible,
  stepFile,
  toggleCollapsed,
  visibleFilePaths
} from './changesTree'
import type { DirNode, TreeNode } from './changesTree'

function file(path: string, kind: ChangeKind = 'modified'): ChangedFile {
  return { path, kind, additions: 1, deletions: 0 }
}

function names(nodes: readonly TreeNode[]): readonly string[] {
  return nodes.map((node) => node.name)
}

function paths(nodes: readonly TreeNode[]): readonly string[] {
  return nodes.map((node) => node.path)
}

function dir(tree: readonly TreeNode[], path: string): DirNode {
  const found = flattenVisible(tree, new Set()).find(
    (row) => row.node.kind === 'dir' && row.node.path === path
  )
  if (found === undefined || found.node.kind !== 'dir') {
    throw new Error(`no dir node for ${path}`)
  }
  return found.node
}

describe('buildTree', () => {
  it('returns no nodes for an empty file list', () => {
    expect(buildTree([])).toEqual([])
  })

  it('lists root-level files alphabetically, case-insensitively', () => {
    const tree = buildTree([file('Zebra.ts'), file('apple.ts'), file('Beta.ts')])
    expect(names(tree)).toEqual(['apple.ts', 'Beta.ts', 'Zebra.ts'])
    expect(tree.every((node) => node.kind === 'file')).toBe(true)
    expect(paths(tree)).toEqual(['apple.ts', 'Beta.ts', 'Zebra.ts'])
  })

  it('nests directories and puts directories before files', () => {
    const tree = buildTree([file('root.md'), file('src/b.ts'), file('src/a/x.ts')])
    expect(names(tree)).toEqual(['src', 'root.md'])
    const src = dir(tree, 'src')
    expect(names(src.children)).toEqual(['a', 'b.ts'])
    expect(src.fileCount).toBe(2)
    const a = dir(tree, 'src/a')
    expect(names(a.children)).toEqual(['x.ts'])
    expect(a.fileCount).toBe(1)
  })

  it('counts files in the whole subtree', () => {
    const tree = buildTree([file('src/a/x.ts'), file('src/a/y.ts'), file('src/b/z.ts')])
    expect(dir(tree, 'src/a').fileCount).toBe(2)
    expect(dir(tree, 'src').fileCount).toBe(3)
  })

  it('compacts single-child directory chains into one node', () => {
    const tree = buildTree([file('src/a/b/c.ts')])
    expect(tree).toHaveLength(1)
    expect(tree[0].kind).toBe('dir')
    expect(tree[0].name).toBe('src/a/b')
    expect(tree[0].path).toBe('src/a/b')
    expect(tree[0].kind === 'dir' ? names(tree[0].children) : []).toEqual(['c.ts'])
  })

  it('stops compaction at the first directory that has files', () => {
    const tree = buildTree([file('a/y.ts'), file('a/b/x.ts')])
    expect(names(tree)).toEqual(['a'])
    expect(names(dir(tree, 'a').children)).toEqual(['b', 'y.ts'])
  })

  it('does not compact two sibling directories', () => {
    const tree = buildTree([file('a/x.ts'), file('b/y.ts')])
    expect(names(tree)).toEqual(['a', 'b'])
  })

  it('treats a backslash as part of the file name, not a separator', () => {
    const tree = buildTree([file('src\\a.ts')])
    expect(tree).toHaveLength(1)
    expect(tree[0].kind).toBe('file')
    expect(tree[0].path).toBe('src\\a.ts')
    expect(tree[0].name).toBe('src\\a.ts')
  })
})

describe('flattenVisible', () => {
  it('walks the tree in draw order with depths', () => {
    const tree = buildTree([file('src/a/x.ts'), file('src/b.ts'), file('root.md')])
    const rows = flattenVisible(tree, new Set())
    expect(rows.map((row) => [row.node.path, row.depth])).toEqual([
      ['src', 0],
      ['src/a', 1],
      ['src/a/x.ts', 2],
      ['src/b.ts', 1],
      ['root.md', 0]
    ])
  })

  it('omits children of a collapsed directory', () => {
    const tree = buildTree([file('src/a/x.ts'), file('src/b.ts'), file('root.md')])
    const rows = flattenVisible(tree, new Set(['src']))
    expect(rows.map((row) => row.node.path)).toEqual(['src', 'root.md'])
  })

  it('leaves deeper rows visible when only a descendant is collapsed', () => {
    const tree = buildTree([file('src/a/x.ts'), file('src/b.ts')])
    const rows = flattenVisible(tree, new Set(['src/a']))
    expect(rows.map((row) => row.node.path)).toEqual(['src', 'src/a', 'src/b.ts'])
  })
})

describe('visibleFilePaths', () => {
  it('returns only file rows, in draw order', () => {
    const tree = buildTree([file('src/b.ts'), file('src/a/x.ts'), file('root.md')])
    expect(visibleFilePaths(tree, new Set())).toEqual(['src/a/x.ts', 'src/b.ts', 'root.md'])
  })

  it('drops files under a collapsed directory', () => {
    const tree = buildTree([file('src/b.ts'), file('src/a/x.ts'), file('root.md')])
    expect(visibleFilePaths(tree, new Set(['src']))).toEqual(['root.md'])
    expect(visibleFilePaths(tree, new Set(['src/a']))).toEqual(['src/b.ts', 'root.md'])
  })
})

describe('stepFile', () => {
  const list = ['a.ts', 'b.ts', 'c.ts'] as const

  it('returns null for an empty list', () => {
    expect(stepFile([], null, 1)).toBeNull()
    expect(stepFile([], 'a.ts', -1)).toBeNull()
  })

  it('moves forward and wraps around', () => {
    expect(stepFile(list, 'a.ts', 1)).toBe('b.ts')
    expect(stepFile(list, 'c.ts', 1)).toBe('a.ts')
  })

  it('moves backward and wraps around', () => {
    expect(stepFile(list, 'c.ts', -1)).toBe('b.ts')
    expect(stepFile(list, 'a.ts', -1)).toBe('c.ts')
  })

  it('starts at the first or last entry when current is null', () => {
    expect(stepFile(list, null, 1)).toBe('a.ts')
    expect(stepFile(list, null, -1)).toBe('c.ts')
  })

  it('treats an unknown current like null', () => {
    expect(stepFile(list, 'gone.ts', 1)).toBe('a.ts')
    expect(stepFile(list, 'gone.ts', -1)).toBe('c.ts')
  })

  it('stays on the only entry', () => {
    expect(stepFile(['only.ts'], 'only.ts', 1)).toBe('only.ts')
    expect(stepFile(['only.ts'], 'only.ts', -1)).toBe('only.ts')
    expect(stepFile(['only.ts'], null, 1)).toBe('only.ts')
  })
})

describe('toggleCollapsed', () => {
  it('adds a directory without mutating the input set', () => {
    const before: ReadonlySet<string> = new Set(['x'])
    const after = toggleCollapsed(before, 'src')
    expect([...after]).toEqual(['x', 'src'])
    expect([...before]).toEqual(['x'])
    expect(after).not.toBe(before)
  })

  it('removes a collapsed directory without mutating the input set', () => {
    const before: ReadonlySet<string> = new Set(['x', 'src'])
    const after = toggleCollapsed(before, 'src')
    expect([...after]).toEqual(['x'])
    expect([...before]).toEqual(['x', 'src'])
  })
})

describe('dirsOf', () => {
  it('lists every directory path in draw order', () => {
    const tree = buildTree([file('src/a/x.ts'), file('src/b.ts'), file('docs/y.md'), file('z.ts')])
    expect(dirsOf(tree)).toEqual(['docs', 'src', 'src/a'])
  })

  it('returns nothing for root-level files only', () => {
    expect(dirsOf(buildTree([file('a.ts')]))).toEqual([])
  })
})
